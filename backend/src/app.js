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
import { createGeocodingService } from './services/geocodingService.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp({
  pool,
  jwtSecret = process.env.JWT_SECRET,
  corsOrigin = process.env.CORS_ORIGIN || false,
  extraUniversityDomains = process.env.EXTRA_UNIVERSITY_DOMAINS,
  mountExtraRoutes = null,
  fetchFn = globalThis.fetch, // injected in tests so Nominatim is never called live (D-009)
  geocodingThrottleMs = 1100, // C-001: <= 1 outbound Nominatim request per second
  nowFn = () => new Date(), // injectable clock for deterministic ban / late-cancel / search tests
} = {}) {
  if (!pool) {
    throw new Error('createApp requires a MySQL pool instance');
  }
  if (!jwtSecret || typeof jwtSecret !== 'string' || Buffer.byteLength(jwtSecret.trim(), 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 bytes for HS256');
  }

  const app = express();

  app.use(helmet());
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

  if (typeof mountExtraRoutes === 'function') {
    mountExtraRoutes(app);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
