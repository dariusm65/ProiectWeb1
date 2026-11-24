// Supertest + MySQL 8 integration tests for Slice 4B:
// - Booking requests & driver decisions (POST /api/rides/:rideId/bookings, POST /api/bookings/:bookingId/accept,
//   POST /api/bookings/:bookingId/reject, GET /api/bookings/me, GET /api/rides/:rideId/bookings)
// - Driver stop/schedule editing & passenger reconfirmation (PATCH/PUT /api/rides/:rideId/stops,
//   POST /api/bookings/:bookingId/reconfirm) (D-007)
// - Passenger & driver cancellations, seriousness infractions, 30-day "Anulare recentă" badge,
//   and 7-day publishing ban (POST /api/bookings/:bookingId/cancel, POST /api/rides/:rideId/cancel) (D-016)
//
// Uses dedicated throwaway database `studride_test_bookings_api` (PATTERN-002) and injectable
// `nowFn` (PATTERN-003) so parallel Vitest suites never collide and time-sensitive guards are deterministic.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import request from 'supertest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
dotenv.config({ path: path.join(repo, '.env') });

const TEST_DB = 'studride_test_bookings_api';
const TEST_JWT_SECRET = 'studride-test-jwt-secret-key-at-least-32-chars';

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
  console.warn(`\n!!! MySQL unreachable (${e.code || e.message}): bookings HTTP integration tests SKIPPED !!!\n`);
}

