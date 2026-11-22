// MySQL 8 integration & concurrency tests for transactional booking acceptance
// (D-003, D-005, D-007, D-010, D-019).
//
// Uses dedicated throwaway database `studride_test_bookings` so it never collides
// with `studride_test` in `database.test.js` under parallel Vitest execution.
// Skipped cleanly when MySQL is unreachable (e.g., sandbox without Docker).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
dotenv.config({ path: path.join(repo, '.env') });

const TEST_DB = 'studride_test_bookings';

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
  console.warn(`\n!!! MySQL unreachable (${e.code || e.message}): bookingAcceptance integration tests SKIPPED !!!\n`);
}

describe.skipIf(!admin)('integration: transactional booking acceptance (MySQL)', () => {
  let pool;
  let acceptBooking;
  let reconcileRideBookings;

  beforeAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}; CREATE DATABASE ${TEST_DB} CHARACTER SET utf8mb4`);
    const migrateConn = await mysql.createConnection(connOpts(TEST_DB));
    const { migrate } = await import('../database/migrate.js');
    await migrate(migrateConn);
    await migrateConn.end();

    pool = mysql.createPool({
      ...connOpts(TEST_DB),
      multipleStatements: false,
      waitForConnections: true,
      connectionLimit: 10,
    });

    const svc = await import('../src/services/bookingAcceptanceService.js');
    acceptBooking = svc.acceptBooking;
    reconcileRideBookings = svc.reconcileRideBookings;
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) await admin.end();
  });

  async function createUser(prefix) {
    const [res] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES (?, 'hash', ?)`,
      [`${prefix}-${Date.now()}-${Math.random()}@stud.ubbcluj.ro`, prefix],
    );
    return res.insertId;
  }

  async function createRideWithStops({ availableSeats = 2, declaredTripCost = 120, status = 'active', departureTime = '2026-12-10 16:00:00' } = {}) {
    const driverId = await createUser('driver');
    const [r] = await pool.query(
      `INSERT INTO rides (driver_id, origin_name, destination_name, departure_time,
         estimated_arrival_time, available_seats, declared_trip_cost, status)
       VALUES (?, 'Cluj-Napoca', 'Sibiu', ?, '2026-12-10 19:00:00', ?, ?, ?)`,
      [driverId, departureTime, availableSeats, declaredTripCost, status],
    );
    const rideId = r.insertId;
    const stopDefs = [
      [10, 'Cluj-Napoca', 0, '2026-12-10 16:00:00'],
      [20, 'Turda', 32, '2026-12-10 16:35:00'],
      [30, 'Alba Iulia', 98, '2026-12-10 17:30:00'],
      [40, 'Sibiu', 168, '2026-12-10 19:00:00'],
    ];
    const stopIds = [];
    for (const [order, city, km, eta] of stopDefs) {
      const [s] = await pool.query(
        `INSERT INTO ride_stops (ride_id, stop_order, city_name, location_name, latitude, longitude,
           distance_from_origin_km, estimated_arrival_time)
         VALUES (?, ?, ?, ?, 46.0, 23.5, ?, ?)`,
        [rideId, order, city, city, km, eta],
      );
      stopIds.push(s.insertId);
    }
    return { driverId, rideId, stopIds }; // [cluj, turda, alba, sibiu]
  }

  async function createBooking({ rideId, passengerId, pickupStopId, dropoffStopId, priceLei = 30, status = 'pending', reconfirmDeadline = null }) {
    const [res] = await pool.query(
      `INSERT INTO bookings (ride_id, passenger_id, pickup_stop_id, dropoff_stop_id, price_lei, status, reconfirm_deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [rideId, passengerId, pickupStopId, dropoffStopId, priceLei, status, reconfirmDeadline],
    );
    return res.insertId;
  }

  it('concurrency: two simultaneous acceptBooking calls for the last seat succeed for exactly 1 without overbooking', async () => {
    const { driverId, rideId, stopIds: [cluj, turda, alba, sibiu] } = await createRideWithStops({
      availableSeats: 1,
      declaredTripCost: 100,
    });
    const p1 = await createUser('p1');
    const p2 = await createUser('p2');
    const b1 = await createBooking({ rideId, passengerId: p1, pickupStopId: cluj, dropoffStopId: alba, priceLei: 30 });
    const b2 = await createBooking({ rideId, passengerId: p2, pickupStopId: turda, dropoffStopId: sibiu, priceLei: 35 });

    const now = new Date('2026-12-10T10:00:00Z');
    const results = await Promise.allSettled([
      acceptBooking(pool, { rideId, bookingId: b1, driverId, now }),
      acceptBooking(pool, { rideId, bookingId: b2, driverId, now }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const [rows] = await pool.query('SELECT id, status FROM bookings WHERE ride_id = ? ORDER BY id', [rideId]);
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['confirmed', 'rejected']);
  });

  it('selective auto-rejection: rejects competing pending on saturated segment, keeps non-saturated overlap pending', async () => {
    const { driverId, rideId, stopIds: [cluj, turda, alba, sibiu] } = await createRideWithStops({
      availableSeats: 2,
      declaredTripCost: 150,
    });
    const [p1, p2, p3, p4] = await Promise.all([
      createUser('sel1'), createUser('sel2'), createUser('sel3'), createUser('sel4'),
    ]);
    // Pre-existing confirmed booking on Turda->Alba (1 seat left on Turda->Alba, 2 left on Cluj->Turda & Alba->Sibiu)
    await createBooking({ rideId, passengerId: p1, pickupStopId: turda, dropoffStopId: alba, priceLei: 20, status: 'confirmed' });
    // Target to accept: Cluj->Alba (saturates Turda->Alba to 0; leaves Cluj->Turda at 1)
    const targetId = await createBooking({ rideId, passengerId: p2, pickupStopId: cluj, dropoffStopId: alba, priceLei: 30 });
    // Competing pending #1: Cluj->Turda (overlaps target on Cluj->Turda, still 1 free seat -> MUST STAY PENDING)
    const keepId = await createBooking({ rideId, passengerId: p3, pickupStopId: cluj, dropoffStopId: turda, priceLei: 10 });
    // Competing pending #2: Turda->Sibiu (traverses saturated Turda->Alba -> MUST BE AUTO-REJECTED + NOTIFIED)
    const rejectId = await createBooking({ rideId, passengerId: p4, pickupStopId: turda, dropoffStopId: sibiu, priceLei: 35 });

    const res = await acceptBooking(pool, {
      rideId, bookingId: targetId, driverId, now: new Date('2026-12-10T10:00:00Z'),
    });

    expect(res.acceptedBookingId).toBe(targetId);
    expect(res.autoRejectedIds).toEqual([rejectId]);
    expect(res.keptPendingIds).toEqual([keepId]);

    const [rows] = await pool.query('SELECT id, status FROM bookings WHERE id IN (?, ?, ?)', [targetId, keepId, rejectId]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[targetId]).toBe('confirmed');
    expect(byId[keepId]).toBe('pending');
    expect(byId[rejectId]).toBe('rejected');

    const [notifs] = await pool.query(
      'SELECT user_id, idempotency_key FROM notifications WHERE idempotency_key = ?',
      [`booking_auto_rejected:${rejectId}`],
    );
    expect(notifs).toHaveLength(1);
    expect(notifs[0].user_id).toBe(p4);
  });

  it('lazy pending_reconfirmation lapse frees capacity and notifies driver idempotently once', async () => {
    const { driverId, rideId, stopIds: [cluj, , , sibiu] } = await createRideWithStops({
      availableSeats: 1,
      declaredTripCost: 100,
    });
    const p1 = await createUser('lapse1');
    const p2 = await createUser('lapse2');
    const lapsedId = await createBooking({
      rideId,
      passengerId: p1,
      pickupStopId: cluj,
      dropoffStopId: sibiu,
      priceLei: 40,
      status: 'pending_reconfirmation',
      reconfirmDeadline: '2026-12-10 09:00:00',
    });
    const waitingId = await createBooking({
      rideId,
      passengerId: p2,
      pickupStopId: cluj,
      dropoffStopId: sibiu,
      priceLei: 40,
      status: 'pending',
    });

    const now = new Date('2026-12-10T10:00:00Z');
    const res = await acceptBooking(pool, { rideId, bookingId: waitingId, driverId, now });
    expect(res.acceptedBookingId).toBe(waitingId);
    expect(res.lapsedIds).toEqual([lapsedId]);

    // Verify lapsed booking transitioned to 'expired' (Assumption #1)
    const [[lapsedRow]] = await pool.query('SELECT status FROM bookings WHERE id = ?', [lapsedId]);
    expect(lapsedRow.status).toBe('expired');

    // Re-running reconcileRideBookings must NOT create duplicate driver notifications
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await reconcileRideBookings(conn, { rideId, now });
      await conn.commit();
    } finally {
      conn.release();
    }

    const [notifs] = await pool.query(
      'SELECT user_id, idempotency_key FROM notifications WHERE idempotency_key = ?',
      [`reconfirm_lapsed:${lapsedId}`],
    );
    expect(notifs).toHaveLength(1);
    expect(notifs[0].user_id).toBe(driverId);
  });

  it('enforces guards: wrong driver, inactive ride, soft-removed stop, and D-010 trip cost cap', async () => {
    const { driverId, rideId, stopIds: [cluj, turda, , sibiu] } = await createRideWithStops({
      availableSeats: 2,
      declaredTripCost: 50,
    });
    const otherDriver = await createUser('other');
    const p1 = await createUser('guard1');
    const p2 = await createUser('guard2');
    const b1 = await createBooking({ rideId, passengerId: p1, pickupStopId: cluj, dropoffStopId: sibiu, priceLei: 30 });
    const b2 = await createBooking({ rideId, passengerId: p2, pickupStopId: turda, dropoffStopId: sibiu, priceLei: 30 });

    const now = new Date('2026-12-10T10:00:00Z');

    // Wrong driver
    await expect(acceptBooking(pool, { rideId, bookingId: b1, driverId: otherDriver, now }))
      .rejects.toThrow(/FORBIDDEN|driver/i);

    // Accept b1 (30 <= 50) succeeds, then b2 (30 + 30 = 60 > 50) fails D-010 cost cap
    await acceptBooking(pool, { rideId, bookingId: b1, driverId, now });
    await expect(acceptBooking(pool, { rideId, bookingId: b2, driverId, now }))
      .rejects.toThrow(/TRIP_COST_CAP|cost cap/i);

    // Soft-removed pickup stop blocks acceptance
    await pool.query('UPDATE ride_stops SET removed_at = NOW() WHERE id = ?', [turda]);
    await pool.query('UPDATE rides SET declared_trip_cost = 200 WHERE id = ?', [rideId]);
    await expect(acceptBooking(pool, { rideId, bookingId: b2, driverId, now }))
      .rejects.toThrow(/STOP_REMOVED|removed/i);

    // Inactive ride blocks acceptance
    await pool.query('UPDATE ride_stops SET removed_at = NULL WHERE id = ?', [turda]);
    await pool.query("UPDATE rides SET status = 'cancelled' WHERE id = ?", [rideId]);
    await expect(acceptBooking(pool, { rideId, bookingId: b2, driverId, now }))
      .rejects.toThrow(/RIDE_NOT_ACTIVE|active/i);
  });
});
