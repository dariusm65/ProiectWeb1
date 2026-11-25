// Unit and Supertest + MySQL 8 integration tests for Slice 5:
// - Ride Chat Messages (GET /api/rides/:rideId/messages, POST /api/rides/:rideId/messages) (D-011, D-013, D-014)
// - Notifications Polling & Read State (GET /api/notifications, PATCH /api/notifications/:notificationId/read,
//   POST /api/notifications/read-all) (D-011, D-013, D-014)
// - Post-Arrival Mutual Star Ratings & Public Reputation (POST /api/rides/:rideId/reviews,
//   GET /api/users/:userId/reviews, GET /api/users/:userId) (D-008, D-013, D-014, D-016)
// - Moderation Reports & Admin Suspension Cascade (POST /api/reports, GET/PATCH /api/admin/reports,
//   GET /api/admin/users, POST /api/admin/users/:userId/suspend|unsuspend,
//   POST /api/admin/rides/:rideId/cancel, PATCH /api/admin/users/:userId/role, GET /api/admin/stats) (D-013, D-016)
//
// Uses dedicated throwaway database `studride_test_community_mod` (PATTERN-002) and injectable
// `nowFn` (PATTERN-003).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import request from 'supertest';
import { isAuthorizedChatParticipant } from '../src/services/chatService.js';
import { evaluateReviewEligibility } from '../src/services/reviewService.js';
import { canModerateTargetUser, validateReportTargetInput } from '../src/services/moderationService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
dotenv.config({ path: path.join(repo, '.env') });

const TEST_DB = 'studride_test_community_mod';
const TEST_JWT_SECRET = 'studride-test-jwt-secret-key-at-least-32-chars';