describe.skipIf(!admin)('integration: bookings lifecycle, stop edits & cancellations (MySQL)', () => {
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
      'notifications', 'reviews', 'chat_messages', 'bookings', 'user_infractions', 'ride_stops',
      'rides', 'recurring_ride_exceptions', 'recurring_rule_stops', 'recurring_ride_rules',
      'geocoding_cache', 'known_places',
    ]) {
      await pool.query(`DELETE FROM ${t}`);
    }
  });

  async function createUser({ gender = 'prefer_not_to_say', domain = null, suspended = false, name } = {}) {
    userSeq += 1;
    const [res] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, university_domain, gender, is_suspended)
       VALUES (?, 'hash', ?, ?, ?, ?)`,
      [`u${userSeq}-${Date.now()}-${Math.random()}@example.com`, name ?? `User ${userSeq}`, domain, gender, suspended],
    );
    const id = res.insertId;
    return { id, token: signAccessToken({ id, role: 'user' }, TEST_JWT_SECRET) };
  }

  const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

  const STOP_DEFS = [
    ['Cluj-Napoca', 'Gara Cluj', 46.77, 23.6, 0, 0],
    ['Turda', 'Centru Turda', 46.57, 23.78, 32, 35],
    ['Alba Iulia', 'Gara Alba Iulia', 46.07, 23.57, 100, 110],
    ['Sibiu', 'Gara Sibiu', 45.79, 24.15, 160, 180],
  ];

  function ridePayload(dateStr = '2026-12-04', overrides = {}) {
    const base = new Date(`${dateStr}T16:00:00Z`).getTime(); // 18:00 Europe/Bucharest
    return {
      available_seats: 2,
      declared_trip_cost: 120,
      luggage_allowed: true,
      pets_allowed: false,
      smoking_allowed: false,
      women_only: false,
      stops: STOP_DEFS.map(([city, loc, lat, lng, km, offset]) => ({
        city_name: city,
        location_name: loc,
        latitude: lat,
        longitude: lng,
        distance_from_origin_km: km,
        estimated_arrival_time: new Date(base + offset * 60 * 1000).toISOString(),
      })),
      ...overrides,
    };
  }

  async function publish(user, dateStr = '2026-12-04', overrides = {}) {
    const res = await request(app).post('/api/rides').set(auth(user)).send(ridePayload(dateStr, overrides));
    expect(res.status).toBe(201);
    return res.body;
  }

  describe('1. Booking requests & driver decisions (D-003, D-005, D-010, D-011, D-018, D-019)', () => {
    it('creates a 1-seat pending booking with locked segment_price_lei, expires_at, and idempotent driver notification', async () => {
      const driver = await createUser({ name: 'Driver Dan', domain: 'ulbsibiu.ro' });
      const passenger = await createUser({ name: 'PassengerPaula', domain: 'stud.ubbcluj.ro' });
      const created = await publish(driver);
      const [, turda, , sibiu] = created.stops;

      const res = await request(app)
        .post(`/api/rides/${created.ride.id}/bookings`)
        .set(auth(passenger))
        .send({ pickup_stop_id: turda.id, dropoff_stop_id: sibiu.id });

      expect(res.status).toBe(201);
      // 120 / (2 + 1) = 40; cum(Sibiu 160/160)=40, cum(Turda 32/160)=8 => 32 lei
      expect(res.body.booking).toMatchObject({
        ride_id: created.ride.id,
        passenger_id: passenger.id,
        pickup_stop_id: turda.id,
        dropoff_stop_id: sibiu.id,
        price_lei: 32,
        segment_price_lei: 32,
        status: 'pending',
        reconfirm_deadline: null,
        cancellation_fee_lei: null,
      });
      expect(new Date(res.body.booking.expires_at).toISOString()).toBe('2026-12-04T16:00:00.000Z');

      const [notifs] = await pool.query(
        'SELECT user_id, type, idempotency_key FROM notifications WHERE idempotency_key = ?',
        [`booking_requested:${res.body.booking.id}`],
      );
      expect(notifs).toHaveLength(1);
      expect(notifs[0].user_id).toBe(driver.id);
    });

    it('enforces guards: auth, self-booking, D-018 women-only, duplicate active booking (D-019), stop order, and 0 free seats', async () => {
      const femaleDriver = await createUser({ gender: 'female' });
      const malePassenger = await createUser({ gender: 'male' });
      const anonPassenger = await createUser({ gender: 'prefer_not_to_say' });
      const femalePassenger = await createUser({ gender: 'female' });
      const femalePassenger2 = await createUser({ gender: 'female' });

      const created = await publish(femaleDriver, '2026-12-04', { women_only: true, available_seats: 1 });
      const [cluj, turda, alba, sibiu] = created.stops;
      const url = `/api/rides/${created.ride.id}/bookings`;

      // Unauthenticated -> 401
      expect((await request(app).post(url).send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id })).status).toBe(401);

      // Driver self-booking -> 403
      const selfRes = await request(app).post(url).set(auth(femaleDriver)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id });
      expect(selfRes.status).toBe(403);
      expect(selfRes.body.error).toBe('SELF_BOOKING_NOT_ALLOWED');

      // D-018 women_only: male and prefer_not_to_say -> 403
      for (const u of [malePassenger, anonPassenger]) {
        const denied = await request(app).post(url).set(auth(u)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id });
        expect(denied.status).toBe(403);
        expect(denied.body.error).toBe('WOMEN_ONLY_NOT_ALLOWED');
      }

      // Reversed or identical stops -> 400
      const rev = await request(app).post(url).set(auth(femalePassenger)).send({ pickup_stop_id: alba.id, dropoff_stop_id: turda.id });
      expect(rev.status).toBe(400);
      const same = await request(app).post(url).set(auth(femalePassenger)).send({ pickup_stop_id: turda.id, dropoff_stop_id: turda.id });
      expect(same.status).toBe(400);

      // Valid female booking -> 201
      const ok = await request(app).post(url).set(auth(femalePassenger)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id });
      expect(ok.status).toBe(201);

      // Duplicate non-terminal booking by same passenger on same ride -> 409 (D-019)
      const dup = await request(app).post(url).set(auth(femalePassenger)).send({ pickup_stop_id: turda.id, dropoff_stop_id: alba.id });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe('DUPLICATE_ACTIVE_BOOKING');

      // Accept first booking so the 1 seat is consumed, then a 2nd passenger on overlapping segment gets 409 NO_SEATS_AVAILABLE
      const acc = await request(app).post(`/api/bookings/${ok.body.booking.id}/accept`).set(auth(femaleDriver));
      expect(acc.status).toBe(200);

      const full = await request(app).post(url).set(auth(femalePassenger2)).send({ pickup_stop_id: turda.id, dropoff_stop_id: alba.id });
      expect(full.status).toBe(409);
      expect(full.body.error).toBe('NO_SEATS_AVAILABLE');
    });

    it('concurrency: simultaneous POST /api/bookings/:bookingId/accept race for the last seat confirms 1, auto-rejects saturated competitor, keeps non-saturated competitor pending, and sends idempotent notifications', async () => {
      const driver = await createUser();
      const [p1, p2, p3] = await Promise.all([createUser(), createUser(), createUser()]);
      const created = await publish(driver, '2026-12-04', { available_seats: 1, declared_trip_cost: 120 });
      const [cluj, turda, alba, sibiu] = created.stops;
      const rideId = created.ride.id;

      // b1: Cluj -> Alba, b2: Turda -> Sibiu (overlaps on Turda->Alba), b3: Alba -> Sibiu (overlaps b2, disjoint from b1)
      const b1 = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(p1)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: alba.id })).body.booking.id;
      const b2 = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(p2)).send({ pickup_stop_id: turda.id, dropoff_stop_id: sibiu.id })).body.booking.id;
      const b3 = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(p3)).send({ pickup_stop_id: alba.id, dropoff_stop_id: sibiu.id })).body.booking.id;

      const [r1, r2] = await Promise.all([
        request(app).post(`/api/bookings/${b1}/accept`).set(auth(driver)),
        request(app).post(`/api/bookings/${b2}/accept`).set(auth(driver)),
      ]);

      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      const winnerId = r1.status === 200 ? b1 : b2;
      const loserId = r1.status === 200 ? b2 : b1;

      const [rows] = await pool.query('SELECT id, status FROM bookings WHERE ride_id = ?', [rideId]);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
      expect(byId[winnerId]).toBe('confirmed');
      expect(byId[loserId]).toBe('rejected');
      if (winnerId === b1) {
        // b3 (Alba->Sibiu) is disjoint from b1 (Cluj->Alba), so it must remain pending
        expect(byId[b3]).toBe('pending');
      } else {
        // b2 covers Turda->Sibiu, saturating Alba->Sibiu too, so b3 is auto-rejected
        expect(byId[b3]).toBe('rejected');
      }

      const [accNotif] = await pool.query('SELECT * FROM notifications WHERE idempotency_key = ?', [`booking_accepted:${winnerId}`]);
      expect(accNotif).toHaveLength(1);
      const [rejNotif] = await pool.query('SELECT * FROM notifications WHERE idempotency_key = ?', [`booking_auto_rejected:${loserId}`]);
      expect(rejNotif).toHaveLength(1);
    });

    it('supports driver reject and GET /api/bookings/me + GET /api/rides/:rideId/bookings with lazy reconciliation', async () => {
      const driver = await createUser({ name: 'Driver D' });
      const p1 = await createUser({ name: 'Passenger One' });
      const p2 = await createUser({ name: 'Passenger Two' });
      const created = await publish(driver);
      const [cluj, turda, alba, sibiu] = created.stops;
      const rideId = created.ride.id;

      const b1 = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(p1)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: turda.id })).body.booking.id;
      const b2 = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(p2)).send({ pickup_stop_id: alba.id, dropoff_stop_id: sibiu.id })).body.booking.id;

      // Non-driver cannot reject or list ride bookings
      expect((await request(app).post(`/api/bookings/${b1}/reject`).set(auth(p2))).status).toBe(403);
      expect((await request(app).get(`/api/rides/${rideId}/bookings`).set(auth(p1))).status).toBe(403);

      // Driver rejects b1
      const rej = await request(app).post(`/api/bookings/${b1}/reject`).set(auth(driver));
      expect(rej.status).toBe(200);
      expect(rej.body.booking.status).toBe('rejected');

      const [notifs] = await pool.query('SELECT * FROM notifications WHERE idempotency_key = ?', [`booking_rejected:${b1}`]);
      expect(notifs).toHaveLength(1);
      expect(notifs[0].user_id).toBe(p1.id);

      // Rejected passenger can submit a new booking request on the same ride (A-3)
      const b1Retry = await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(p1)).send({ pickup_stop_id: turda.id, dropoff_stop_id: alba.id });
      expect(b1Retry.status).toBe(201);

      // Driver lists ride bookings
      const driverList = await request(app).get(`/api/rides/${rideId}/bookings`).set(auth(driver));
      expect(driverList.status).toBe(200);
      expect(driverList.body.bookings).toHaveLength(3);

      // Passenger lists own bookings
      const myList = await request(app).get('/api/bookings/me').set(auth(p1));
      expect(myList.status).toBe(200);
      expect(myList.body.bookings.map((b) => b.id)).toEqual([b1Retry.body.booking.id, b1]);
      expect(myList.body.bookings[0]).toMatchObject({
        pickup_stop_name: 'Centru Turda',
        dropoff_stop_name: 'Gara Alba Iulia',
        status: 'pending',
      });

      // Advance clock past departure -> GET /api/bookings/me lazily expires pending bookings
      currentNow = new Date('2026-12-04T16:05:00Z');
      const afterDep = await request(app).get('/api/bookings/me').set(auth(p2));
      expect(afterDep.status).toBe(200);
      expect(afterDep.body.bookings.find((b) => b.id === b2).status).toBe('expired');
    });
  });

  describe('2. Driver stop editing & passenger reconfirmation (D-007, D-010, D-011)', () => {
    it('D-007: adding a new stop transitions ONLY downstream-dropoff confirmed bookings to pending_reconfirmation and keeps locked price_lei immutable', async () => {
      const driver = await createUser();
      const pUpstream = await createUser();
      const pDownstream = await createUser();
      const created = await publish(driver);
      const [cluj, turda, alba, sibiu] = created.stops;
      const rideId = created.ride.id;

      // pUpstream books Cluj -> Turda (price 8 lei); pDownstream books Turda -> Sibiu (price 32 lei)
      const bUp = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pUpstream)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: turda.id })).body.booking;
      const bDown = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pDownstream)).send({ pickup_stop_id: turda.id, dropoff_stop_id: sibiu.id })).body.booking;
      await request(app).post(`/api/bookings/${bUp.id}/accept`).set(auth(driver));
      await request(app).post(`/api/bookings/${bDown.id}/accept`).set(auth(driver));

      // Driver inserts a new stop "Sebeș" between Alba Iulia and Sibiu (after Turda, before Sibiu)
      // and slightly increases total distance from 160 to 170 km
      const base = new Date('2026-12-04T16:00:00Z').getTime();
      const newStops = [
        { id: cluj.id, city_name: cluj.city_name, location_name: cluj.location_name, latitude: cluj.latitude, longitude: cluj.longitude, distance_from_origin_km: 0, estimated_arrival_time: cluj.estimated_arrival_time },
        { id: turda.id, city_name: turda.city_name, location_name: turda.location_name, latitude: turda.latitude, longitude: turda.longitude, distance_from_origin_km: 32, estimated_arrival_time: turda.estimated_arrival_time },
        { id: alba.id, city_name: alba.city_name, location_name: alba.location_name, latitude: alba.latitude, longitude: alba.longitude, distance_from_origin_km: 100, estimated_arrival_time: alba.estimated_arrival_time },
        { city_name: 'Sebeș', location_name: 'Centru Sebeș', latitude: 45.95, longitude: 23.57, distance_from_origin_km: 118, estimated_arrival_time: new Date(base + 130 * 60 * 1000).toISOString() },
        { id: sibiu.id, city_name: sibiu.city_name, location_name: sibiu.location_name, latitude: sibiu.latitude, longitude: sibiu.longitude, distance_from_origin_km: 160, estimated_arrival_time: sibiu.estimated_arrival_time },
      ];

      const editRes = await request(app)
        .patch(`/api/rides/${rideId}/stops`)
        .set(auth(driver))
        .send({ stops: newStops });
      expect(editRes.status).toBe(200);
      expect(editRes.body.stops.map((s) => s.stop_order)).toEqual([10, 20, 30, 40, 50]);

      const list = (await request(app).get(`/api/rides/${rideId}/bookings`).set(auth(driver))).body.bookings;
      const upAfter = list.find((b) => b.id === bUp.id);
      const downAfter = list.find((b) => b.id === bDown.id);

      // Upstream booking (Cluj -> Turda) is unaffected and stays confirmed
      expect(upAfter.status).toBe('confirmed');
      expect(upAfter.reconfirm_deadline).toBeNull();
      expect(upAfter.price_lei).toBe(bUp.price_lei);

      // Downstream booking (Turda -> Sibiu) transitions to pending_reconfirmation with deadline now + 6h
      expect(downAfter.status).toBe('pending_reconfirmation');
      expect(new Date(downAfter.reconfirm_deadline).toISOString()).toBe('2026-12-01T15:00:00.000Z');
      expect(downAfter.price_lei).toBe(bDown.price_lei); // immutable per D-007 / D-010

      // Passenger reconfirms on time -> returns to confirmed and notifies driver idempotently
      const reconf = await request(app).post(`/api/bookings/${bDown.id}/reconfirm`).set(auth(pDownstream));
      expect(reconf.status).toBe(200);
      expect(reconf.body.booking.status).toBe('confirmed');
      expect(reconf.body.booking.reconfirm_deadline).toBeNull();

      const [notifs] = await pool.query('SELECT * FROM notifications WHERE idempotency_key = ?', [`booking_reconfirmed:${bDown.id}`]);
      expect(notifs).toHaveLength(1);
      expect(notifs[0].user_id).toBe(driver.id);
    });

    it('D-007: soft-removing a stop preserves positive monotonic stop_order (so pending_reconfirmation still holds capacity), blocks reconfirm on removed pickup/dropoff (409 STOP_REMOVED), allows reconfirm on traversed removed stop, and auto-lapses when overdue', async () => {
      const driver = await createUser();
      const pPickupRemoved = await createUser();
      const pTraversed = await createUser();
      const created = await publish(driver, '2026-12-04', { available_seats: 2 });
      const [cluj, turda, alba, sibiu] = created.stops;
      const rideId = created.ride.id;

      // pPickupRemoved books Turda -> Sibiu; pTraversed books Cluj -> Sibiu (traverses Turda)
      const bPickup = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pPickupRemoved)).send({ pickup_stop_id: turda.id, dropoff_stop_id: sibiu.id })).body.booking;
      const bTrav = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pTraversed)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id })).body.booking;
      await request(app).post(`/api/bookings/${bPickup.id}/accept`).set(auth(driver));
      await request(app).post(`/api/bookings/${bTrav.id}/accept`).set(auth(driver));

      // Driver removes Turda and edits Alba Iulia distance from 100 to 110 km
      const editRes = await request(app)
        .put(`/api/rides/${rideId}/stops`)
        .set(auth(driver))
        .send({
          stops: [
            { id: cluj.id, city_name: cluj.city_name, location_name: cluj.location_name, latitude: cluj.latitude, longitude: cluj.longitude, distance_from_origin_km: 0, estimated_arrival_time: cluj.estimated_arrival_time },
            { id: alba.id, city_name: alba.city_name, location_name: alba.location_name, latitude: alba.latitude, longitude: alba.longitude, distance_from_origin_km: 110, estimated_arrival_time: alba.estimated_arrival_time },
            { id: sibiu.id, city_name: sibiu.city_name, location_name: sibiu.location_name, latitude: sibiu.latitude, longitude: sibiu.longitude, distance_from_origin_km: 160, estimated_arrival_time: sibiu.estimated_arrival_time },
          ],
        });
      expect(editRes.status).toBe(200);
      expect(editRes.body.stops.map((s) => s.id)).toEqual([cluj.id, alba.id, sibiu.id]);
      expect(editRes.body.stops.map((s) => s.stop_order)).toEqual([10, 20, 30]);

      // Guardrail 1 check: soft-removed Turda keeps a positive stop_order between Cluj (10) and Alba (20),
      // so both pending_reconfirmation bookings still consume capacity on active segments (0 free seats on Alba->Sibiu)
      const [[removedTurda]] = await pool.query('SELECT stop_order, removed_at FROM ride_stops WHERE id = ?', [turda.id]);
      expect(removedTurda.removed_at).not.toBeNull();
      expect(removedTurda.stop_order).toBeGreaterThan(10);
      expect(removedTurda.stop_order).toBeLessThan(20);
      expect(editRes.body.segments.map((s) => s.free_seats)).toEqual([0, 0]);

      // Dynamic segment prices on ride details recalculated from updated distance (110/160 -> 28 lei and 12 lei)
      expect(editRes.body.segments.map((s) => s.price_lei)).toEqual([28, 12]);

      // Passenger whose pickup stop (Turda) was removed gets 409 STOP_REMOVED on reconfirm
      const blockedReconf = await request(app).post(`/api/bookings/${bPickup.id}/reconfirm`).set(auth(pPickupRemoved));
      expect(blockedReconf.status).toBe(409);
      expect(blockedReconf.body.error).toBe('STOP_REMOVED');

      // Passenger who only traversed Turda (Cluj -> Sibiu) can reconfirm before the deadline
      const okReconf = await request(app).post(`/api/bookings/${bTrav.id}/reconfirm`).set(auth(pTraversed));
      expect(okReconf.status).toBe(200);
      expect(okReconf.body.booking.status).toBe('confirmed');

      // Advance clock past the 6h reconfirmation deadline -> overdue reconfirm attempt lazily lapses bPickup to expired and frees the seat
      currentNow = new Date('2026-12-01T16:00:00Z');
      const overdue = await request(app).post(`/api/bookings/${bPickup.id}/reconfirm`).set(auth(pPickupRemoved));
      expect(overdue.status).toBe(409);
      expect(overdue.body.error).toBe('BOOKING_NOT_PENDING_RECONFIRMATION');

      const [[lapsedRow]] = await pool.query('SELECT status FROM bookings WHERE id = ?', [bPickup.id]);
      expect(lapsedRow.status).toBe('expired');

      // Seat is now freed (1 occupied by bTrav, 1 free)
      const detailsAfterLapse = await request(app).get(`/api/rides/${rideId}`);
      expect(detailsAfterLapse.body.segments.map((s) => s.free_seats)).toEqual([1, 1]);
    });

    it('D-007 multi-edit & leading soft-removed stops: consecutive stop edits update reconfirm_deadline on existing pending_reconfirmation bookings, deliver notifications across repeated edit/reconfirm cycles, and preserve seat capacity when leading stops are soft-removed', async () => {
      const driver = await createUser();
      const pCycle = await createUser();
      const pLeading = await createUser();
      const created = await publish(driver, '2026-12-01', { available_seats: 2 });
      const [cluj, turda, alba, sibiu] = created.stops;
      const rideId = created.ride.id;

      // pCycle books Turda -> Sibiu; pLeading books Cluj -> Turda (the leading segment)
      const bCycle = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pCycle)).send({ pickup_stop_id: turda.id, dropoff_stop_id: sibiu.id })).body.booking;
      const bLeading = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pLeading)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: turda.id })).body.booking;
      await request(app).post(`/api/bookings/${bCycle.id}/accept`).set(auth(driver));
      await request(app).post(`/api/bookings/${bLeading.id}/accept`).set(auth(driver));

      // Edit #1 at 11:00Z (5h before 16:00Z departure -> deadline = min(17:00Z, 14:00Z) = 14:00Z):
      // Driver edits Alba Iulia location -> puts bCycle into pending_reconfirmation
      currentNow = new Date('2026-12-01T11:00:00Z');
      const edit1 = await request(app)
        .patch(`/api/rides/${rideId}/stops`)
        .set(auth(driver))
        .send({
          stops: created.stops.map((s) => ({
            id: s.id,
            city_name: s.city_name,
            location_name: s.id === alba.id ? 'Alba Autogară' : s.location_name,
            latitude: s.latitude,
            longitude: s.longitude,
            distance_from_origin_km: s.distance_from_origin_km,
            estimated_arrival_time: s.estimated_arrival_time,
          })),
        });
      expect(edit1.status).toBe(200);

      // pCycle reconfirms Edit #1 at 11:10Z
      currentNow = new Date('2026-12-01T11:10:00Z');
      expect((await request(app).post(`/api/bookings/${bCycle.id}/reconfirm`).set(auth(pCycle))).status).toBe(200);

      // Edit #2 at 11:30Z (still in the 14:00Z deadline clamp window for 16:00Z departure):
      // Driver edits Alba Iulia again -> bCycle transitions to pending_reconfirmation a 2nd time
      // and must receive a 2nd notification even though reconfirm_deadline ties at 14:00Z!
      currentNow = new Date('2026-12-01T11:30:00Z');
      const edit2 = await request(app)
        .patch(`/api/rides/${rideId}/stops`)
        .set(auth(driver))
        .send({
          stops: created.stops.map((s) => ({
            id: s.id,
            city_name: s.city_name,
            location_name: s.id === alba.id ? 'Alba Centru' : s.location_name,
            latitude: s.latitude,
            longitude: s.longitude,
            distance_from_origin_km: s.distance_from_origin_km,
            estimated_arrival_time: s.estimated_arrival_time,
          })),
        });
      expect(edit2.status).toBe(200);

      const [reconfNotifsAfterEdit2] = await pool.query(
        "SELECT * FROM notifications WHERE user_id = ? AND type = 'stop_edit_reconfirm_required'",
        [pCycle.id],
      );
      expect(reconfNotifsAfterEdit2).toHaveLength(2);

      // Edit #3 at 11:45Z BEFORE pCycle reconfirms Edit #2:
      // Driver moves departure earlier from 16:00Z to 13:00Z (<= 2h away: 1h15m out -> deadline = min(now+30m=12:15Z, 13:00Z) = 12:15Z)
      // AND replaces both Cluj (0 km) and Turda (32 km) with new stops NewCluj (0 km) and NewTurda (40 km).
      currentNow = new Date('2026-12-01T11:45:00Z');
      const newBase = new Date('2026-12-01T13:00:00Z').getTime();
      const edit3 = await request(app)
        .patch(`/api/rides/${rideId}/stops`)
        .set(auth(driver))
        .send({
          stops: [
            { city_name: 'Cluj-Napoca', location_name: 'Cluj Aeroport', latitude: 46.78, longitude: 23.68, distance_from_origin_km: 0, estimated_arrival_time: new Date(newBase).toISOString() },
            { city_name: 'Turda', location_name: 'Turda Autostradă', latitude: 46.55, longitude: 23.8, distance_from_origin_km: 40, estimated_arrival_time: new Date(newBase + 35 * 60 * 1000).toISOString() },
            { id: alba.id, city_name: alba.city_name, location_name: 'Alba Centru', latitude: alba.latitude, longitude: alba.longitude, distance_from_origin_km: 100, estimated_arrival_time: new Date(newBase + 90 * 60 * 1000).toISOString() },
            { id: sibiu.id, city_name: sibiu.city_name, location_name: sibiu.location_name, latitude: sibiu.latitude, longitude: sibiu.longitude, distance_from_origin_km: 160, estimated_arrival_time: new Date(newBase + 150 * 60 * 1000).toISOString() },
          ],
        });
      expect(edit3.status).toBe(200);

      // 1. Existing pending_reconfirmation booking bCycle had its reconfirm_deadline updated from 14:00Z to 12:15Z (before new 13:00Z departure)
      const listAfterEdit3 = (await request(app).get(`/api/rides/${rideId}/bookings`).set(auth(driver))).body.bookings;
      const bCycleAfter3 = listAfterEdit3.find((b) => b.id === bCycle.id);
      expect(bCycleAfter3.status).toBe('pending_reconfirmation');
      expect(new Date(bCycleAfter3.reconfirm_deadline).toISOString()).toBe('2026-12-01T12:15:00.000Z');

      // 2. Leading booking bLeading (Cluj 0 km -> Turda 32 km, both soft-removed before surviving Alba)
      //    is in pending_reconfirmation AND still reserves 1 seat on the first active segment [NewCluj(0km), NewTurda(40km))
      const bLeadingAfter3 = listAfterEdit3.find((b) => b.id === bLeading.id);
      expect(bLeadingAfter3.status).toBe('pending_reconfirmation');
      expect(edit3.body.segments[0].occupied_seats).toBe(1);
      expect(edit3.body.segments[0].free_seats).toBe(1);
    });
  });

  describe('3. Passenger & driver cancellations and D-016 seriousness infractions', () => {
    it('D-016 passenger cancel: early cancel (>= 4h) and pending_reconfirmation cancel (< 4h) incur no penalty; late cancel (< 4h) on confirmed booking records -3 pp infraction and 50% fee capped at 20 lei', async () => {
      const driver = await createUser();
      const pEarly = await createUser();
      const pLate = await createUser();
      const pReconf = await createUser();
      // High-cost ride so segment price is 50 lei -> 50% is 25 lei -> capped at 20 lei
      const created = await publish(driver, '2026-12-04', { available_seats: 3, declared_trip_cost: 200 });
      const [cluj, , , sibiu] = created.stops;
      const rideId = created.ride.id;

      const bEarly = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pEarly)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id })).body.booking;
      const bLate = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pLate)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id })).body.booking;
      const bReconf = (await request(app).post(`/api/rides/${rideId}/bookings`).set(auth(pReconf)).send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id })).body.booking;

      await request(app).post(`/api/bookings/${bEarly.id}/accept`).set(auth(driver));
      await request(app).post(`/api/bookings/${bLate.id}/accept`).set(auth(driver));
      await request(app).post(`/api/bookings/${bReconf.id}/accept`).set(auth(driver));

      // 1. Early cancel (3 days before departure) -> 0 fee, 0 infractions
      const earlyRes = await request(app).post(`/api/bookings/${bEarly.id}/cancel`).set(auth(pEarly));
      expect(earlyRes.status).toBe(200);
      expect(earlyRes.body.booking).toMatchObject({ status: 'cancelled', cancellation_fee_lei: null });
      expect(earlyRes.body.infraction_recorded).toBe(false);

      // Put bReconf into pending_reconfirmation via a stop edit, then advance to 2 hours before departure (< 4h)
      currentNow = new Date('2026-12-04T14:00:00Z'); // 2h before 16:00Z departure
      const editedStops = created.stops.map((s, idx) => ({
        id: s.id,
        city_name: s.city_name,
        location_name: idx === 1 ? 'Turda Nouă' : s.location_name,
        latitude: s.latitude,
        longitude: s.longitude,
        distance_from_origin_km: s.distance_from_origin_km,
        estimated_arrival_time: s.estimated_arrival_time,
      }));
      await request(app).patch(`/api/rides/${rideId}/stops`).set(auth(driver)).send({ stops: editedStops });
      // pLate reconfirms back to 'confirmed', while pReconf stays in 'pending_reconfirmation'
      await request(app).post(`/api/bookings/${bLate.id}/reconfirm`).set(auth(pLate));

      // 2. Cancelling while in pending_reconfirmation < 4h before departure -> exempt from penalty & fee
      const reconfCancel = await request(app).post(`/api/bookings/${bReconf.id}/cancel`).set(auth(pReconf));
      expect(reconfCancel.status).toBe(200);
      expect(reconfCancel.body.infraction_recorded).toBe(false);
      expect(reconfCancel.body.booking.cancellation_fee_lei).toBeNull();

      // 3. Cancelling a confirmed booking < 4h before departure -> passenger_late_cancel (-3 pp) & 20 lei capped fee
      const lateRes = await request(app).post(`/api/bookings/${bLate.id}/cancel`).set(auth(pLate));
      expect(lateRes.status).toBe(200);
      expect(lateRes.body.infraction_recorded).toBe(true);
      expect(lateRes.body.booking).toMatchObject({
        status: 'cancelled',
        price_lei: 50,
        cancellation_fee_lei: 20,
      });

      const [infractions] = await pool.query('SELECT * FROM user_infractions WHERE user_id = ?', [pLate.id]);
      expect(infractions).toHaveLength(1);
      expect(infractions[0]).toMatchObject({
        infraction_type: 'passenger_late_cancel',
        penalty_percentage_points: 3,
        ride_id: rideId,
      });
    });

    it('D-016 driver ride cancel: cancels all non-terminal bookings, notifies passengers, records driver_late_cancel ONLY on departure day with seat-holding passengers, exposes 30-day has_recent_cancellation_badge, and enforces 7-day publishing ban', async () => {
      const driver = await createUser();
      const pConfirmed = await createUser();
      const pPending = await createUser();

      // Ride 1: departs on 2026-12-04 (not today, 2026-12-01) with a confirmed passenger -> NO infraction
      const futureRide = await publish(driver, '2026-12-04');
      const bFuture = (await request(app).post(`/api/rides/${futureRide.ride.id}/bookings`).set(auth(pConfirmed)).send({
        pickup_stop_id: futureRide.stops[0].id,
        dropoff_stop_id: futureRide.stops[3].id,
      })).body.booking;
      await request(app).post(`/api/bookings/${bFuture.id}/accept`).set(auth(driver));

      const cancelEarly = await request(app).post(`/api/rides/${futureRide.ride.id}/cancel`).set(auth(driver));
      expect(cancelEarly.status).toBe(200);
      expect(cancelEarly.body).toMatchObject({
        cancelled_ride_id: futureRide.ride.id,
        cancelled_bookings: 1,
        infraction_recorded: false,
      });

      // Ride 2: departs today (2026-12-01 16:00Z) with ONLY a pending booking -> NO infraction
      const todayPendingOnly = await publish(driver, '2026-12-01');
      await request(app).post(`/api/rides/${todayPendingOnly.ride.id}/bookings`).set(auth(pPending)).send({
        pickup_stop_id: todayPendingOnly.stops[0].id,
        dropoff_stop_id: todayPendingOnly.stops[3].id,
      });
      const cancelPendingOnly = await request(app).post(`/api/rides/${todayPendingOnly.ride.id}/cancel`).set(auth(driver));
      expect(cancelPendingOnly.status).toBe(200);
      expect(cancelPendingOnly.body.infraction_recorded).toBe(false);

      // Ride 3 (already published before ban): departs later today (2026-12-01 16:00Z) with a confirmed passenger -> records driver_late_cancel
      const todayConfirmed = await publish(driver, '2026-12-01');
      const alsoPublishedFuture = await publish(driver, '2026-12-05');
      const bToday = (await request(app).post(`/api/rides/${todayConfirmed.ride.id}/bookings`).set(auth(pConfirmed)).send({
        pickup_stop_id: todayConfirmed.stops[0].id,
        dropoff_stop_id: todayConfirmed.stops[3].id,
      })).body.booking;
      await request(app).post(`/api/bookings/${bToday.id}/accept`).set(auth(driver));

      // Before late cancel: driver has no recent cancellation badge and score 100
      const beforeDetails = await request(app).get(`/api/rides/${alsoPublishedFuture.ride.id}`);
      expect(beforeDetails.body.driver).toMatchObject({
        seriousness_score: 100,
        has_recent_cancellation_badge: false,
      });

      const cancelLate = await request(app).post(`/api/rides/${todayConfirmed.ride.id}/cancel`).set(auth(driver));
      expect(cancelLate.status).toBe(200);
      expect(cancelLate.body).toMatchObject({
        cancelled_ride_id: todayConfirmed.ride.id,
        cancelled_bookings: 1,
        infraction_recorded: true,
      });

      // Driver now has score 95, has_recent_cancellation_badge = true on ride details and search results, and 7-day publishing ban
      const afterDetails = await request(app).get(`/api/rides/${alsoPublishedFuture.ride.id}`);
      expect(afterDetails.body.driver).toMatchObject({
        seriousness_score: 95,
        has_recent_cancellation_badge: true,
      });

      const searchRes = await request(app).get('/api/rides').query({
        date: '2026-12-05',
        originLat: 46.57,
        originLng: 23.78,
        destLat: 45.79,
        destLng: 24.15,
      });
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.rides[0].driver.has_recent_cancellation_badge).toBe(true);

      const bannedPublish = await request(app).post('/api/rides').set(auth(driver)).send(ridePayload('2026-12-06'));
      expect(bannedPublish.status).toBe(403);
      expect(bannedPublish.body.error).toBe('PUBLISHING_BANNED');
    });
  });

  describe('4. Driver dashboard batched reads & post-arrival ride completion (GET /api/rides/me, GET /api/recurring-rides/me, POST /api/rides/:rideId/complete)', () => {
    it('lists driver rides with batched stops, segments, and zero-PII bookings, lists recurring rules with exceptions, and marks ride completed only after estimated_arrival_time', async () => {
      const driver = await createUser({ name: 'Driver Diana', domain: 'ulbsibiu.ro' });
      const otherDriver = await createUser({ name: 'Other Driver' });
      const pax = await createUser({ name: 'Pax Paul', domain: 'stud.ubbcluj.ro' });

      const created = await publish(driver, '2026-12-04');
      await publish(otherDriver, '2026-12-05');
      const [cluj, , , sibiu] = created.stops;
      const rideId = created.ride.id;

      const bRes = await request(app)
        .post(`/api/rides/${rideId}/bookings`)
        .set(auth(pax))
        .send({ pickup_stop_id: cluj.id, dropoff_stop_id: sibiu.id });
      expect(bRes.status).toBe(201);
      await request(app).post(`/api/bookings/${bRes.body.booking.id}/accept`).set(auth(driver)).expect(200);

      // GET /api/rides/me returns only driver's rides with stops, segments, and non-PII bookings
      const myRidesRes = await request(app).get('/api/rides/me').set(auth(driver));
      expect(myRidesRes.status).toBe(200);
      expect(myRidesRes.body.rides).toHaveLength(1);
      const item = myRidesRes.body.rides[0];
      expect(item.ride.id).toBe(rideId);
      expect(item.stops).toHaveLength(4);
      expect(item.segments).toHaveLength(3);
      expect(item.bookings).toHaveLength(1);
      expect(item.bookings[0].passenger.full_name).toBe('Pax Paul');
      expect(item.bookings[0].passenger.email).toBeUndefined();
      expect(item.bookings[0].passenger.phone).toBeUndefined();
      expect(item.bookings[0].passenger.gender).toBeUndefined();
      expect(item.bookings[0].passenger.password_hash).toBeUndefined();
      expect(item.bookings[0].ride.driver_name).toBe('Driver Diana');

      // Recurring rule + exception listed via GET /api/recurring-rides/me
      const ruleRes = await request(app)
        .post('/api/recurring-rides')
        .set(auth(driver))
        .send({
          departure_time: '18:00',
          start_date: '2026-12-01',
          end_date: '2027-01-31',
          days_of_week: ['friday'],
          available_seats: 2,
          declared_trip_cost: 120,
          luggage_allowed: true,
          pets_allowed: false,
          smoking_allowed: false,
          women_only: false,
          stops: STOP_DEFS.map(([city, loc, lat, lng, km, offset]) => ({
            city_name: city,
            location_name: loc,
            latitude: lat,
            longitude: lng,
            distance_from_origin_km: km,
            estimated_offset_minutes: offset,
          })),
        });
      expect(ruleRes.status).toBe(201);
      const ruleId = ruleRes.body.rule.id;
      await request(app)
        .post(`/api/recurring-rides/${ruleId}/exceptions`)
        .set(auth(driver))
        .send({ exception_date: '2026-12-11', reason: 'Sesiune' })
        .expect(201);

      const myRulesRes = await request(app).get('/api/recurring-rides/me').set(auth(driver));
      expect(myRulesRes.status).toBe(200);
      expect(myRulesRes.body.rules).toHaveLength(1);
      expect(myRulesRes.body.rules[0].rule.id).toBe(ruleId);
      expect(myRulesRes.body.rules[0].stops).toHaveLength(4);
      expect(myRulesRes.body.rules[0].exceptions).toHaveLength(1);
      expect(myRulesRes.body.rules[0].exceptions[0].exception_date).toBe('2026-12-11');

      // POST /api/rides/:rideId/complete blocked before estimated_arrival_time (2026-12-04T19:00:00Z)
      const earlyComplete = await request(app).post(`/api/rides/${rideId}/complete`).set(auth(driver));
      expect(earlyComplete.status).toBe(409);
      expect(earlyComplete.body.error).toBe('RIDE_BEFORE_ARRIVAL');

      // Non-driver cannot complete ride -> 403
      currentNow = new Date('2026-12-04T19:05:00Z');
      expect((await request(app).post(`/api/rides/${rideId}/complete`).set(auth(otherDriver))).status).toBe(403);

      // Driver marks ride completed after arrival -> 200
      const completeRes = await request(app).post(`/api/rides/${rideId}/complete`).set(auth(driver));
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.ride.status).toBe('completed');

      // Repeating complete on already-completed ride -> 409 RIDE_NOT_ACTIVE
      expect((await request(app).post(`/api/rides/${rideId}/complete`).set(auth(driver))).status).toBe(409);
    });
  });
});
