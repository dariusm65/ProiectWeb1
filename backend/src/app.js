// Express REST API app factory (D-002, D-013, D-014).
// Accepts an injected MySQL pool and JWT secret for clean Supertest isolation.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './openapi.js';
import { createAuthRouter } from './routes/auth.js';
import { createGeocodingRouter } from './routes/geocoding.js';
import { createRidesRouter } from './routes/rides.js';
import { createRecurringRidesRouter } from './routes/recurringRides.js';
import { createBookingsRouter } from './routes/bookings.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createUsersRouter } from './routes/users.js';
import { createReportsRouter, DEFAULT_REPORT_RATE_LIMIT } from './routes/reports.js';
import { createAdminRouter } from './routes/admin.js';
import { createGeocodingService } from './services/geocodingService.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import {
  buildHelmetOptions,
  httpsRedirect,
  mountFrontend,
  parseBooleanEnv,
  parseTrustProxy,
} from './middleware/production.js';

export function createApp({
  pool,
  jwtSecret = process.env.JWT_SECRET,
  corsOrigin = process.env.CORS_ORIGIN || false,
  extraUniversityDomains = process.env.EXTRA_UNIVERSITY_DOMAINS,
  mountExtraRoutes = null,
  fetchFn = globalThis.fetch, // injected in tests so Nominatim is never called live (D-009)
  geocodingThrottleMs = 1100, // C-001: <= 1 outbound Nominatim request per second
  nowFn = () => new Date(), // injectable clock for deterministic ban / late-cancel / search tests
  trustProxy = process.env.TRUST_PROXY, // D-021: e.g. '1' behind Render's single TLS-terminating proxy
  forceHttps = parseBooleanEnv(process.env.FORCE_HTTPS),
  frontendDistDir = process.env.FRONTEND_DIST_DIR, // D-021: serve built SPA + fallback from this dir
  // In-memory per-user limit on POST /api/reports; disabled under NODE_ENV=test so suites never flake.
  reportRateLimit = process.env.NODE_ENV === 'test' ? { max: 0 } : DEFAULT_REPORT_RATE_LIMIT,
} = {}) {
  if (!pool) {
    throw new Error('createApp requires a MySQL pool instance');
  }
  if (!jwtSecret || typeof jwtSecret !== 'string' || Buffer.byteLength(jwtSecret.trim(), 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 bytes for HS256');
  }

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(trustProxy));
  if (forceHttps) {
    app.use(httpsRedirect());
  }
  app.use(helmet(buildHelmetOptions({ forceHttps })));
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      return res.status(200).json({ status: 'ok', db: 'up' });
    } catch {
      return res.status(503).json({ status: 'error', db: 'down' });
    }
  });

  app.get('/api/openapi.json', (req, res) => {
    return res.status(200).json(openapiSpec);
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  app.use('/api/auth', createAuthRouter({ pool, jwtSecret, extraUniversityDomains }));

  const geocoding = createGeocodingService({ pool, fetchFn, throttleMs: geocodingThrottleMs });
  app.use('/api/geocoding', createGeocodingRouter({ geocoding }));
  app.use('/api/rides', createRidesRouter({ pool, jwtSecret, nowFn }));
  app.use('/api/recurring-rides', createRecurringRidesRouter({ pool, jwtSecret, nowFn }));
  app.use('/api/bookings', createBookingsRouter({ pool, jwtSecret, nowFn }));
  app.use('/api/notifications', createNotificationsRouter({ pool, jwtSecret, nowFn }));
  app.use('/api/users', createUsersRouter({ pool, nowFn }));
  app.use('/api/reports', createReportsRouter({ pool, jwtSecret, nowFn, rateLimit: reportRateLimit }));
  app.use('/api/admin', createAdminRouter({ pool, jwtSecret, nowFn }));

  if (typeof mountExtraRoutes === 'function') {
    mountExtraRoutes(app);
  }

  mountFrontend(app, frontendDistDir);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