describe('unit: Slice 5 pure domain and authorization helpers (D-008, D-011, D-013)', () => {
  it('isAuthorizedChatParticipant allows only the ride driver or passengers with confirmed / pending_reconfirmation bookings (D-011)', () => {
    const ride = { id: 10, driver_id: 1, status: 'active' };
    const bookings = [
      { id: 101, passenger_id: 2, status: 'confirmed' },
      { id: 102, passenger_id: 3, status: 'pending_reconfirmation' },
      { id: 103, passenger_id: 4, status: 'pending' },
      { id: 104, passenger_id: 5, status: 'cancelled' },
      { id: 105, passenger_id: 6, status: 'rejected' },
      { id: 106, passenger_id: 7, status: 'expired' },
    ];

    expect(isAuthorizedChatParticipant({ ride, bookings, userId: 1 })).toBe(true);
    expect(isAuthorizedChatParticipant({ ride, bookings, userId: 2 })).toBe(true);
    expect(isAuthorizedChatParticipant({ ride, bookings, userId: 3 })).toBe(true);
    expect(isAuthorizedChatParticipant({ ride, bookings, userId: 4 })).toBe(false);
    expect(isAuthorizedChatParticipant({ ride, bookings, userId: 5 })).toBe(false);
    expect(isAuthorizedChatParticipant({ ride, bookings, userId: 6 })).toBe(false);
    expect(isAuthorizedChatParticipant({ ride, bookings, userId: 7 })).toBe(false);
    expect(isAuthorizedChatParticipant({ ride, bookings, userId: 999 })).toBe(false);
  });

  it('evaluateReviewEligibility enforces post-arrival time, non-cancelled ride, no self-review, and mutual driver <-> confirmed passenger (D-008)', () => {
    const arrival = new Date('2026-12-04T15:00:00Z');
    const ride = { id: 20, driver_id: 10, status: 'active', estimated_arrival_time: arrival };
    const bookings = [
      { id: 201, passenger_id: 11, status: 'confirmed' },
      { id: 202, passenger_id: 12, status: 'confirmed' },
      { id: 203, passenger_id: 13, status: 'pending_reconfirmation' },
      { id: 204, passenger_id: 14, status: 'cancelled' },
    ];

    // Cancelled ride -> 409 RIDE_CANCELLED
    expect(() =>
      evaluateReviewEligibility({
        ride: { ...ride, status: 'cancelled' },
        bookings,
        reviewerId: 11,
        reviewedUserId: 10,
        now: new Date('2026-12-04T16:00:00Z'),
      }),
    ).toThrow(/RIDE_CANCELLED|cancelled/i);

    // Before arrival -> 403 REVIEW_BEFORE_ARRIVAL
    expect(() =>
      evaluateReviewEligibility({
        ride,
        bookings,
        reviewerId: 11,
        reviewedUserId: 10,
        now: new Date('2026-12-04T14:59:59Z'),
      }),
    ).toThrow(/REVIEW_BEFORE_ARRIVAL|arrival/i);

    // Self-review -> 400 SELF_REVIEW_NOT_ALLOWED
    expect(() =>
      evaluateReviewEligibility({
        ride,
        bookings,
        reviewerId: 10,
        reviewedUserId: 10,
        now: new Date('2026-12-04T15:00:00Z'),
      }),
    ).toThrow(/SELF_REVIEW_NOT_ALLOWED|self/i);

    // Passenger to passenger -> 403 NOT_CONFIRMED_PARTICIPANT
    expect(() =>
      evaluateReviewEligibility({
        ride,
        bookings,
        reviewerId: 11,
        reviewedUserId: 12,
        now: new Date('2026-12-04T15:00:00Z'),
      }),
    ).toThrow(/NOT_CONFIRMED_PARTICIPANT|confirmed/i);

    // Non-confirmed passenger -> 403 NOT_CONFIRMED_PARTICIPANT
    expect(() =>
      evaluateReviewEligibility({
        ride,
        bookings,
        reviewerId: 13,
        reviewedUserId: 10,
        now: new Date('2026-12-04T15:00:00Z'),
      }),
    ).toThrow(/NOT_CONFIRMED_PARTICIPANT|confirmed/i);

    // Exact arrival instant: driver -> confirmed passenger & confirmed passenger -> driver succeed
    expect(
      evaluateReviewEligibility({
        ride,
        bookings,
        reviewerId: 10,
        reviewedUserId: 11,
        now: new Date('2026-12-04T15:00:00Z'),
      }),
    ).toBe(true);
    expect(
      evaluateReviewEligibility({
        ride,
        bookings,
        reviewerId: 11,
        reviewedUserId: 10,
        now: new Date('2026-12-04T15:00:00Z'),
      }),
    ).toBe(true);
  });

  it('canModerateTargetUser blocks non-moderator actors, self-moderation, and enforces role hierarchy (moderator -> user only; admin -> user or moderator) (D-013)', () => {
    expect(() =>
      canModerateTargetUser({
        actor: { id: 10, role: 'user' },
        target: { id: 11, role: 'user' },
      }),
    ).toThrow(/FORBIDDEN|moderator/i);

    expect(() =>
      canModerateTargetUser({
        actor: { id: 1, role: 'admin' },
        target: { id: 1, role: 'admin' },
      }),
    ).toThrow(/SELF_MODERATION_NOT_ALLOWED|self/i);

    expect(() =>
      canModerateTargetUser({
        actor: { id: 2, role: 'moderator' },
        target: { id: 3, role: 'admin' },
      }),
    ).toThrow(/INSUFFICIENT_ROLE_HIERARCHY|hierarchy|permission/i);

    expect(() =>
      canModerateTargetUser({
        actor: { id: 2, role: 'moderator' },
        target: { id: 4, role: 'moderator' },
      }),
    ).toThrow(/INSUFFICIENT_ROLE_HIERARCHY|hierarchy|permission/i);

    expect(
      canModerateTargetUser({
        actor: { id: 2, role: 'moderator' },
        target: { id: 5, role: 'user' },
      }),
    ).toBe(true);

    expect(
      canModerateTargetUser({
        actor: { id: 1, role: 'admin' },
        target: { id: 2, role: 'moderator' },
      }),
    ).toBe(true);
  });

  it('validateReportTargetInput requires at least one target and blocks self-reporting (Guardrail 2)', () => {
    expect(() =>
      validateReportTargetInput({
        reporterId: 10,
        reported_user_id: null,
        ride_id: null,
        message_id: null,
      }),
    ).toThrow(/REPORT_TARGET_REQUIRED|target/i);

    expect(() =>
      validateReportTargetInput({
        reporterId: 10,
        reported_user_id: 10,
        ride_id: null,
        message_id: null,
      }),
    ).toThrow(/SELF_REPORT_NOT_ALLOWED|self/i);

    expect(
      validateReportTargetInput({
        reporterId: 10,
        reported_user_id: 11,
        ride_id: null,
        message_id: null,
      }),
    ).toBe(true);
  });
});

function connOpts(database) {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD ?? process.env.DB_ROOT_PASSWORD ?? '',
    database,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true,
  };
}

let admin = null;
try {
  admin = await mysql.createConnection(connOpts(undefined));
} catch (e) {
  if (process.env.CI) {
    throw new Error(`MySQL is required in CI but unreachable (${e.code || e.message})`);
  }
  console.warn(`\n!!! MySQL unreachable (${e.code || e.message}): community & moderation HTTP integration tests SKIPPED !!!\n`);
}

