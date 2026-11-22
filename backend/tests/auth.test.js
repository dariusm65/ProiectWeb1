// Supertest + MySQL 8 integration tests for Express API foundation, Auth (JWT + RBAC),
// health check, and OpenAPI docs (D-002, D-004, D-013, D-014, D-018).
//
// Uses dedicated throwaway database `studride_test_auth` so it never collides
// with `studride_test` or `studride_test_bookings` under parallel Vitest execution.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import request from 'supertest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
dotenv.config({ path: path.join(repo, '.env') });

const TEST_DB = 'studride_test_auth';
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
  console.warn(`\n!!! MySQL unreachable (${e.code || e.message}): auth API integration tests SKIPPED !!!\n`);
}

describe.skipIf(!admin)('integration: Express API, Auth (JWT + RBAC) & OpenAPI (MySQL)', () => {
  let pool;
  let app;
  let createApp;
  let requireAuth;
  let requireRole;

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

    const appMod = await import('../src/app.js');
    const authMod = await import('../src/middleware/auth.js');
    createApp = appMod.createApp;
    requireAuth = authMod.requireAuth;
    requireRole = authMod.requireRole;

    app = createApp({
      pool,
      jwtSecret: TEST_JWT_SECRET,
      extraUniversityDomains: 'extra-test-uni.ro',
      // Mount a test-only RBAC route before the 404 handler to verify requireRole cleanly
      mountExtraRoutes(expressApp) {
        expressApp.get(
          '/api/_test/moderator-only',
          requireAuth(pool, TEST_JWT_SECRET),
          requireRole('moderator', 'admin'),
          (req, res) => res.json({ ok: true, role: req.user.role }),
        );
      },
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) await admin.end();
  });

  it('GET /api/health returns 200 with { status: "ok", db: "up" } and 503 when DB fails', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });

    const brokenPool = { query: async () => { throw new Error('DB down'); } };
    const brokenApp = createApp({ pool: brokenPool, jwtSecret: TEST_JWT_SECRET });
    const failRes = await request(brokenApp).get('/api/health');
    expect(failRes.status).toBe(503);
    expect(failRes.body.status).toBe('error');
  });

  it('GET /api/openapi.json returns a valid OpenAPI 3.0 spec with auth and health paths', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.0\./);
    expect(res.body.paths['/api/health']).toBeDefined();
    expect(res.body.paths['/api/auth/register']).toBeDefined();
    expect(res.body.paths['/api/auth/login']).toBeDefined();
    expect(res.body.paths['/api/auth/me']).toBeDefined();
  });

  it('POST /api/auth/register creates university and non-university accounts, omits password_hash, and enforces 409 / 400', async () => {
    // University subdomain account with optional gender (D-004, D-018)
    const uniRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'Ioana.Popescu@stud.ubbcluj.ro',
        password: 'StrongPassword123',
        full_name: 'Ioana Popescu',
        gender: 'female',
      });
    expect(uniRes.status).toBe(201);
    expect(typeof uniRes.body.token).toBe('string');
    expect(uniRes.body.user.email).toBe('ioana.popescu@stud.ubbcluj.ro');
    expect(uniRes.body.user.university_domain).toBe('stud.ubbcluj.ro');
    expect(uniRes.body.user.has_university_badge).toBe(true);
    expect(uniRes.body.user.university_badge_note).toBe(
      'domain-validated (not identity-verified; mailbox ownership unverified)',
    );
    expect(uniRes.body.user.gender).toBe('female');
    expect(uniRes.body.user.role).toBe('user');
    expect(uniRes.body.user.password_hash).toBeUndefined();

    // Non-university email is allowed (D-004) without university badge
    const stdRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'tester@gmail.com',
        password: 'StrongPassword123',
        full_name: 'Tester User',
      });
    expect(stdRes.status).toBe(201);
    expect(stdRes.body.user.university_domain).toBeNull();
    expect(stdRes.body.user.has_university_badge).toBe(false);
    expect(stdRes.body.user.university_badge_note).toBeNull();
    expect(stdRes.body.user.gender).toBe('prefer_not_to_say');

    // Password exceeding bcrypt 72-byte limit -> 400 Bad Request
    const longPassRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'longpass@ulbsibiu.ro',
        password: 'a'.repeat(73),
        full_name: 'Long Password',
      });
    expect(longPassRes.status).toBe(400);

    // Duplicate email -> 409 Conflict
    const dupRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'ioana.popescu@stud.ubbcluj.ro',
        password: 'AnotherPassword123',
        full_name: 'Duplicate',
      });
    expect(dupRes.status).toBe(409);

    // Invalid Zod payload -> 400 Bad Request
    const badRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'not-an-email',
        password: 'short',
        full_name: 'A',
        gender: 'invalid_gender',
      });
    expect(badRes.status).toBe(400);
  });

  it('POST /api/auth/login validates credentials, rejects bad password (401), and rejects suspended accounts (403)', async () => {
    const okRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ioana.popescu@stud.ubbcluj.ro', password: 'StrongPassword123' });
    expect(okRes.status).toBe(200);
    expect(typeof okRes.body.token).toBe('string');
    expect(okRes.body.user.password_hash).toBeUndefined();

    const badPass = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ioana.popescu@stud.ubbcluj.ro', password: 'WrongPassword123' });
    expect(badPass.status).toBe(401);

    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@ulbsibiu.ro', password: 'StrongPassword123' });
    expect(unknown.status).toBe(401);

    // Suspend tester@gmail.com and verify login returns 403
    await pool.query("UPDATE users SET is_suspended = TRUE WHERE email = 'tester@gmail.com'");
    const suspLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tester@gmail.com', password: 'StrongPassword123' });
    expect(suspLogin.status).toBe(403);
  });

  it('GET /api/auth/me enforces JWT and checks live DB suspension and role (D-013)', async () => {
    // Missing & invalid tokens -> 401
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid.jwt.token')).status).toBe(401);

    // Register a fresh user, get token, verify /me returns 200
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'livecheck@ulbsibiu.ro',
        password: 'StrongPassword123',
        full_name: 'Live Check',
      });
    const token = reg.body.token;
    const meOk = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(meOk.status).toBe(200);
    expect(meOk.body.user.email).toBe('livecheck@ulbsibiu.ro');
    expect(meOk.body.user.password_hash).toBeUndefined();

    // Suspend user AFTER token issuance -> /me must immediately return 403
    await pool.query("UPDATE users SET is_suspended = TRUE WHERE email = 'livecheck@ulbsibiu.ro'");
    const meSusp = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(meSusp.status).toBe(403);
  });

  it('requireRole enforces RBAC against live DB role (403 for user, 200 for moderator/admin, 403 when suspended)', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'rbac.user@ulbsibiu.ro',
        password: 'StrongPassword123',
        full_name: 'RBAC User',
      });
    const token = reg.body.token;

    // Regular user -> 403
    const asUser = await request(app)
      .get('/api/_test/moderator-only')
      .set('Authorization', `Bearer ${token}`);
    expect(asUser.status).toBe(403);

    // Promote to moderator in DB (token still has old role claim; requireAuth reads live DB role) -> 200
    await pool.query("UPDATE users SET role = 'moderator' WHERE email = 'rbac.user@ulbsibiu.ro'");
    const asMod = await request(app)
      .get('/api/_test/moderator-only')
      .set('Authorization', `Bearer ${token}`);
    expect(asMod.status).toBe(200);
    expect(asMod.body).toEqual({ ok: true, role: 'moderator' });

    // Suspend moderator -> 403
    await pool.query("UPDATE users SET is_suspended = TRUE WHERE email = 'rbac.user@ulbsibiu.ro'");
    const asSuspMod = await request(app)
      .get('/api/_test/moderator-only')
      .set('Authorization', `Bearer ${token}`);
    expect(asSuspMod.status).toBe(403);
  });
});
