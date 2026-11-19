// Tests for the DB schema, migration runner and seed (plan: docs/plans/db-schema-and-migrations.md).
//
// Two groups:
//  - "static" tests read repo files only (no DB needed) and enforce the seed conditions.
//  - "integration" tests need MySQL 8 (docker compose up -d). They connect with
//    TEST_DB_USER / TEST_DB_PASSWORD (default root / DB_ROOT_PASSWORD) and use the
//    throwaway database `studride_test`, which is dropped and recreated.
//    If MySQL is unreachable they are SKIPPED and the skip is printed loudly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..');
const repo = path.resolve(backend, '..');
dotenv.config({ path: path.join(repo, '.env') });

const read = (p) => fs.readFileSync(p, 'utf8');
const TEST_DB = 'studride_test';
const EXPECTED_TABLES = [
  'schema_migrations', 'users', 'known_places', 'recurring_ride_rules',
  'recurring_rule_stops', 'recurring_ride_exceptions', 'rides', 'ride_stops',
  'bookings', 'chat_messages', 'notifications', 'reviews', 'user_infractions',
  'reports', 'geocoding_cache',
];

// ---------------------------------------------------------------- static tests
describe('static: seed conditions', () => {
  const seedSql = () => read(path.join(backend, 'database/seeds/001_seed_initial.sql'));
  const seedJs = () => read(path.join(backend, 'database/seed.js'));

  it('seeds only places listed in SURVEY.md', () => {
    const survey = read(path.join(repo, 'SURVEY.md'));
    const names = [...seedSql().matchAll(/^\s*\('([^']+)',\s*'([^']+)'/gm)].map((m) => m[2]);
    expect(names.length).toBeGreaterThan(30);
    for (const n of names) expect(survey, `"${n}" not in SURVEY.md`).toContain(n);
    for (const bad of ['Hașdeu', 'Iulius', 'Piața Romană', 'Politehnica', 'Dumbrăvii'])
      expect(seedSql()).not.toContain(bad);
  });

  it('never writes coordinates from memory: only NULL or recorded Nominatim queries', () => {
    // any decimal-looking coordinate literal in the seed is forbidden here
    expect(seedSql()).not.toMatch(/\b\d{1,3}\.\d{3,}\b/);
    expect(seedSql()).toContain('TODO-fill-from-Nominatim');
  });

  it('uses neutral system accounts and never commits a password or hash', () => {
    expect(seedJs()).toContain('admin@studride.local');
    expect(seedJs()).toContain('moderator@studride.local');
    expect(seedJs()).toContain('process.env.ADMIN_PASSWORD');
    expect(seedJs()).toContain('process.env.MODERATOR_PASSWORD');
    expect(seedJs()).toMatch(/bcrypt/);
    for (const f of [seedJs(), seedSql()]) {
      expect(f).not.toMatch(/\$2[aby]\$\d\d\$/); // bcrypt hash literal
      expect(f).not.toMatch(/@ulbsibiu\.ro/);
    }
  });

  it('.env.example has placeholders for the passwords', () => {
    const env = read(path.join(repo, '.env.example'));
    expect(env).toMatch(/^ADMIN_PASSWORD=/m);
    expect(env).toMatch(/^MODERATOR_PASSWORD=/m);
    expect(env).toMatch(/^JWT_SECRET=/m);
  });

  it('.env is git-ignored', () => {
    expect(read(path.join(repo, '.gitignore'))).toMatch(/^\.env$/m);
  });

  it('migration 001 defines the 15 tables, removed_at and instance_date unique key', () => {
    const sql = read(path.join(backend, 'database/migrations/001_initial_schema.sql'));
    expect(sql.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(15);
    expect(sql).toContain('removed_at');
    expect(sql).toMatch(/UNIQUE KEY uq_rule_instance \(recurring_rule_id, instance_date\)/);
    expect(sql).not.toMatch(/num_seats/);
  });
});

// ----------------------------------------------------------- integration tests
async function connect(database) {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD ?? process.env.DB_ROOT_PASSWORD ?? '',
    database,
    multipleStatements: true,
  });
}

let admin = null;
try {
  admin = await connect(undefined);
} catch (e) {
  console.warn(`\n!!! MySQL unreachable (${e.code || e.message}): integration tests SKIPPED !!!\n`);
}