describe.skipIf(!admin)('integration: ride chat, notifications, mutual ratings & moderation cascade (MySQL)', () => {
  let pool;
  let app;
  let signAccessToken;
  let currentNow = new Date('2026-12-01T09:00:00Z'); // Tuesday 2026-12-01 11:00 Europe/Bucharest
  let userSeq = 0;

  beforeAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}; CREATE DATABASE ${TEST_DB} CHARACTER SET utf8mb4`);
    const migrateConn = await mysql.createConnection(connOpts(TEST_DB));
    try {
      const { migrate } = await import('../database/migrate.js');
      await migrate(migrateConn);
    } finally {
      await migrateConn.end();
    }
    pool = mysql.createPool({
      ...connOpts(TEST_DB),
      multipleStatements: false,
      waitForConnections: true,
      connectionLimit: 10,
    });
    ({ signAccessToken } = await import('../src/middleware/auth.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp({
      pool,
      jwtSecret: TEST_JWT_SECRET,
      geocodingThrottleMs: 0,
      nowFn: () => currentNow,
    });
  });

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    currentNow = new Date('2026-12-01T09:00:00Z');
    for (const t of [
      'reports', 'notifications', 'reviews', 'chat_messages', 'bookings', 'user_infractions',
      'ride_stops', 'rides', 'recurring_ride_exceptions', 'recurring_rule_stops',
      'recurring_ride_rules', 'geocoding_cache', 'known_places', 'users',
    ]) {
      await pool.query(`DELETE FROM ${t}`);
    }
  });

  async function createUser({
    role = 'user',
    gender = 'prefer_not_to_say',
    domain = null,
    suspended = false,
    name,
    phone = '+40700000000',
  } = {}) {
    userSeq += 1;
    const email = `u${userSeq}-${Date.now()}-${Math.random()}@example.com`;
    const [res] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, university_domain, role, gender, is_suspended)
       VALUES (?, 'secret-bcrypt-hash', ?, ?, ?, ?, ?, ?)`,
      [email, name ?? `User ${userSeq}`, phone, domain, role, gender, suspended],
    );
    const id = res.insertId;
    return { id, email, role, token: signAccessToken({ id, role }, TEST_JWT_SECRET) };
  }

  const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

  const STOP_DEFS = [
    ['Cluj-Napoca', 'Gara Cluj', 46.77, 23.6, 0, 0],
    ['Turda', 'Centru Turda', 46.57, 23.78, 32, 35],
    ['Alba Iulia', 'Gara Alba Iulia', 46.07, 23.57, 100, 110],
    ['Sibiu', 'Gara Sibiu', 45.79, 24.15, 160, 180],
  ];

  function ridePayload(dateStr = '2026-12-04', overrides = {}) {
    const baseMs = new Date(`${dateStr}T12:00:00Z`).getTime();
    return {
      available_seats: 3,
      declared_trip_cost: 120,
      luggage_allowed: true,
      pets_allowed: false,
      smoking_allowed: false,
      women_only: false,
      stops: STOP_DEFS.map(([city, loc, lat, lng, km, min]) => ({
        city_name: city,
        location_name: loc,
        latitude: lat,
        longitude: lng,
        distance_from_origin_km: km,
        estimated_arrival_time: new Date(baseMs + min * 60 * 1000).toISOString(),
      })),
      ...overrides,
    };
  }

  async function publishTestRide(driver, dateStr = '2026-12-04', overrides = {}) {
    const res = await request(app)
      .post('/api/rides')
      .set(auth(driver))
      .send(ridePayload(dateStr, overrides));
    expect(res.status).toBe(201);
    return res.body;
  }

  it('1–3. Ride Chat Messages (D-011, D-013, D-014): strict membership, revocation on cancel/reject/lapse, deterministic ordering, and chat notifications', async () => {
    const driver = await createUser({ domain: 'ulbsibiu.ro', name: 'Driver Dan' });
    const confirmedPax = await createUser({ domain: 'ubbcluj.ro', name: 'Confirmed Cora' });
    const pendingPax = await createUser({ name: 'Pending Paul' });
    const rejectedPax = await createUser({ name: 'Rejected Radu' });
    const outsider = await createUser({ name: 'Outsider Oana' });

    const { ride, stops } = await publishTestRide(driver, '2026-12-04');

    // Bookings for confirmedPax, pendingPax, rejectedPax
    const bConfirmRes = await request(app)
      .post(`/api/rides/${ride.id}/bookings`)
      .set(auth(confirmedPax))
      .send({ pickup_stop_id: stops[0].id, dropoff_stop_id: stops[2].id });
    expect(bConfirmRes.status).toBe(201);
    await request(app)
      .post(`/api/bookings/${bConfirmRes.body.booking.id}/accept`)
      .set(auth(driver))
      .expect(200);

    const bPendRes = await request(app)
      .post(`/api/rides/${ride.id}/bookings`)
      .set(auth(pendingPax))
      .send({ pickup_stop_id: stops[0].id, dropoff_stop_id: stops[2].id });
    expect(bPendRes.status).toBe(201);

    const bRejRes = await request(app)
      .post(`/api/rides/${ride.id}/bookings`)
      .set(auth(rejectedPax))
      .send({ pickup_stop_id: stops[0].id, dropoff_stop_id: stops[2].id });
    expect(bRejRes.status).toBe(201);
    await request(app)
      .post(`/api/bookings/${bRejRes.body.booking.id}/reject`)
      .set(auth(driver))
      .expect(200);

    // Pending, rejected, and outsider get 403 FORBIDDEN on GET and POST /messages (D-011)
    for (const blocked of [pendingPax, rejectedPax, outsider]) {
      const getRes = await request(app).get(`/api/rides/${ride.id}/messages`).set(auth(blocked));
      expect(getRes.status).toBe(403);
      const postRes = await request(app)
        .post(`/api/rides/${ride.id}/messages`)
        .set(auth(blocked))
        .send({ message_text: 'Salut!' });
      expect(postRes.status).toBe(403);
    }

    // Zod validation: empty or whitespace-only message -> 400
    await request(app)
      .post(`/api/rides/${ride.id}/messages`)
      .set(auth(driver))
      .send({ message_text: '   ' })
      .expect(400);

    // Driver and confirmed passenger post messages
    const m1 = await request(app)
      .post(`/api/rides/${ride.id}/messages`)
      .set(auth(driver))
      .send({ message_text: '  Plecam la 12:00 fix din fata garii!  ' });
    expect(m1.status).toBe(201);
    expect(m1.body.message.message_text).toBe('Plecam la 12:00 fix din fata garii!');
    expect(m1.body.message.sender.full_name).toBe('Driver Dan');
    expect(m1.body.message.sender.has_university_badge).toBe(true);
    expect(m1.body.message.sender.email).toBeUndefined();
    expect(m1.body.message.sender.phone).toBeUndefined();
    expect(m1.body.message.sender.gender).toBeUndefined();

    const m2 = await request(app)
      .post(`/api/rides/${ride.id}/messages`)
      .set(auth(confirmedPax))
      .send({ message_text: 'Perfect, ne vedem acolo!' });
    expect(m2.status).toBe(201);

    // GET /api/rides/:rideId/messages returns ordered messages (created_at ASC, id ASC)
    const listRes = await request(app).get(`/api/rides/${ride.id}/messages`).set(auth(confirmedPax));
    expect(listRes.status).toBe(200);
    expect(listRes.body.messages.map((m) => m.id)).toEqual([m1.body.message.id, m2.body.message.id]);

    // Notification fan-out: confirmedPax received chat_message from driver; driver received chat_message from confirmedPax
    const paxNotifs = await request(app).get('/api/notifications').set(auth(confirmedPax));
    expect(paxNotifs.status).toBe(200);
    expect(paxNotifs.body.notifications.some((n) => n.type === 'chat_message')).toBe(true);

    // Stop edit puts confirmedPax into pending_reconfirmation -> STILL allowed in chat per D-011
    const editedStops = stops.map((s, idx) => ({
      id: s.id,
      city_name: s.city_name,
      location_name: idx === 1 ? 'Statia Noua Turda' : s.location_name,
      latitude: s.latitude,
      longitude: s.longitude,
      distance_from_origin_km: s.distance_from_origin_km,
      estimated_arrival_time: s.estimated_arrival_time,
    }));
    await request(app)
      .patch(`/api/rides/${ride.id}/stops`)
      .set(auth(driver))
      .send({ stops: editedStops })
      .expect(200);

    await request(app).get(`/api/rides/${ride.id}/messages`).set(auth(confirmedPax)).expect(200);

    // Advance clock past 6h reconfirmation deadline -> lazy reconciliation lapses booking to expired -> 403 immediately (D-011)
    currentNow = new Date(currentNow.getTime() + 7 * 60 * 60 * 1000);
    const afterLapseGet = await request(app).get(`/api/rides/${ride.id}/messages`).set(auth(confirmedPax));
    expect(afterLapseGet.status).toBe(403);
    const afterLapsePost = await request(app)
      .post(`/api/rides/${ride.id}/messages`)
      .set(auth(confirmedPax))
      .send({ message_text: 'Mai am loc?' });
    expect(afterLapsePost.status).toBe(403);

    // Driver cancels ride -> posting new messages returns 409 RIDE_NOT_ACTIVE, but driver can still read history (Q-S5-1)
    await request(app).post(`/api/rides/${ride.id}/cancel`).set(auth(driver)).expect(200);
    await request(app)
      .post(`/api/rides/${ride.id}/messages`)
      .set(auth(driver))
      .send({ message_text: 'Anulat' })
      .expect(409);
    const driverHistory = await request(app).get(`/api/rides/${ride.id}/messages`).set(auth(driver));
    expect(driverHistory.status).toBe(200);
    expect(driverHistory.body.messages).toHaveLength(2);
  });

  it('4. Notifications Polling & Read State (D-011): unreadOnly filter, unread_count summary, owner guard, single read & read-all', async () => {
    const driver = await createUser({ name: 'Driver Diana' });
    const pax1 = await createUser({ name: 'Pax 1' });
    const pax2 = await createUser({ name: 'Pax 2' });
    const { ride, stops } = await publishTestRide(driver, '2026-12-04');

    // Create 2 bookings -> generates 2 unread notifications for driver
    await request(app)
      .post(`/api/rides/${ride.id}/bookings`)
      .set(auth(pax1))
      .send({ pickup_stop_id: stops[0].id, dropoff_stop_id: stops[1].id })
      .expect(201);
    await request(app)
      .post(`/api/rides/${ride.id}/bookings`)
      .set(auth(pax2))
      .send({ pickup_stop_id: stops[1].id, dropoff_stop_id: stops[3].id })
      .expect(201);

    const listAll = await request(app).get('/api/notifications').set(auth(driver));
    expect(listAll.status).toBe(200);
    expect(listAll.body.unread_count).toBe(2);
    expect(listAll.body.notifications).toHaveLength(2);
    expect(listAll.body.notifications.every((n) => n.is_read === false)).toBe(true);

    const firstId = listAll.body.notifications[0].id;

    // Non-owner cannot mark driver's notification read -> 404/403
    const wrongOwner = await request(app)
      .patch(`/api/notifications/${firstId}/read`)
      .set(auth(pax1));
    expect([403, 404]).toContain(wrongOwner.status);

    // Owner marks 1 notification read
    const readOne = await request(app)
      .patch(`/api/notifications/${firstId}/read`)
      .set(auth(driver));
    expect(readOne.status).toBe(200);
    expect(readOne.body.notification.is_read).toBe(true);
    expect(readOne.body.unread_count).toBe(1);

    // Filter unreadOnly=true returns only the remaining unread notification
    const unreadOnlyRes = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set(auth(driver));
    expect(unreadOnlyRes.status).toBe(200);
    expect(unreadOnlyRes.body.unread_count).toBe(1);
    expect(unreadOnlyRes.body.notifications).toHaveLength(1);
    expect(unreadOnlyRes.body.notifications[0].id).not.toBe(firstId);

    // Mark all read
    const readAll = await request(app).post('/api/notifications/read-all').set(auth(driver));
    expect(readAll.status).toBe(200);
    expect(readAll.body.unread_count).toBe(0);

    const afterReadAll = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set(auth(driver));
    expect(afterReadAll.body.notifications).toHaveLength(0);
    expect(afterReadAll.body.unread_count).toBe(0);
  });

  it('5–7. Post-Arrival Mutual Star Ratings & Public Reputation (D-008, D-016): blocks premature/cancelled/outsider reviews, enforces 1 per pair, and serves zero-PII public profile', async () => {
    const driver = await createUser({
      domain: 'ulbsibiu.ro',
      name: 'Driver Dragos',
      gender: 'male',
      phone: '+40722111222',
    });
    const pax1 = await createUser({
      domain: 'stud.ubbcluj.ro',
      name: 'Pax Patricia',
      gender: 'female',
      phone: '+40733111222',
    });
    const pax2 = await createUser({ name: 'Pax Petru' });
    const unconfirmedPax = await createUser({ name: 'Pending Pavel' });

    const { ride, stops } = await publishTestRide(driver, '2026-12-04');

    // Confirm pax1 and pax2; leave unconfirmedPax pending
    for (const pax of [pax1, pax2]) {
      const b = await request(app)
        .post(`/api/rides/${ride.id}/bookings`)
        .set(auth(pax))
        .send({ pickup_stop_id: stops[0].id, dropoff_stop_id: stops[3].id });
      await request(app)
        .post(`/api/bookings/${b.body.booking.id}/accept`)
        .set(auth(driver))
        .expect(200);
    }
    await request(app)
      .post(`/api/rides/${ride.id}/bookings`)
      .set(auth(unconfirmedPax))
      .send({ pickup_stop_id: stops[0].id, dropoff_stop_id: stops[2].id })
      .expect(201);

    // Before arrival (departure is 2026-12-04T12:00Z, arrival is 15:00Z) -> 403 REVIEW_BEFORE_ARRIVAL
    currentNow = new Date('2026-12-04T14:30:00Z');
    const earlyRes = await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(pax1))
      .send({ reviewed_user_id: driver.id, rating_stars: 5, comment: 'Prea devreme' });
    expect(earlyRes.status).toBe(403);
    expect(earlyRes.body.error).toBe('REVIEW_BEFORE_ARRIVAL');

    // Advance past estimated_arrival_time (15:00Z -> 15:05Z)
    currentNow = new Date('2026-12-04T15:05:00Z');

    // Self-review -> 400
    await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(driver))
      .send({ reviewed_user_id: driver.id, rating_stars: 5 })
      .expect(400);

    // Passenger reviewing another passenger -> 403
    await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(pax1))
      .send({ reviewed_user_id: pax2.id, rating_stars: 5 })
      .expect(403);

    // Unconfirmed (expired pending) passenger reviewing driver -> 403
    await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(unconfirmedPax))
      .send({ reviewed_user_id: driver.id, rating_stars: 5 })
      .expect(403);

    // Out-of-range stars (0 or 6) -> 400 VALIDATION_ERROR
    await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(pax1))
      .send({ reviewed_user_id: driver.id, rating_stars: 6 })
      .expect(400);

    // Valid mutual reviews: pax1 -> driver (5 stars), pax2 -> driver (4 stars), driver -> pax1 (5 stars)
    const r1 = await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(pax1))
      .send({ reviewed_user_id: driver.id, rating_stars: 5, comment: '  Drum excelent si punctual!  ' });
    expect(r1.status).toBe(201);
    expect(r1.body.review.rating_stars).toBe(5);
    expect(r1.body.review.comment).toBe('Drum excelent si punctual!');

    const r2 = await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(pax2))
      .send({ reviewed_user_id: driver.id, rating_stars: 4 });
    expect(r2.status).toBe(201);

    const r3 = await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(driver))
      .send({ reviewed_user_id: pax1.id, rating_stars: 5, comment: 'Pasager serios!' });
    expect(r3.status).toBe(201);

    // Duplicate review for (ride_id, pax1, driver) -> 409 DUPLICATE_REVIEW
    const dupRes = await request(app)
      .post(`/api/rides/${ride.id}/reviews`)
      .set(auth(pax1))
      .send({ reviewed_user_id: driver.id, rating_stars: 3 });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toBe('DUPLICATE_REVIEW');

    // Cancelled ride cannot be reviewed even after arrival (D-008)
    currentNow = new Date('2026-12-05T08:00:00Z');
    const { ride: cancelledRide, stops: cStops } = await publishTestRide(driver, '2026-12-06');
    const cb = await request(app)
      .post(`/api/rides/${cancelledRide.id}/bookings`)
      .set(auth(pax1))
      .send({ pickup_stop_id: cStops[0].id, dropoff_stop_id: cStops[3].id });
    await request(app).post(`/api/bookings/${cb.body.booking.id}/accept`).set(auth(driver)).expect(200);
    // Cancel on departure day -> records driver_late_cancel (-5 pp, 30-day badge)
    currentNow = new Date('2026-12-06T09:00:00Z');
    await request(app).post(`/api/rides/${cancelledRide.id}/cancel`).set(auth(driver)).expect(200);

    currentNow = new Date('2026-12-06T18:00:00Z');
    const cancelRev = await request(app)
      .post(`/api/rides/${cancelledRide.id}/reviews`)
      .set(auth(pax1))
      .send({ reviewed_user_id: driver.id, rating_stars: 1 });
    expect(cancelRev.status).toBe(409);
    expect(cancelRev.body.error).toBe('RIDE_CANCELLED');

    // Public GET /api/users/:userId/reviews (and GET /api/users/:userId) returns dual reputation + reviews with ZERO PII (Guardrail 4)
    const pubRes = await request(app).get(`/api/users/${driver.id}/reviews`);
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.user.id).toBe(driver.id);
    expect(pubRes.body.user.full_name).toBe('Driver Dragos');
    expect(pubRes.body.user.has_university_badge).toBe(true);
    expect(pubRes.body.user.university_badge_note).toContain('domain-validated');
    expect(pubRes.body.user.rating_average).toBe(4.5);
    expect(pubRes.body.user.rating_count).toBe(2);
    expect(pubRes.body.user.seriousness_score).toBe(95); // 100 - 5 from late cancel
    expect(pubRes.body.user.has_recent_cancellation_badge).toBe(true);
    // Strictly no PII on user or reviewer objects
    expect(pubRes.body.user.email).toBeUndefined();
    expect(pubRes.body.user.phone).toBeUndefined();
    expect(pubRes.body.user.gender).toBeUndefined();
    expect(pubRes.body.user.password_hash).toBeUndefined();
    expect(pubRes.body.reviews).toHaveLength(2);
    for (const rev of pubRes.body.reviews) {
      expect(rev.reviewer.email).toBeUndefined();
      expect(rev.reviewer.phone).toBeUndefined();
      expect(rev.reviewer.gender).toBeUndefined();
      expect(rev.reviewer.password_hash).toBeUndefined();
    }

    const aliasRes = await request(app).get(`/api/users/${driver.id}`);
    expect(aliasRes.status).toBe(200);
    expect(aliasRes.body.user.rating_average).toBe(4.5);
  });

  it('8–10. Reports, RBAC & Transactional Admin Suspension Cascade (D-013, D-016): zero penalties/fees on collateral cancellations, seat freeing, lazy reconciliation before cascade, and role hierarchy', async () => {
    const adminUser = await createUser({ role: 'admin', name: 'Admin Ana' });
    const modUser = await createUser({ role: 'moderator', name: 'Mod Mihai' });
    const targetUser = await createUser({ domain: 'ulbsibiu.ro', name: 'Target Tudor' });
    const otherDriver = await createUser({ domain: 'ubbcluj.ro', name: 'Driver Delia' });
    const otherPax = await createUser({ name: 'Pax Paul' });

    // Target user is BOTH:
    // (A) Driver of an upcoming ride on departure day with a confirmed passenger (otherPax)
    //     plus an overdue pending_reconfirmation passenger (Guardrail 1 check)
    // (B) Confirmed passenger on otherDriver's upcoming ride (< 4h before departure, 1 seat total)
    currentNow = new Date('2026-12-04T09:00:00Z');
    const { ride: targetDrivenRide, stops: tStops } = await publishTestRide(targetUser, '2026-12-04');
    const bOnTargetRide = await request(app)
      .post(`/api/rides/${targetDrivenRide.id}/bookings`)
      .set(auth(otherPax))
      .send({ pickup_stop_id: tStops[0].id, dropoff_stop_id: tStops[3].id });
    await request(app)
      .post(`/api/bookings/${bOnTargetRide.body.booking.id}/accept`)
      .set(auth(targetUser))
      .expect(200);

    const { ride: otherDrivenRide, stops: oStops } = await publishTestRide(otherDriver, '2026-12-04', {
      available_seats: 1,
    });
    const bByTargetPax = await request(app)
      .post(`/api/rides/${otherDrivenRide.id}/bookings`)
      .set(auth(targetUser))
      .send({ pickup_stop_id: oStops[0].id, dropoff_stop_id: oStops[3].id });
    await request(app)
      .post(`/api/bookings/${bByTargetPax.body.booking.id}/accept`)
      .set(auth(otherDriver))
      .expect(200);

    // Move clock to 10:00Z (< 4h before 12:00Z departure on same Bucharest day) so a normal cancel would trigger D-016 penalties
    currentNow = new Date('2026-12-04T10:00:00Z');

    // Guardrail 2: Report validation (at least one target required, no self-report, target must exist)
    await request(app)
      .post('/api/reports')
      .set(auth(otherPax))
      .send({ reason: 'harassment' })
      .expect(400);
    await request(app)
      .post('/api/reports')
      .set(auth(otherPax))
      .send({ reported_user_id: otherPax.id, reason: 'other' })
      .expect(400);
    // Indirect self-report: driver reporting their own ride with reported_user_id omitted -> 400 SELF_REPORT_NOT_ALLOWED
    await request(app)
      .post('/api/reports')
      .set(auth(targetUser))
      .send({ ride_id: targetDrivenRide.id, reason: 'unsafe_driving' })
      .expect(400);
    // Indirect self-report & cross-ride message mismatch: post a chat message on targetDrivenRide
    const chatMsgRes = await request(app)
      .post(`/api/rides/${targetDrivenRide.id}/messages`)
      .set(auth(otherPax))
      .send({ message_text: 'Mesaj pe cursa lui Tudor' });
    expect(chatMsgRes.status).toBe(201);
    const chatMsgId = chatMsgRes.body.message.id;
    // Sender reporting their own chat message -> 400 SELF_REPORT_NOT_ALLOWED
    await request(app)
      .post('/api/reports')
      .set(auth(otherPax))
      .send({ message_id: chatMsgId, reason: 'inappropriate_content' })
      .expect(400);
    // Mismatched ride_id and message_id -> 400 REPORT_TARGET_MISMATCH
    await request(app)
      .post('/api/reports')
      .set(auth(targetUser))
      .send({ ride_id: otherDrivenRide.id, message_id: chatMsgId, reason: 'inappropriate_content' })
      .expect(400);
    await request(app)
      .post('/api/reports')
      .set(auth(otherPax))
      .send({ reported_user_id: 999999, reason: 'fake_profile' })
      .expect(404);

    const reportRes = await request(app)
      .post('/api/reports')
      .set(auth(otherPax))
      .send({
        reported_user_id: targetUser.id,
        ride_id: targetDrivenRide.id,
        reason: 'unsafe_driving',
        details: 'Detalii raport',
      });
    expect(reportRes.status).toBe(201);
    expect(reportRes.body.report.status).toBe('pending');

    // Duplicate pending report for the exact same target -> 409 REPORT_ALREADY_PENDING (C-002)
    const dupReportRes = await request(app)
      .post('/api/reports')
      .set(auth(otherPax))
      .send({
        reported_user_id: targetUser.id,
        ride_id: targetDrivenRide.id,
        reason: 'spam',
      });
    expect(dupReportRes.status).toBe(409);
    expect(dupReportRes.body.error).toBe('REPORT_ALREADY_PENDING');

    // RBAC: regular user cannot access /api/admin/* (D-013)
    await request(app).get('/api/admin/reports').set(auth(otherPax)).expect(403);
    await request(app).get('/api/admin/users').set(auth(otherPax)).expect(403);

    // Moderator lists and resolves the report (enriched C-002 context present)
    const modReports = await request(app).get('/api/admin/reports?status=pending').set(auth(modUser));
    expect(modReports.status).toBe(200);
    expect(modReports.body.reports).toHaveLength(1);
    expect(modReports.body.reports[0].reporter).toMatchObject({ id: otherPax.id });
    expect(modReports.body.reports[0].reported_user).toMatchObject({ id: targetUser.id });
    expect(modReports.body.reports[0].ride).toMatchObject({ id: targetDrivenRide.id });

    const resolveRes = await request(app)
      .patch(`/api/admin/reports/${reportRes.body.report.id}`)
      .set(auth(modUser))
      .send({ status: 'resolved' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.report.status).toBe('resolved');
    expect(resolveRes.body.report.resolved_by).toBe(modUser.id);

    // Guardrail 4: GET /api/admin/users includes email and reputation metrics, but NEVER password_hash
    const usersList = await request(app).get('/api/admin/users').set(auth(modUser));
    expect(usersList.status).toBe(200);
    const listedTarget = usersList.body.users.find((u) => u.id === targetUser.id);
    expect(listedTarget.email).toBe(targetUser.email);
    expect(listedTarget.seriousness_score).toBe(100);
    expect(listedTarget.password_hash).toBeUndefined();

    // Role hierarchy guards: no self-suspension (400), moderator cannot suspend admin or moderator (403)
    await request(app).post(`/api/admin/users/${modUser.id}/suspend`).set(auth(modUser)).expect(400);
    await request(app).post(`/api/admin/users/${adminUser.id}/suspend`).set(auth(modUser)).expect(403);

    // Moderator suspends targetUser -> transactional cascade (D-016)
    const suspendRes = await request(app)
      .post(`/api/admin/users/${targetUser.id}/suspend`)
      .set(auth(modUser))
      .send({ reason: 'Incalcare regulament' });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.user.is_suspended).toBe(true);
    expect(suspendRes.body.cancelled_rides).toBe(1);
    expect(suspendRes.body.cancelled_passenger_bookings).toBe(1);

    // Repeat suspendUser on already-suspended account is idempotent and does not duplicate account_suspended notification
    currentNow = new Date('2026-12-04T10:05:00Z');
    const repeatSuspendRes = await request(app)
      .post(`/api/admin/users/${targetUser.id}/suspend`)
      .set(auth(modUser))
      .send({ reason: 'Incalcare regulament' });
    expect(repeatSuspendRes.status).toBe(200);
    const [suspendedNotifs] = await pool.query(
      "SELECT * FROM notifications WHERE user_id = ? AND type = 'account_suspended'",
      [targetUser.id],
    );
    expect(suspendedNotifs).toHaveLength(1);

    // 1. Suspended user's existing JWT is immediately blocked by requireAuth live DB check (403 ACCOUNT_SUSPENDED)
    const meBlocked = await request(app).get('/api/auth/me').set(auth(targetUser));
    expect(meBlocked.status).toBe(403);
    expect(meBlocked.body.error).toBe('ACCOUNT_SUSPENDED');

    // 2. targetDrivenRide is cancelled and otherPax's booking is cancelled + notified
    const targetRideDetails = await request(app).get(`/api/rides/${targetDrivenRide.id}`);
    expect(targetRideDetails.body.ride.status).toBe('cancelled');
    const otherPaxNotifs = await request(app).get('/api/notifications').set(auth(otherPax));
    expect(otherPaxNotifs.body.notifications.some((n) => n.type === 'ride_cancelled_moderation')).toBe(true);

    // 3. targetUser's booking on otherDrivenRide is cancelled, freeing the 1 seat on otherDrivenRide, and otherDriver is notified
    const otherRideDetails = await request(app).get(`/api/rides/${otherDrivenRide.id}`);
    expect(otherRideDetails.body.segments.every((s) => s.free_seats === 1)).toBe(true);
    const otherDriverNotifs = await request(app).get('/api/notifications').set(auth(otherDriver));
    expect(otherDriverNotifs.body.notifications.some((n) => n.type === 'booking_cancelled_moderation')).toBe(true);

    // 4. D-016 invariant: ZERO infractions and ZERO cancellation_fee_lei recorded for targetUser or anyone else
    const [infractions] = await pool.query('SELECT * FROM user_infractions');
    expect(infractions).toHaveLength(0);
    const [[cancelledPaxBooking]] = await pool.query('SELECT * FROM bookings WHERE id = ?', [
      bByTargetPax.body.booking.id,
    ]);
    expect(cancelledPaxBooking.status).toBe('cancelled');
    expect(cancelledPaxBooking.cancellation_fee_lei).toBeNull();

    // Unsuspend targetUser -> token works again
    const unsuspendRes = await request(app)
      .post(`/api/admin/users/${targetUser.id}/unsuspend`)
      .set(auth(modUser));
    expect(unsuspendRes.status).toBe(200);
    expect(unsuspendRes.body.user.is_suspended).toBe(false);
    await request(app).get('/api/auth/me').set(auth(targetUser)).expect(200);

    // Admin-only endpoints: moderator gets 403 on PATCH /api/admin/users/:id/role and GET /api/admin/stats
    await request(app)
      .patch(`/api/admin/users/${targetUser.id}/role`)
      .set(auth(modUser))
      .send({ role: 'moderator' })
      .expect(403);
    await request(app).get('/api/admin/stats').set(auth(modUser)).expect(403);

    // Admin promotes targetUser to moderator and views platform stats
    const roleRes = await request(app)
      .patch(`/api/admin/users/${targetUser.id}/role`)
      .set(auth(adminUser))
      .send({ role: 'moderator' });
    expect(roleRes.status).toBe(200);
    expect(roleRes.body.user.role).toBe('moderator');

    const statsRes = await request(app).get('/api/admin/stats').set(auth(adminUser));
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.stats.total_users).toBeGreaterThanOrEqual(5);

    // Moderator cannot retroactively cancel a ride that has already departed (409 RIDE_ALREADY_DEPARTED)
    // and lazy expirations on that departed ride are still committed before returning 409
    const pendingPaxOnOther = await createUser({ name: 'Pending Late' });
    currentNow = new Date('2026-12-04T11:00:00Z'); // 1h before otherDrivenRide departure (12:00Z)
    const bPendLate = await request(app)
      .post(`/api/rides/${otherDrivenRide.id}/bookings`)
      .set(auth(pendingPaxOnOther))
      .send({ pickup_stop_id: oStops[0].id, dropoff_stop_id: oStops[2].id });
    expect(bPendLate.status).toBe(201);

    currentNow = new Date('2026-12-04T13:00:00Z'); // after 12:00Z departure
    const modCancelPast = await request(app)
      .post(`/api/admin/rides/${otherDrivenRide.id}/cancel`)
      .set(auth(modUser))
      .send({ reason: 'Too late to cancel' });
    expect(modCancelPast.status).toBe(409);
    expect(modCancelPast.body.error).toBe('RIDE_ALREADY_DEPARTED');
    const [[reconciledBooking]] = await pool.query('SELECT status FROM bookings WHERE id = ?', [
      bPendLate.body.booking.id,
    ]);
    expect(reconciledBooking.status).toBe('expired');
  });
});
