// Slice 8 — production serving, security headers, report reason enum, rate limiting and
// admin RBAC checks that need NO MySQL: the pool is a stub that only answers the
// requireAuth user lookup and the health probe (D-013, D-014, D-021, C-002).
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/middleware/auth.js';
import { createRateLimiter } from '../src/middleware/rateLimit.js';
import { parseTrustProxy, parseBooleanEnv } from '../src/middleware/production.js';
import { dbConfig, parseDatabaseUrl } from '../src/db.js';
import { REPORT_REASONS } from '../src/domain/reportReasons.js';
import {
  createReport,
  listReports,
  listUsersForModeration,
  moderateCancelRide,
  resolveOrDismissReport,
} from '../src/services/moderationService.js';

const JWT_SECRET = 'studride-test-jwt-secret-key-at-least-32-chars';

const USERS = {
  1: { id: 1, role: 'user', is_suspended: 0 },
  2: { id: 2, role: 'moderator', is_suspended: 0 },
  3: { id: 3, role: 'admin', is_suspended: 0 },
  4: { id: 4, role: 'moderator', is_suspended: 1 },
  5: { id: 5, role: 'user', is_suspended: 0 },
};

function createStubPool() {
  return {
    query: async (sql, params = []) => {
      if (/^\s*SELECT 1/.test(sql)) return [[{ 1: 1 }]];
      if (/FROM users WHERE id = \? LIMIT 1/.test(sql)) {
        const u = USERS[params[0]];
        if (!u) return [[]];
        return [[{
          ...u,
          email: `user${u.id}@example.com`,
          full_name: `User ${u.id}`,
          phone: null,
          university_domain: null,
          gender: 'prefer_not_to_say',
          created_at: new Date('2026-11-01T00:00:00Z'),
        }]];
      }
      throw new Error(`Stub pool: unexpected query reached the database layer: ${sql}`);
    },
  };
}

const bearer = (id) => ({ Authorization: `Bearer ${signAccessToken({ id, role: USERS[id].role }, JWT_SECRET)}` });

function makeApp(opts = {}) {
  return createApp({ pool: createStubPool(), jwtSecret: JWT_SECRET, trustProxy: false, forceHttps: false, ...opts });
}

describe('unit: production config helpers (D-021)', () => {
  it('parseTrustProxy maps env strings to Express trust proxy values', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });

  it('parseBooleanEnv accepts only explicit truthy values', () => {
    expect(parseBooleanEnv('true')).toBe(true);
    expect(parseBooleanEnv('1')).toBe(true);
    expect(parseBooleanEnv(undefined)).toBe(false);
    expect(parseBooleanEnv('no')).toBe(false);
  });

  describe('DATABASE_URL support', () => {
    const saved = {};
    const keys = ['DATABASE_URL', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_SSL'];
    beforeAll(() => keys.forEach((k) => { saved[k] = process.env[k]; }));
    afterEach(() => keys.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }));

    it('parses mysql:// URLs including encoded credentials and ssl flag', () => {
      expect(parseDatabaseUrl(undefined)).toBeNull();
      const parsed = parseDatabaseUrl('mysql://app%40x:p%3Ass@db.example.com:3307/studride?ssl=true');
      expect(parsed).toMatchObject({
        host: 'db.example.com',
        port: 3307,
        user: 'app@x',
        password: 'p:ss',
        database: 'studride',
        sslFromUrl: true,
      });
      expect(() => parseDatabaseUrl('postgres://u:p@h/db')).toThrow(/mysql/);
    });

    it('dbConfig prefers DATABASE_URL over DB_* and enables TLS when requested', () => {
      process.env.DB_HOST = 'ignored-host';
      process.env.DATABASE_URL = 'mysql://u:secretpw@managed.example.com/prod_db';
      const cfg = dbConfig({ multipleStatements: true });
      expect(cfg).toMatchObject({
        host: 'managed.example.com',
        port: 3306,
        user: 'u',
        password: 'secretpw',
        database: 'prod_db',
        multipleStatements: true,
      });
      expect(cfg.ssl).toBeUndefined();

      process.env.DB_SSL = 'true';
      expect(dbConfig().ssl).toMatchObject({ rejectUnauthorized: true });
    });
  });
});