describe.skipIf(!admin)('integration: migrations and seed (MySQL)', () => {
  let db;
  let migrateMod;
  let seedMod;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = 'test-admin-pass';
    process.env.MODERATOR_PASSWORD = 'test-moderator-pass';
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}; CREATE DATABASE ${TEST_DB} CHARACTER SET utf8mb4`);
    db = await connect(TEST_DB);
    migrateMod = await import('../database/migrate.js');
    seedMod = await import('../database/seed.js');
  });

  afterAll(async () => {
    if (db) await db.end();
    if (admin) await admin.end();
  });

  it('migrate() creates schema_migrations and applies 001 once (re-run is a no-op)', async () => {
    const first = await migrateMod.migrate(db);
    expect(first).toContain('001_initial_schema.sql');
    const second = await migrateMod.migrate(db);
    expect(second).toEqual([]);
    const [rows] = await db.query('SELECT version FROM schema_migrations');
    expect(rows.map((r) => r.version)).toEqual(['001_initial_schema.sql']);
  });

  it('creates exactly the 15 expected tables', async () => {
    const [rows] = await db.query(
      'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [TEST_DB]);
    expect(rows.map((r) => r.t).sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('seed is idempotent: two runs leave identical row counts', async () => {
    await seedMod.seed(db);
    const count = async (t) => (await db.query(`SELECT COUNT(*) c FROM ${t}`))[0][0].c;
    const before = [await count('users'), await count('known_places')];
    await seedMod.seed(db);
    const after = [await count('users'), await count('known_places')];
    expect(after).toEqual(before);
    expect(before[0]).toBe(2); // admin + moderator only, no fake users
    expect(await count('rides')).toBe(0);
  });

  it('seed hashes passwords with bcrypt at runtime and sets roles', async () => {
    const [rows] = await db.query('SELECT email, role, password_hash FROM users ORDER BY email');
    expect(rows.map((r) => [r.email, r.role])).toEqual([
      ['admin@studride.local', 'admin'],
      ['moderator@studride.local', 'moderator'],
    ]);
    for (const r of rows) {
      expect(r.password_hash).toMatch(/^\$2[aby]\$/);
      expect(r.password_hash).not.toContain('test-');
    }
  });

  it('seed refuses to run without ADMIN_PASSWORD / MODERATOR_PASSWORD', async () => {
    const saved = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    await expect(seedMod.seed(db)).rejects.toThrow(/ADMIN_PASSWORD/);
    process.env.ADMIN_PASSWORD = saved;
  });

  it('known_places has no invented coordinates (NULL until filled from Nominatim)', async () => {
    const [rows] = await db.query(
      'SELECT COUNT(*) c FROM known_places WHERE latitude IS NOT NULL AND source_query IS NULL');
    expect(rows[0].c).toBe(0);
  });

  async function newRide() {
    const [u] = await db.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES (?, 'x', 'T')`,
      [`t${Date.now()}${Math.random()}@example.com`]);
    const [r] = await db.query(
      `INSERT INTO rides (driver_id, origin_name, destination_name, departure_time,
         estimated_arrival_time, available_seats, declared_trip_cost)
       VALUES (?, 'A', 'B', '2026-12-01 17:00:00', '2026-12-01 20:00:00', 3, 60)`, [u.insertId]);
    return { driverId: u.insertId, rideId: r.insertId };
  }
  const addStop = (rideId, order, name) => db.query(
    `INSERT INTO ride_stops (ride_id, stop_order, city_name, location_name, latitude, longitude,
       distance_from_origin_km, estimated_arrival_time)
     VALUES (?, ?, ?, ?, 0, 0, ?, '2026-12-01 18:00:00')`, [rideId, order, name, name, order]);

  it('allows inserting a stop between orders 10 and 20', async () => {
    const { rideId } = await newRide();
    await addStop(rideId, 10, 'S1');
    await addStop(rideId, 20, 'S2');
    await addStop(rideId, 15, 'Mid');
    const [rows] = await db.query(
      'SELECT city_name FROM ride_stops WHERE ride_id = ? ORDER BY stop_order', [rideId]);
    expect(rows.map((r) => r.city_name)).toEqual(['S1', 'Mid', 'S2']);
  });

  it('soft-removed stops keep bookings valid; physical delete is blocked by the FK', async () => {
    const { rideId, driverId } = await newRide();
    await addStop(rideId, 10, 'S1');
    await addStop(rideId, 20, 'S2');
    const [stops] = await db.query('SELECT id FROM ride_stops WHERE ride_id = ? ORDER BY stop_order', [rideId]);
    await db.query(
      `INSERT INTO bookings (ride_id, passenger_id, pickup_stop_id, dropoff_stop_id, price_lei)
       VALUES (?, ?, ?, ?, 20)`, [rideId, driverId, stops[0].id, stops[1].id]);
    await db.query('UPDATE ride_stops SET removed_at = NOW() WHERE id = ?', [stops[1].id]);
    const [b] = await db.query(
      `SELECT s.removed_at FROM bookings b JOIN ride_stops s ON s.id = b.dropoff_stop_id WHERE b.ride_id = ?`,
      [rideId]);
    expect(b[0].removed_at).not.toBeNull();
    await expect(db.query('DELETE FROM ride_stops WHERE id = ?', [stops[1].id])).rejects.toThrow();
  });

  it('enforces UNIQUE (recurring_rule_id, instance_date)', async () => {
    const { driverId } = await newRide();
    const [rule] = await db.query(
      `INSERT INTO recurring_ride_rules (driver_id, origin_name, destination_name, departure_time,
         start_date, days_of_week, available_seats, declared_trip_cost)
       VALUES (?, 'A', 'B', '17:00:00', '2026-12-01', '["friday"]', 3, 60)`, [driverId]);
    const ins = () => db.query(
      `INSERT INTO rides (driver_id, recurring_rule_id, instance_date, origin_name, destination_name,
         departure_time, estimated_arrival_time, available_seats, declared_trip_cost)
       VALUES (?, ?, '2026-12-04', 'A', 'B', '2026-12-04 17:00:00', '2026-12-04 20:00:00', 3, 60)`,
      [driverId, rule.insertId]);
    await ins();
    await expect(ins()).rejects.toThrow(/Duplicate/);
  });

  it('bookings has no multi-seat column (D-019)', async () => {
    const [cols] = await db.query(
      `SELECT column_name n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'bookings'`,
      [TEST_DB]);
    expect(cols.map((c) => c.n)).not.toContain('num_seats');
  });
});
