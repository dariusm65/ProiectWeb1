// Supertest + MySQL 8 integration tests for Slice 4A: geocoding cache, ride publishing and
// details, spatial segment search, and recurring rides (rule + exceptions, materialised on
// demand) (D-003, D-005, D-006, D-009, D-010, D-016, D-017, D-018, D-020, C-001).
//
// Uses dedicated throwaway database `studride_test_rides` so it never collides with the other
// integration suites under parallel Vitest execution. Time is fixed through the injected
// `nowFn`, and Nominatim is always replaced by a mocked `fetchFn` (no live internet).
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import request from 'supertest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
dotenv.config({ path: path.join(repo, '.env') });

const TEST_DB = 'studride_test_rides';
const TEST_JWT_SECRET = 'studride-test-jwt-secret-key-at-least-32-chars';
// Tuesday 2026-12-01 11:00 Europe/Bucharest (UTC+2)
const NOW = new Date('2026-12-01T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

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
  console.warn(`\n!!! MySQL unreachable (${e.code || e.message}): rides/geocoding integration tests SKIPPED !!!\n`);
}

describe.skipIf(!admin)('integration: geocoding, rides, search & recurring rides (MySQL)', () => {
  let pool;
  let app;
  let signAccessToken;
  let calcPrice;
  let fetchFn;
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
    ({ calculateSegmentPrice: calcPrice } = await import('../src/domain/segmentPricing.js'));
    const { createApp } = await import('../src/app.js');
    fetchFn = vi.fn();
    app = createApp({
      pool,
      jwtSecret: TEST_JWT_SECRET,
      fetchFn: (...args) => fetchFn(...args),
      geocodingThrottleMs: 0,
      nowFn: () => NOW,
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
    fetchFn.mockReset();
    for (const t of [
      'notifications', 'reviews', 'chat_messages', 'bookings', 'user_infractions', 'ride_stops',
      'rides', 'recurring_ride_exceptions', 'recurring_rule_stops', 'recurring_ride_rules',
      'geocoding_cache', 'known_places',
    ]) {
      await pool.query(`DELETE FROM ${t}`);
    }
  });

  // ---------- helpers ----------
  async function createUser({ gender = 'prefer_not_to_say', domain = null, suspended = false, name } = {}) {
    userSeq += 1;
    const [res] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, university_domain, gender, is_suspended)
       VALUES (?, 'hash', ?, ?, ?, ?)`,
      [`u${userSeq}-${Date.now()}@example.com`, name ?? `User ${userSeq}`, domain, gender, suspended],
    );
    const id = res.insertId;
    return { id, token: signAccessToken({ id, role: 'user' }, TEST_JWT_SECRET) };
  }

  const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

  // Cluj -> Turda -> Alba Iulia -> Sibiu. Offsets are in minutes from departure.
  const STOP_DEFS = [
    ['Cluj-Napoca', 'Gara Cluj', 46.77, 23.6, 0, 0],
    ['Turda', 'Centru Turda', 46.57, 23.78, 32, 35],
    ['Alba Iulia', 'Gara Alba Iulia', 46.07, 23.57, 100, 110],
    ['Sibiu', 'Gara Sibiu', 45.79, 24.15, 160, 180],
  ];

  function ridePayload(dateStr = '2026-12-04', overrides = {}) {
    const base = new Date(`${dateStr}T16:00:00Z`).getTime(); // 18:00 local in winter
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

  function rulePayload(overrides = {}) {
    return {
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
      ...overrides,
    };
  }

  async function publish(user, dateStr, overrides) {
    const res = await request(app).post('/api/rides').set(auth(user)).send(ridePayload(dateStr, overrides));
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createRule(user, overrides) {
    const res = await request(app).post('/api/recurring-rides').set(auth(user)).send(rulePayload(overrides));
    expect(res.status).toBe(201);
    return res.body.rule.id;
  }

  async function addInfraction(userId, type, daysAgo, rideId = null) {
    await pool.query(
      `INSERT INTO user_infractions (user_id, ride_id, infraction_type, penalty_percentage_points, occurred_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, rideId, type, type === 'driver_late_cancel' ? 5 : 3, new Date(NOW.getTime() - daysAgo * DAY)],
    );
  }

  async function addBooking(rideId, passengerId, pickupStopId, dropoffStopId, status) {
    const [res] = await pool.query(
      `INSERT INTO bookings (ride_id, passenger_id, pickup_stop_id, dropoff_stop_id, price_lei, status)
       VALUES (?, ?, ?, ?, 10, ?)`,
      [rideId, passengerId, pickupStopId, dropoffStopId, status],
    );
    return res.insertId;
  }

  // Query for a trip from near Turda (S2) to near Sibiu (S4).
  const near = {
    originLat: 46.577, // ~0.78 km north of Turda stop
    originLng: 23.78,
    destLat: 45.7905,
    destLng: 24.15,
  };
  const search = (params) => request(app).get('/api/rides').query({ date: '2026-12-04', ...near, ...params });

  async function rideRows(where = '1=1', args = []) {
    const [rows] = await pool.query(`SELECT * FROM rides WHERE ${where}`, args);
    return rows;
  }

  // ---------- geocoding (D-009, C-001) ----------
  describe('geocoding', () => {
    const okSearch = () =>
      Promise.resolve({
        ok: true,
        json: async () => [{ lat: '45.7983', lon: '24.1256', display_name: 'Sibiu, Județul Sibiu, România' }],
      });

    it('forward: cache miss calls Nominatim once and persists; second lookup makes 0 external calls', async () => {
      fetchFn.mockImplementation(okSearch);
      const first = await request(app).get('/api/geocoding/search').query({ q: 'Sibiu Centru' });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ lat: 45.7983, lng: 24.1256, source: 'nominatim' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, init] = fetchFn.mock.calls[0];
      expect(String(url)).toContain('nominatim.openstreetmap.org/search');
      expect(init.headers['User-Agent']).toMatch(/StudRide/);

      const [cached] = await pool.query('SELECT query_hash FROM geocoding_cache');
      expect(cached).toHaveLength(1);
      expect(cached[0].query_hash).toMatch(/^[0-9a-f]{64}$/);

      const second = await request(app).get('/api/geocoding/search').query({ q: '  SIBIU   centru ' });
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ lat: 45.7983, lng: 24.1256, source: 'cache' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('reverse: miss then hit, with nearby coordinates collapsing to one cache key', async () => {
      fetchFn.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ lat: '45.7983', lon: '24.1256', display_name: 'Piața Mare, Sibiu' }),
        }),
      );
      const first = await request(app).get('/api/geocoding/reverse').query({ lat: 45.79831, lng: 24.12561 });
      expect(first.status).toBe(200);
      expect(first.body.source).toBe('nominatim');
      expect(String(fetchFn.mock.calls[0][0])).toContain('nominatim.openstreetmap.org/reverse');

      const second = await request(app).get('/api/geocoding/reverse').query({ lat: 45.79834, lng: 24.12564 });
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ source: 'cache', display_name: 'Piața Mare, Sibiu' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('forward: known_places with coordinates is answered without any external call', async () => {
      await pool.query(
        `INSERT INTO known_places (city, name, latitude, longitude, source) VALUES ('Timiș', 'Voiteg', 45.4, 21.5, 'test')`,
      );
      const res = await request(app).get('/api/geocoding/search').query({ q: 'voiteg' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ lat: 45.4, lng: 21.5, source: 'known_places' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('returns 502 on external failure and 404 on no result, caching neither', async () => {
      fetchFn.mockRejectedValueOnce(new Error('network down'));
      const down = await request(app).get('/api/geocoding/search').query({ q: 'Nowhere Town' });
      expect(down.status).toBe(502);
      expect(down.body.error).toBe('GEOCODING_UNAVAILABLE');

      fetchFn.mockResolvedValueOnce({ ok: true, json: async () => [] });
      const none = await request(app).get('/api/geocoding/search').query({ q: 'Nowhere Town' });
      expect(none.status).toBe(404);
      expect(none.body.error).toBe('GEOCODING_NOT_FOUND');

      const [rows] = await pool.query('SELECT COUNT(*) AS n FROM geocoding_cache');
      expect(rows[0].n).toBe(0);
    });

    it('validates q length and coordinate ranges with Zod', async () => {
      const bad = [
        ['/api/geocoding/search', {}],
        ['/api/geocoding/search', { q: ' a ' }],
        ['/api/geocoding/search', { q: 'x'.repeat(201) }],
        ['/api/geocoding/reverse', { lat: 91, lng: 10 }],
        ['/api/geocoding/reverse', { lat: -91, lng: 10 }],
        ['/api/geocoding/reverse', { lat: 10, lng: 181 }],
        ['/api/geocoding/reverse', { lat: 10, lng: -181 }],
        ['/api/geocoding/reverse', { lat: 10 }],
        ['/api/geocoding/reverse', { lat: '', lng: 10 }],
      ];
      for (const [url, query] of bad) {
        const res = await request(app).get(url).query(query);
        expect(res.status, `${url} ${JSON.stringify(query)}`).toBe(400);
      }
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  // ---------- publishing (D-003, D-016, D-018) ----------
  describe('POST /api/rides', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/rides').send(ridePayload());
      expect(res.status).toBe(401);
    });

    it('publishes a ride with server-assigned stop_order 10,20,30,40', async () => {
      const driver = await createUser();
      const body = await publish(driver);
      expect(body.stops.map((s) => s.stop_order)).toEqual([10, 20, 30, 40]);
      expect(body.ride).toMatchObject({
        origin_name: 'Cluj-Napoca',
        destination_name: 'Sibiu',
        available_seats: 2,
        status: 'active',
        women_only: false,
      });
      expect(new Date(body.ride.departure_time).toISOString()).toBe('2026-12-04T16:00:00.000Z');
      expect(new Date(body.ride.estimated_arrival_time).toISOString()).toBe('2026-12-04T19:00:00.000Z');
      const rows = await rideRows('id = ?', [body.ride.id]);
      expect(rows[0].driver_id).toBe(driver.id);
    });

    it('rejects invalid stop lists with 400', async () => {
      const driver = await createUser();
      const p = ridePayload();
      const cases = {
        'fewer than 2 stops': { ...p, stops: [p.stops[0]] },
        'first stop not at 0 km': { ...p, stops: p.stops.map((s, i) => (i === 0 ? { ...s, distance_from_origin_km: 3 } : s)) },
        'non-increasing distance': { ...p, stops: p.stops.map((s, i) => (i === 2 ? { ...s, distance_from_origin_km: 32 } : s)) },
        'non-increasing time': { ...p, stops: p.stops.map((s, i) => (i === 2 ? { ...s, estimated_arrival_time: p.stops[1].estimated_arrival_time } : s)) },
        'zero seats': { ...p, available_seats: 0 },
        'negative cost': { ...p, declared_trip_cost: -1 },
        'cost with 3 decimals': { ...p, declared_trip_cost: 10.123 },
        'bad latitude': { ...p, stops: p.stops.map((s, i) => (i === 1 ? { ...s, latitude: 95 } : s)) },
      };
      for (const [name, payload] of Object.entries(cases)) {
        const res = await request(app).post('/api/rides').set(auth(driver)).send(payload);
        expect(res.status, name).toBe(400);
      }
    });

    it('rejects a departure in the past with 400', async () => {
      const driver = await createUser();
      const res = await request(app).post('/api/rides').set(auth(driver)).send(ridePayload('2026-11-30'));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('DEPARTURE_IN_PAST');
    });

    it('D-018: only female accounts may publish women_only rides', async () => {
      for (const gender of ['male', 'prefer_not_to_say']) {
        const u = await createUser({ gender });
        const res = await request(app).post('/api/rides').set(auth(u)).send(ridePayload('2026-12-04', { women_only: true }));
        expect(res.status, gender).toBe(403);
        expect(res.body.error).toBe('WOMEN_ONLY_NOT_ALLOWED');
      }
      const woman = await createUser({ gender: 'female' });
      const body = await publish(woman, '2026-12-04', { women_only: true });
      expect(body.ride.women_only).toBe(true);
    });

    it('D-016: a driver_late_cancel within 7 days blocks publishing; older or passenger infractions do not', async () => {
      const banned = await createUser();
      await addInfraction(banned.id, 'driver_late_cancel', 3);
      const blocked = await request(app).post('/api/rides').set(auth(banned)).send(ridePayload());
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe('PUBLISHING_BANNED');

      const expired = await createUser();
      await addInfraction(expired.id, 'driver_late_cancel', 8);
      await publish(expired);

      const passengerOnly = await createUser();
      await addInfraction(passengerOnly.id, 'passenger_late_cancel', 1);
      await publish(passengerOnly);
    });
  });

  // ---------- details (D-005, D-010, D-016, SURVEY §4) ----------
  describe('GET /api/rides/:rideId', () => {
    it('returns stops, per-segment availability + price, driver summary and confirmed passengers (public)', async () => {
      const driver = await createUser({ domain: 'stud.ubbcluj.ro', name: 'Dana Driver' });
      const created = await publish(driver);
      const [s1, s2, s3, s4] = created.stops;
      const rideId = created.ride.id;

      const p1 = await createUser({ name: 'Paul Passenger', domain: 'ulbsibiu.ro' });
      const p2 = await createUser({ name: 'Pending Pete' });
      await addBooking(rideId, p1.id, s2.id, s3.id, 'confirmed');
      await addBooking(rideId, p2.id, s1.id, s4.id, 'pending');

      const r1 = await createUser();
      const r2 = await createUser();
      await pool.query(
        `INSERT INTO reviews (ride_id, reviewer_id, reviewed_user_id, rating_stars) VALUES (?, ?, ?, 4), (?, ?, ?, 5)`,
        [rideId, r1.id, driver.id, rideId, r2.id, driver.id],
      );
      await addInfraction(driver.id, 'driver_late_cancel', 10); // 95 + 1 week recovery = 96

      const res = await request(app).get(`/api/rides/${rideId}`); // no Authorization header
      expect(res.status).toBe(200);
      expect(res.body.stops.map((s) => s.stop_order)).toEqual([10, 20, 30, 40]);

      // Prices: seat full price 120/3 = 40; cum = 0, 8, 25, 40 => 8, 17, 15 (sum 40)
      expect(res.body.segments.map((s) => s.price_lei)).toEqual([8, 17, 15]);
      expect(res.body.segments.map((s) => s.free_seats)).toEqual([2, 1, 2]);
      expect(res.body.segments[0]).toMatchObject({
        price_lei: calcPrice({ declaredTripCost: '120.00', availableSeats: 2, pickupDistKm: 0, dropoffDistKm: 32, totalDistKm: 160 }),
        from_stop_id: s1.id,
        to_stop_id: s2.id,
      });

      expect(res.body.driver).toMatchObject({
        full_name: 'Dana Driver',
        has_university_badge: true,
        rating_average: 4.5,
        rating_count: 2,
        seriousness_score: 96,
      });
      expect(res.body.driver.university_badge_note).toMatch(/domain-validated/);
      expect(res.body.driver).not.toHaveProperty('email');

      expect(res.body.passengers).toHaveLength(1); // pending booking is not listed
      expect(res.body.passengers[0]).toEqual({
        full_name: 'Paul Passenger',
        has_university_badge: true,
        university_badge_note: expect.stringMatching(/domain-validated/),
        pickup_stop_name: 'Centru Turda',
        dropoff_stop_name: 'Gara Alba Iulia',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/@example\.com/);
    });

    it('returns 404 for an unknown ride and 400 for a malformed id', async () => {
      expect((await request(app).get('/api/rides/999999')).status).toBe(404);
      expect((await request(app).get('/api/rides/abc')).status).toBe(400);
    });

    it('lazily expires unanswered pending bookings on read (D-003) inside its own transaction', async () => {
      const driver = await createUser();
      const passenger = await createUser();
      const [r] = await pool.query(
        `INSERT INTO rides (driver_id, origin_name, destination_name, departure_time, estimated_arrival_time,
           available_seats, declared_trip_cost) VALUES (?, 'A', 'B', '2026-11-30 10:00:00', '2026-11-30 12:00:00', 2, 50)`,
        [driver.id],
      );
      const [s] = await pool.query(
        `INSERT INTO ride_stops (ride_id, stop_order, city_name, location_name, latitude, longitude, distance_from_origin_km, estimated_arrival_time)
         VALUES (?, 10, 'A', 'A', 45.0, 24.0, 0, '2026-11-30 10:00:00'), (?, 20, 'B', 'B', 45.5, 24.5, 50, '2026-11-30 12:00:00')`,
        [r.insertId, r.insertId],
      );
      const bookingId = await addBooking(r.insertId, passenger.id, s.insertId, s.insertId + 1, 'pending');

      const res = await request(app).get(`/api/rides/${r.insertId}`);
      expect(res.status).toBe(200);
      const [rows] = await pool.query('SELECT status FROM bookings WHERE id = ?', [bookingId]);
      expect(rows[0].status).toBe('expired');
    });
  });

  // ---------- spatial segment search (D-005, D-010, D-017, D-018) ----------
  describe('GET /api/rides (search)', () => {
    it('finds a ride with pickup/dropoff stops within 1 km and returns segment price + free seats', async () => {
      const driver = await createUser();
      const created = await publish(driver);
      const res = await search();
      expect(res.status).toBe(200);
      expect(res.body.rides).toHaveLength(1);
      const hit = res.body.rides[0];
      expect(hit.ride_id).toBe(created.ride.id);
      expect(hit.pickup_stop.location_name).toBe('Centru Turda');
      expect(hit.dropoff_stop.location_name).toBe('Gara Sibiu');
      expect(hit.free_seats).toBe(2);
      // cum(S4)=40, cum(S2)=8 => 32 lei
      expect(hit.segment_price_lei).toBe(32);
      expect(hit.pickup_distance_km).toBeLessThan(1);
      expect(hit.women_only).toBe(false);
    });

    it('applies the radius: ~2.9 km away is excluded at the 1 km default, included at 3 km and 5 km (D-017)', async () => {
      await publish(await createUser());
      const far = { originLat: 46.596 }; // ~2.9 km north of the Turda stop
      expect((await search(far)).body.rides).toHaveLength(0);
      expect((await search({ ...far, radiusKm: 1 })).body.rides).toHaveLength(0);
      expect((await search({ ...far, radiusKm: 3 })).body.rides).toHaveLength(1);
      expect((await search({ ...far, radiusKm: 5 })).body.rides).toHaveLength(1);
      // Drop-off ~5.6 km away stays out even at the max radius
      expect((await search({ destLat: 45.84, radiusKm: 5 })).body.rides).toHaveLength(0);
    });

    it('rejects radiusKm above 5 or non-positive, and invalid dates/coordinates, with 400', async () => {
      for (const params of [
        { radiusKm: 6 }, { radiusKm: 0 }, { radiusKm: -1 }, { radiusKm: 'abc' },
        { date: '2026-13-01' }, { date: '04-12-2026' }, { originLat: 91 }, { destLng: 200 },
      ]) {
        const res = await search(params);
        expect(res.status, JSON.stringify(params)).toBe(400);
      }
      const missing = await request(app).get('/api/rides').query({ date: '2026-12-04' });
      expect(missing.status).toBe(400);
    });

    it('requires pickup before dropoff, and matches only the requested Bucharest date', async () => {
      await publish(await createUser());
      const reversed = await search({
        originLat: near.destLat, originLng: near.destLng, destLat: near.originLat, destLng: near.originLng,
      });
      expect(reversed.body.rides).toHaveLength(0);
      expect((await search({ date: '2026-12-05' })).body.rides).toHaveLength(0);
      expect((await search({ date: '2026-12-03' })).body.rides).toHaveLength(0);
    });

    it('excludes saturated segments but still returns free sub-segments of the same ride', async () => {
      const driver = await createUser();
      const created = await publish(driver, '2026-12-04', { available_seats: 1 });
      const [, s2, s3] = created.stops;
      const passenger = await createUser();
      await addBooking(created.ride.id, passenger.id, s2.id, s3.id, 'confirmed');

      // Turda -> Sibiu crosses the saturated Turda -> Alba Iulia segment
      expect((await search()).body.rides).toHaveLength(0);

      // Alba Iulia -> Sibiu is still free
      const sub = await search({ originLat: 46.07, originLng: 23.57 });
      expect(sub.body.rides).toHaveLength(1);
      expect(sub.body.rides[0].free_seats).toBe(1);
      // 1 seat => full price 60; cum = 0, 12, 37.5->38, 60 => 60-38 = 22
      expect(sub.body.rides[0].segment_price_lei).toBe(22);
    });

    it('a pending booking does not consume capacity (D-003/D-005)', async () => {
      const created = await publish(await createUser(), '2026-12-04', { available_seats: 1 });
      const passenger = await createUser();
      await addBooking(created.ride.id, passenger.id, created.stops[1].id, created.stops[3].id, 'pending');
      const res = await search();
      expect(res.body.rides).toHaveLength(1);
      expect(res.body.rides[0].free_seats).toBe(1);
    });

    it('applies universityOnly, womenOnly, luggageAllowed, petsAllowed and smokingAllowed filters', async () => {
      const uniDriver = await createUser({ domain: 'ulbsibiu.ro' });
      const woman = await createUser({ gender: 'female' });
      const a = await publish(uniDriver, '2026-12-04', { luggage_allowed: true, pets_allowed: false, smoking_allowed: false });
      const b = await publish(woman, '2026-12-04', { luggage_allowed: false, pets_allowed: true, smoking_allowed: true, women_only: true });
      const ids = async (params) => (await search(params)).body.rides.map((r) => r.ride_id).sort((x, y) => x - y);
      const both = [a.ride.id, b.ride.id].sort((x, y) => x - y);

      expect(await ids({})).toEqual(both); // women_only rides stay visible (Q-B4)
      const all = (await search()).body.rides;
      expect(all.find((r) => r.ride_id === b.ride.id).women_only).toBe(true);

      expect(await ids({ universityOnly: 'true' })).toEqual([a.ride.id]);
      expect(await ids({ womenOnly: 'true' })).toEqual([b.ride.id]);
      expect(await ids({ womenOnly: 'false' })).toEqual([a.ride.id]);
      expect(await ids({ luggageAllowed: 'true' })).toEqual([a.ride.id]);
      expect(await ids({ luggageAllowed: 'false' })).toEqual([b.ride.id]);
      expect(await ids({ petsAllowed: 'true' })).toEqual([b.ride.id]);
      expect(await ids({ smokingAllowed: 'true' })).toEqual([b.ride.id]);
      expect(await ids({ smokingAllowed: 'false' })).toEqual([a.ride.id]);
      expect((await search({ petsAllowed: 'maybe' })).status).toBe(400);
    });
  });

  // ---------- recurring rides (D-006, D-016, D-018, D-020) ----------
  describe('recurring rides', () => {
    it('POST /api/recurring-rides stores rule + stops and enforces D-018 and the 7-day ban', async () => {
      const unauth = await request(app).post('/api/recurring-rides').send(rulePayload());
      expect(unauth.status).toBe(401);

      const man = await createUser({ gender: 'male' });
      const denied = await request(app).post('/api/recurring-rides').set(auth(man)).send(rulePayload({ women_only: true }));
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe('WOMEN_ONLY_NOT_ALLOWED');

      const banned = await createUser();
      await addInfraction(banned.id, 'driver_late_cancel', 2);
      const blocked = await request(app).post('/api/recurring-rides').set(auth(banned)).send(rulePayload());
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe('PUBLISHING_BANNED');

      const woman = await createUser({ gender: 'female' });
      const res = await request(app).post('/api/recurring-rides').set(auth(woman)).send(rulePayload({ women_only: true }));
      expect(res.status).toBe(201);
      expect(res.body.stops.map((s) => s.stop_order)).toEqual([10, 20, 30, 40]);
      const [rules] = await pool.query('SELECT * FROM recurring_ride_rules WHERE id = ?', [res.body.rule.id]);
      expect(rules[0].days_of_week).toEqual(['friday']);
      expect(rules[0].origin_name).toBe('Cluj-Napoca');
      const [stops] = await pool.query('SELECT COUNT(*) AS n FROM recurring_rule_stops WHERE rule_id = ?', [res.body.rule.id]);
      expect(stops[0].n).toBe(4);
    });

    it('rejects invalid rule payloads with 400', async () => {
      const driver = await createUser();
      const cases = [
        { days_of_week: [] },
        { days_of_week: ['funday'] },
        { departure_time: '25:00' },
        { start_date: '2027-02-01', end_date: '2027-01-01' },
      ];
      for (const c of cases) {
        const res = await request(app).post('/api/recurring-rides').set(auth(driver)).send(rulePayload(c));
        expect(res.status, JSON.stringify(c)).toBe(400);
      }
    });

    it('materialises exactly one instance per rule/date, idempotently and under concurrency', async () => {
      const driver = await createUser();
      const ruleId = await createRule(driver);

      const results = await Promise.all(
        Array.from({ length: 4 }, () => search({ date: '2026-12-04' })),
      );
      for (const r of results) {
        expect(r.status).toBe(200);
        expect(r.body.rides).toHaveLength(1);
      }
      await search({ date: '2026-12-04' });

      const instances = await rideRows('recurring_rule_id = ?', [ruleId]);
      expect(instances).toHaveLength(1);
      expect(new Date(instances[0].departure_time).toISOString()).toBe('2026-12-04T16:00:00.000Z');
      expect(new Date(instances[0].instance_date).toISOString().slice(0, 10)).toBe('2026-12-04');
      const [stops] = await pool.query('SELECT stop_order FROM ride_stops WHERE ride_id = ? ORDER BY stop_order', [instances[0].id]);
      expect(stops.map((s) => s.stop_order)).toEqual([10, 20, 30, 40]);
      expect(results[0].body.rides[0]).toMatchObject({ ride_id: instances[0].id, recurring_rule_id: ruleId, segment_price_lei: 32 });
    });

    it('does not materialise on non-matching weekdays or outside the rule range', async () => {
      const driver = await createUser();
      const ruleId = await createRule(driver);
      await search({ date: '2026-12-05' }); // Saturday
      await search({ date: '2027-02-05' }); // Friday but after end_date
      expect(await rideRows('recurring_rule_id = ?', [ruleId])).toHaveLength(0);
    });

    it('an exception before materialisation prevents the instance from ever being created', async () => {
      const driver = await createUser();
      const ruleId = await createRule(driver);
      const ex = await request(app)
        .post(`/api/recurring-rides/${ruleId}/exceptions`)
        .set(auth(driver))
        .send({ exception_date: '2026-12-11', reason: 'Vacanță' });
      expect(ex.status).toBe(201);
      expect(ex.body.cancelled_ride_id).toBeNull();
      expect(ex.body.infraction_recorded).toBe(false);

      const res = await search({ date: '2026-12-11' });
      expect(res.body.rides).toHaveLength(0);
      expect(await rideRows('recurring_rule_id = ?', [ruleId])).toHaveLength(0);
      // The following Friday is unaffected
      expect((await search({ date: '2026-12-18' })).body.rides).toHaveLength(1);
    });

    it('validates exception requests: auth, ownership, weekday/range, past date, duplicates', async () => {
      const driver = await createUser();
      const other = await createUser();
      const ruleId = await createRule(driver, { start_date: '2026-11-01' });
      const url = `/api/recurring-rides/${ruleId}/exceptions`;

      expect((await request(app).post(url).send({ exception_date: '2026-12-11' })).status).toBe(401);
      expect((await request(app).post(url).set(auth(other)).send({ exception_date: '2026-12-11' })).status).toBe(403);
      expect((await request(app).post(`/api/recurring-rides/999999/exceptions`).set(auth(driver)).send({ exception_date: '2026-12-11' })).status).toBe(404);
      expect((await request(app).post(url).set(auth(driver)).send({ exception_date: 'nope' })).status).toBe(400);

      const wrongDay = await request(app).post(url).set(auth(driver)).send({ exception_date: '2026-12-12' }); // Saturday
      expect(wrongDay.status).toBe(400);
      expect(wrongDay.body.error).toBe('DATE_NOT_IN_RULE');
      const past = await request(app).post(url).set(auth(driver)).send({ exception_date: '2026-11-27' }); // Friday, before now
      expect(past.status).toBe(400);

      expect((await request(app).post(url).set(auth(driver)).send({ exception_date: '2026-12-11' })).status).toBe(201);
      expect((await request(app).post(url).set(auth(driver)).send({ exception_date: '2026-12-11' })).status).toBe(409);
    });

    it('Q-B2: an exception after materialisation cancels the ride and ALL non-terminal bookings, notifying each once', async () => {
      const driver = await createUser();
      const ruleId = await createRule(driver);
      const found = (await search({ date: '2026-12-04' })).body.rides[0];
      const [ride] = await rideRows('id = ?', [found.ride_id]);
      const [stops] = await pool.query('SELECT id FROM ride_stops WHERE ride_id = ? ORDER BY stop_order', [ride.id]);

      const ids = {};
      for (const status of ['confirmed', 'pending_reconfirmation', 'pending', 'rejected']) {
        const p = await createUser();
        ids[status] = await addBooking(ride.id, p.id, stops[0].id, stops[3].id, status);
      }

      const ex = await request(app)
        .post(`/api/recurring-rides/${ruleId}/exceptions`)
        .set(auth(driver))
        .send({ exception_date: '2026-12-04' });
      expect(ex.status).toBe(201);
      expect(ex.body.cancelled_ride_id).toBe(ride.id);
      expect(ex.body.cancelled_bookings).toBe(3);
      expect(ex.body.infraction_recorded).toBe(false); // Dec 4 is not the departure day of "now" (Dec 1)

      expect((await rideRows('id = ?', [ride.id]))[0].status).toBe('cancelled');
      const [bookings] = await pool.query('SELECT id, status FROM bookings WHERE ride_id = ?', [ride.id]);
      const byId = Object.fromEntries(bookings.map((b) => [b.id, b.status]));
      expect(byId[ids.confirmed]).toBe('cancelled');
      expect(byId[ids.pending_reconfirmation]).toBe('cancelled');
      expect(byId[ids.pending]).toBe('cancelled');
      expect(byId[ids.rejected]).toBe('rejected');

      const [notifs] = await pool.query('SELECT user_id, idempotency_key FROM notifications');
      expect(notifs).toHaveLength(3);
      expect(new Set(notifs.map((n) => n.idempotency_key)).size).toBe(3);

      // retrying the same exception is a 409 and sends nothing more
      const retry = await request(app).post(`/api/recurring-rides/${ruleId}/exceptions`).set(auth(driver)).send({ exception_date: '2026-12-04' });
      expect(retry.status).toBe(409);
      const [after] = await pool.query('SELECT COUNT(*) AS n FROM notifications');
      expect(after[0].n).toBe(3);

      // the cancelled instance is no longer searchable and is never re-materialised
      expect((await search({ date: '2026-12-04' })).body.rides).toHaveLength(0);
      expect(await rideRows('recurring_rule_id = ?', [ruleId])).toHaveLength(1);
    });

    it('Q-B3: a same-day exception with a confirmed passenger records a driver_late_cancel and triggers the 7-day ban', async () => {
      const driver = await createUser();
      // 2026-12-01 is a Tuesday: departs 18:00 local (16:00Z), later than NOW (09:00Z) on the same Bucharest day
      const ruleId = await createRule(driver, { days_of_week: ['tuesday'] });
      const found = (await search({ date: '2026-12-01' })).body.rides[0];
      expect(found).toBeDefined();
      const [stops] = await pool.query('SELECT id FROM ride_stops WHERE ride_id = ? ORDER BY stop_order', [found.ride_id]);
      const passenger = await createUser();
      await addBooking(found.ride_id, passenger.id, stops[0].id, stops[3].id, 'confirmed');

      const ex = await request(app)
        .post(`/api/recurring-rides/${ruleId}/exceptions`)
        .set(auth(driver))
        .send({ exception_date: '2026-12-01' });
      expect(ex.status).toBe(201);
      expect(ex.body.infraction_recorded).toBe(true);

      const [inf] = await pool.query('SELECT * FROM user_infractions WHERE user_id = ?', [driver.id]);
      expect(inf).toHaveLength(1);
      expect(inf[0]).toMatchObject({ infraction_type: 'driver_late_cancel', penalty_percentage_points: 5, ride_id: found.ride_id });

      const blocked = await request(app).post('/api/rides').set(auth(driver)).send(ridePayload());
      expect(blocked.status).toBe(403);
      expect(blocked.body.error).toBe('PUBLISHING_BANNED');
    });

    it('Q-B3: a same-day exception with only a pending booking records no infraction', async () => {
      const driver = await createUser();
      const ruleId = await createRule(driver, { days_of_week: ['tuesday'] });
      const found = (await search({ date: '2026-12-01' })).body.rides[0];
      const [stops] = await pool.query('SELECT id FROM ride_stops WHERE ride_id = ? ORDER BY stop_order', [found.ride_id]);
      const passenger = await createUser();
      await addBooking(found.ride_id, passenger.id, stops[0].id, stops[3].id, 'pending');

      const ex = await request(app).post(`/api/recurring-rides/${ruleId}/exceptions`).set(auth(driver)).send({ exception_date: '2026-12-01' });
      expect(ex.status).toBe(201);
      expect(ex.body.infraction_recorded).toBe(false);
      expect(ex.body.cancelled_bookings).toBe(1);
      const [inf] = await pool.query('SELECT COUNT(*) AS n FROM user_infractions');
      expect(inf[0].n).toBe(0);
    });

    it('Q-B7: rules of suspended or 7-day-banned drivers are not materialised', async () => {
      const healthy = await createUser();
      const suspended = await createUser();
      const banned = await createUser();
      const healthyRule = await createRule(healthy);
      const suspendedRule = await createRule(suspended);
      const bannedRule = await createRule(banned);
      await pool.query('UPDATE users SET is_suspended = TRUE WHERE id = ?', [suspended.id]);
      await addInfraction(banned.id, 'driver_late_cancel', 2);

      const res = await search({ date: '2026-12-04' });
      expect(res.status).toBe(200);
      expect(res.body.rides).toHaveLength(1);
      expect(res.body.rides[0].recurring_rule_id).toBe(healthyRule);
      expect(await rideRows('recurring_rule_id = ?', [suspendedRule])).toHaveLength(0);
      expect(await rideRows('recurring_rule_id = ?', [bannedRule])).toHaveLength(0);

      // once the ban has lapsed the rule materialises again
      await pool.query('DELETE FROM user_infractions WHERE user_id = ?', [banned.id]);
      await addInfraction(banned.id, 'driver_late_cancel', 8);
      expect((await search({ date: '2026-12-04' })).body.rides).toHaveLength(2);
      expect(await rideRows('recurring_rule_id = ?', [bannedRule])).toHaveLength(1);
    });
  });

  // ---------- OpenAPI (D-002) ----------
  it('documents all Slice 4A endpoints in the OpenAPI spec', async () => {
    const res = await request(app).get('/api/openapi.json');
    const paths = Object.keys(res.body.paths);
    for (const p of [
      '/api/geocoding/search',
      '/api/geocoding/reverse',
      '/api/rides',
      '/api/rides/{rideId}',
      '/api/recurring-rides',
      '/api/recurring-rides/{ruleId}/exceptions',
    ]) {
      expect(paths).toContain(p);
    }
    expect(res.body.paths['/api/rides']).toHaveProperty('get');
    expect(res.body.paths['/api/rides']).toHaveProperty('post');
  });
});