describe('unit: in-memory rate limiter', () => {
  it('allows max requests per window per key, then 429 with Retry-After, and resets after the window', async () => {
    let now = 1_000_000;
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 2, keyFn: (req) => req.get('x-key'), clock: () => now }));
    app.get('/', (req, res) => res.json({ ok: true }));

    await request(app).get('/').set('x-key', 'a').expect(200);
    const second = await request(app).get('/').set('x-key', 'a').expect(200);
    expect(second.headers['ratelimit-remaining']).toBe('0');
    const third = await request(app).get('/').set('x-key', 'a').expect(429);
    expect(third.body.error).toBe('RATE_LIMITED');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);

    // Independent bucket for another key
    await request(app).get('/').set('x-key', 'b').expect(200);

    now += 60_001;
    await request(app).get('/').set('x-key', 'a').expect(200);
  });

  it('max <= 0 disables limiting entirely', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 1000, max: 0, keyFn: () => 'k' }));
    app.get('/', (req, res) => res.json({ ok: true }));
    for (let i = 0; i < 5; i += 1) {
      await request(app).get('/').expect(200);
    }
  });

  it('evicts the oldest key in O(1) when active buckets reach maxKeys (no unbounded memory growth)', async () => {
    const now = 1_000_000;
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 2, keyFn: (req) => req.get('x-key'), clock: () => now }));
    app.get('/', (req, res) => res.json({ ok: true }));

    // Fill maxKeys = 2 with 'k1' and 'k2' (both hit their max=1 budget)
    await request(app).get('/').set('x-key', 'k1').expect(200);
    await request(app).get('/').set('x-key', 'k1').expect(429);
    await request(app).get('/').set('x-key', 'k2').expect(200);

    // Inserting 'k3' evicts oldest ('k1') while 'k2' remains tracked and blocked
    await request(app).get('/').set('x-key', 'k3').expect(200);
    await request(app).get('/').set('x-key', 'k2').expect(429);
    await request(app).get('/').set('x-key', 'k1').expect(200);
  });
});

describe('API: POST /api/reports reason enum and rate limit (C-002)', () => {
  it('exposes the fixed reason list', () => {
    expect(REPORT_REASONS).toEqual([
      'spam', 'harassment', 'unsafe_driving', 'no_show', 'fake_profile', 'inappropriate_content', 'other',
    ]);
  });

  it('rejects free-text reasons with 400 VALIDATION_ERROR and accepts enum values', async () => {
    const app = makeApp();
    await request(app).post('/api/reports').send({ reported_user_id: 5, reason: 'spam' }).expect(401);

    const bad = await request(app)
      .post('/api/reports')
      .set(bearer(1))
      .send({ reported_user_id: 5, reason: 'Sofer agresiv in trafic' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('VALIDATION_ERROR');
    expect(bad.body.details.some((d) => d.path === 'reason')).toBe(true);

    // A valid enum reason passes validation and reaches the target guard (no target -> 400 before any DB write)
    const noTarget = await request(app).post('/api/reports').set(bearer(1)).send({ reason: 'spam' });
    expect(noTarget.status).toBe(400);
    expect(noTarget.body.error).toBe('REPORT_TARGET_REQUIRED');

    const tooLong = await request(app)
      .post('/api/reports')
      .set(bearer(1))
      .send({ reported_user_id: 5, reason: 'other', details: 'x'.repeat(2001) });
    expect(tooLong.status).toBe(400);
  });

  it('is disabled by default under NODE_ENV=test and enforces a per-user limit when configured', async () => {
    const defaultApp = makeApp();
    for (let i = 0; i < 12; i += 1) {
      await request(defaultApp).post('/api/reports').set(bearer(1)).send({ reason: 'nope' }).expect(400);
    }

    const limited = makeApp({ reportRateLimit: { windowMs: 60_000, max: 2 } });
    await request(limited).post('/api/reports').set(bearer(1)).send({ reason: 'nope' }).expect(400);
    await request(limited).post('/api/reports').set(bearer(1)).send({ reason: 'nope' }).expect(400);
    const blocked = await request(limited).post('/api/reports').set(bearer(1)).send({ reason: 'nope' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
    // Another account keeps its own budget
    await request(limited).post('/api/reports').set(bearer(5)).send({ reason: 'nope' }).expect(400);
  });
});

describe('API: /api/admin/* RBAC matrix (D-013)', () => {
  const app = makeApp();
  const modRoutes = [
    ['get', '/api/admin/reports'],
    ['patch', '/api/admin/reports/1'],
    ['get', '/api/admin/users'],
    ['post', '/api/admin/users/5/suspend'],
    ['post', '/api/admin/users/5/unsuspend'],
    ['post', '/api/admin/rides/1/cancel'],
  ];
  const adminRoutes = [
    ['patch', '/api/admin/users/5/role'],
    ['get', '/api/admin/stats'],
  ];

  it('anonymous -> 401 and regular user -> 403 on every admin route', async () => {
    for (const [method, url] of [...modRoutes, ...adminRoutes]) {
      await request(app)[method](url).expect(401);
      const res = await request(app)[method](url).set(bearer(1));
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN');
    }
  });

  it('moderator -> 403 on admin-only routes (role changes and stats)', async () => {
    for (const [method, url] of adminRoutes) {
      const res = await request(app)[method](url).set(bearer(2)).send({ role: 'moderator' });
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
    }
  });

  it('suspended moderator token -> 403 ACCOUNT_SUSPENDED (live DB check)', async () => {
    const res = await request(app).get('/api/admin/reports').set(bearer(4));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_SUSPENDED');
  });

  it('validates list query limits before touching the database', async () => {
    await request(app).get('/api/admin/reports?limit=0').set(bearer(2)).expect(400);
    await request(app).get('/api/admin/reports?limit=500').set(bearer(2)).expect(400);
    await request(app).get(`/api/admin/users?q=${'a'.repeat(101)}`).set(bearer(2)).expect(400);
  });
});

describe('API: production SPA serving, CSP and HTTPS (D-021)', () => {
  let distDir;

  beforeAll(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studride-dist-'));
    fs.mkdirSync(path.join(distDir, 'assets'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body><div id="root">StudRide SPA</div></body></html>');
    fs.writeFileSync(path.join(distDir, 'assets', 'index-abc123.js'), 'console.log("app");');
  });

  afterAll(() => {
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('serves index.html at / and for deep client routes, with hashed assets cached immutably', async () => {
    const app = makeApp({ frontendDistDir: distDir });

    const root = await request(app).get('/').expect(200);
    expect(root.headers['content-type']).toMatch(/text\/html/);
    expect(root.text).toContain('StudRide SPA');

    const deep = await request(app).get('/admin').expect(200);
    expect(deep.text).toContain('StudRide SPA');
    expect(deep.headers['cache-control']).toBe('no-cache');

    const deeper = await request(app).get('/rides/42/chat').expect(200);
    expect(deeper.text).toContain('StudRide SPA');

    const asset = await request(app).get('/assets/index-abc123.js').expect(200);
    expect(asset.headers['cache-control']).toMatch(/immutable/);
  });

  it('never shadows the API: unknown /api paths stay JSON 404 and health stays JSON', async () => {
    const app = makeApp({ frontendDistDir: distDir });
    const miss = await request(app).get('/api/does-not-exist').expect(404);
    expect(miss.headers['content-type']).toMatch(/application\/json/);
    expect(miss.text).not.toContain('StudRide SPA');
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toEqual({ status: 'ok', db: 'up' });
    // Non-GET to a client route is not answered with the SPA
    await request(app).post('/admin').expect(404);
  });

  it('skips SPA mounting when the dist directory has no index.html', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studride-empty-'));
    try {
      const app = makeApp({ frontendDistDir: emptyDir });
      const res = await request(app).get('/admin').expect(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('sends a strict CSP allowing OSM tiles + Google Fonts, no HSTS/upgrade on plain HTTP, and Swagger UI still loads', async () => {
    const app = makeApp({ frontendDistDir: distDir });
    const res = await request(app).get('/').expect(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain('https://*.tile.openstreetmap.org');
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();

    const docs = await request(app).get('/api/docs/').expect(200);
    expect(docs.text).toContain('swagger-ui');
    expect(docs.text).not.toMatch(/<script>(?!\s*<\/script>)/); // only external scripts, CSP-compatible
  });

  it('with FORCE_HTTPS + trust proxy: redirects http -> https (308), keeps /api/health probe-able, and sends HSTS', async () => {
    const app = makeApp({ frontendDistDir: distDir, forceHttps: true, trustProxy: '1' });

    const redirect = await request(app)
      .get('/rides?from=Cluj')
      .set('Host', 'studride.example.com')
      .set('X-Forwarded-Proto', 'http');
    expect(redirect.status).toBe(308);
    expect(redirect.headers.location).toBe('https://studride.example.com/rides?from=Cluj');

    await request(app).get('/api/health').set('X-Forwarded-Proto', 'http').expect(200);

    const secure = await request(app).get('/admin').set('X-Forwarded-Proto', 'https').expect(200);
    expect(secure.headers['strict-transport-security']).toMatch(/max-age=15552000/);
    expect(secure.headers['content-security-policy']).toContain('upgrade-insecure-requests');
  });

  it('without trust proxy, a spoofed X-Forwarded-Proto is ignored (still redirected)', async () => {
    const app = makeApp({ frontendDistDir: distDir, forceHttps: true, trustProxy: false });
    const res = await request(app).get('/admin').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(308);
  });

  it('defaults trustProxy to 1 when forceHttps is enabled without explicit trustProxy, validates Host header, and normalizes protocol-relative originalUrl', async () => {
    const app = createApp({
      pool: createStubPool(),
      jwtSecret: JWT_SECRET,
      frontendDistDir: distDir,
      forceHttps: true,
    });
    expect(app.get('trust proxy')).toBe(1);

    // Protocol-relative path '//evil.example/x' is collapsed to '/evil.example/x' on the validated host
    const norm = await request(app)
      .get('//evil.example/x')
      .set('Host', 'studride.example.com')
      .set('X-Forwarded-Proto', 'http');
    expect(norm.status).toBe(308);
    expect(norm.headers.location).toBe('https://studride.example.com/evil.example/x');

    // Malformed Host header is rejected with 400
    const badHost = await request(app)
      .get('/rides')
      .set('Host', 'evil.com/injected@studride.ro')
      .set('X-Forwarded-Proto', 'http');
    expect(badHost.status).toBe(400);
    expect(badHost.body.error).toBe('INVALID_HOST_HEADER');
  });

  it('gzip-compresses static SPA assets and API JSON responses above the 1 KB threshold when Accept-Encoding: gzip is sent', async () => {
    const largeJsPath = path.join(distDir, 'assets', 'large-bundle.js');
    fs.writeFileSync(largeJsPath, `console.log("${'studride-segment-carpooling-'.repeat(80)}");`);

    const app = makeApp({ frontendDistDir: distDir });

    const assetRes = await request(app)
      .get('/assets/large-bundle.js')
      .set('Accept-Encoding', 'gzip')
      .expect(200);
    expect(assetRes.headers['content-encoding']).toBe('gzip');
    expect(assetRes.headers.vary).toMatch(/Accept-Encoding/i);

    const apiRes = await request(app)
      .get('/api/openapi.json')
      .set('Accept-Encoding', 'gzip')
      .expect(200);
    expect(apiRes.headers['content-encoding']).toBe('gzip');
  });
});

describe('unit: moderationService single-query enrichment, 409 dedupe, and user search (C-002)', () => {
  it('listReports executes exactly 1 LEFT-JOINed SQL query regardless of row count and formats enriched objects without sensitive PII', async () => {
    const calls = [];
    const mockPool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return [[
          {
            id: 101,
            reporter_id: 21,
            reported_user_id: 9,
            ride_id: 42,
            message_id: 555,
            reason: 'harassment',
            details: 'Limbaj jignitor pe chat',
            status: 'pending',
            resolved_by: null,
            resolved_at: null,
            created_at: new Date('2026-12-04T11:00:00Z'),
            reporter_name: 'Paula Pasager',
            reported_user_name: 'Tudor Target',
            reported_user_role: 'user',
            reported_user_is_suspended: 0,
            ride_origin_name: 'Cluj-Napoca',
            ride_destination_name: 'Sibiu',
            ride_departure_time: new Date('2026-12-04T16:00:00Z'),
            ride_status: 'active',
            ride_driver_id: 9,
            message_excerpt: 'Mesaj raportat în chat',
            message_ride_id: 42,
            message_sender_id: 9,
            message_sender_name: 'Tudor Target',
            resolved_by_name: null,
          },
          {
            id: 102,
            reporter_id: 22,
            reported_user_id: null,
            ride_id: 42,
            message_id: null,
            reason: 'unsafe_driving',
            details: null,
            status: 'resolved',
            resolved_by: 2,
            resolved_at: new Date('2026-12-04T12:00:00Z'),
            created_at: new Date('2026-12-04T10:30:00Z'),
            reporter_name: 'Mircea Pasager',
            reported_user_name: null,
            reported_user_role: null,
            reported_user_is_suspended: null,
            ride_origin_name: 'Cluj-Napoca',
            ride_destination_name: 'Sibiu',
            ride_departure_time: new Date('2026-12-04T16:00:00Z'),
            ride_status: 'cancelled',
            ride_driver_id: 9,
            message_excerpt: null,
            message_ride_id: null,
            message_sender_id: null,
            message_sender_name: null,
            resolved_by_name: 'Mara Moderator',
          },
        ]];
      },
    };

    const reports = await listReports(mockPool, { status: 'pending', limit: 50 });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/LEFT JOIN users rep/);
    expect(calls[0].sql).toMatch(/LEFT JOIN rides rd/);
    expect(calls[0].sql).toMatch(/LEFT JOIN chat_messages cm/);
    expect(calls[0].params).toEqual(['pending', 50]);

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      id: 101,
      reason: 'harassment',
      reporter: { id: 21, full_name: 'Paula Pasager' },
      reported_user: { id: 9, full_name: 'Tudor Target', role: 'user', is_suspended: false },
      ride: { id: 42, origin_name: 'Cluj-Napoca', destination_name: 'Sibiu', status: 'active', driver_id: 9 },
      message: { id: 555, ride_id: 42, excerpt: 'Mesaj raportat în chat', sender_id: 9, sender_name: 'Tudor Target' },
      resolved_by_name: null,
    });
    // Sensitive PII never leaked on enriched report sub-objects
    expect(reports[0].reporter.email).toBeUndefined();
    expect(reports[0].reported_user.email).toBeUndefined();
    expect(reports[0].reported_user.phone).toBeUndefined();
    expect(reports[0].reported_user.password_hash).toBeUndefined();
    expect(reports[1].reported_user).toBeNull();
    expect(reports[1].message).toBeNull();
    expect(reports[1].resolved_by_name).toBe('Mara Moderator');
  });

  it('createReport rejects duplicate pending report on the same (reporter, target) with 409 REPORT_ALREADY_PENDING', async () => {
    const mockPool = {
      query: async (sql) => {
        if (/SELECT id FROM users/.test(sql)) return [[{ id: 9 }]];
        if (/SELECT id FROM reports[\s\S]*status = 'pending'/.test(sql)) return [[{ id: 777 }]];
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    await expect(
      createReport(
        mockPool,
        { id: 21, role: 'user' },
        { reported_user_id: 9, reason: 'spam', details: 'Duplicate pending' },
        new Date('2026-12-04T11:00:00Z'),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REPORT_ALREADY_PENDING',
    });
  });

  it('listUsersForModeration escapes LIKE wildcards, filters by q + limit, and executes a constant 3 queries without password_hash', async () => {
    const calls = [];
    const mockPool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/FROM users/.test(sql)) {
          return [[
            {
              id: 9,
              email: 'tudor@ulbsibiu.ro',
              full_name: 'Tudor 100%_Student',
              phone: '+40722000111',
              university_domain: 'ulbsibiu.ro',
              role: 'user',
              gender: 'male',
              is_suspended: 0,
              created_at: new Date('2026-11-01T00:00:00Z'),
            },
          ]];
        }
        if (/FROM reviews/.test(sql)) {
          return [[{ reviewed_user_id: 9, avg_stars: 4.75, n: 4 }]];
        }
        if (/FROM user_infractions/.test(sql)) {
          return [[]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const result = await listUsersForModeration(
      mockPool,
      new Date('2026-12-04T11:00:00Z'),
      { q: '100%_Student', limit: 25 },
    );
    expect(calls).toHaveLength(3);
    expect(calls[0].sql).toContain("ESCAPE '\\\\'");
    expect(calls[0].params).toEqual(['%100\\%\\_Student%', '%100\\%\\_Student%', 25]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 9,
      email: 'tudor@ulbsibiu.ro',
      full_name: 'Tudor 100%_Student',
      rating_average: 4.8,
      rating_count: 4,
      seriousness_score: 100,
    });
    expect(result[0].password_hash).toBeUndefined();
    expect(result[0].phone).toBeUndefined();
    expect(result[0].gender).toBeUndefined();
  });

  it('blocks non-participant chat message reporting (403 FORBIDDEN), self-resolution in resolveOrDismissReport (400), and self/hierarchy bypass in moderateCancelRide', async () => {
    // 1. Non-participant attempting to report a private ride chat message -> 403 FORBIDDEN
    const nonPartPool = {
      query: async (sql) => {
        if (/FROM chat_messages/.test(sql)) return [[{ id: 555, ride_id: 42, sender_id: 9 }]];
        if (/SELECT driver_id FROM rides/.test(sql)) return [[{ driver_id: 9 }]];
        if (/SELECT id FROM bookings WHERE ride_id = \? AND passenger_id = \?/.test(sql)) return [[]];
        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    await expect(
      createReport(
        nonPartPool,
        { id: 99, role: 'user' },
        { message_id: 555, reason: 'harassment' },
        new Date('2026-12-04T11:00:00Z'),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });

    // 2. Moderator attempting to resolve/dismiss a report targeting themselves or their own ride -> 400 SELF_MODERATION_NOT_ALLOWED
    const selfReportPool = {
      query: async (sql) => {
        if (/FROM reports r/.test(sql)) {
          return [[{ id: 101, reported_user_id: null, ride_id: 42, ride_driver_id: 2, message_sender_id: null }]];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    await expect(
      resolveOrDismissReport(
        selfReportPool,
        { id: 2, role: 'moderator' },
        101,
        { status: 'dismissed' },
        new Date('2026-12-04T11:00:00Z'),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'SELF_MODERATION_NOT_ALLOWED',
    });

    // 3. Moderator attempting to administratively cancel their own ride (or an admin's ride) -> 400 / 403
    const makeCancelRidePool = (driverRow) => ({
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql) => {
          if (/SELECT \* FROM rides WHERE id = \? FOR UPDATE/.test(sql)) {
            return [[{ id: 42, driver_id: driverRow.id, status: 'active', departure_time: new Date('2026-12-05T12:00:00Z') }]];
          }
          if (/SELECT id, role FROM users WHERE id = \?/.test(sql)) {
            return [[driverRow]];
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
      }),
    });

    await expect(
      moderateCancelRide(
        makeCancelRidePool({ id: 2, role: 'moderator' }),
        { id: 2, role: 'moderator' },
        42,
        { reason: 'Self cancel' },
        new Date('2026-12-04T11:00:00Z'),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'SELF_MODERATION_NOT_ALLOWED',
    });

    await expect(
      moderateCancelRide(
        makeCancelRidePool({ id: 1, role: 'admin' }),
        { id: 2, role: 'moderator' },
        42,
        { reason: 'Cancel admin ride' },
        new Date('2026-12-04T11:00:00Z'),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'INSUFFICIENT_ROLE_HIERARCHY',
    });
  });
});
