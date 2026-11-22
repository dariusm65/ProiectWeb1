// Express REST API app factory (D-002, D-013, D-014).
// Accepts an injected MySQL pool and JWT secret for clean Supertest isolation.
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './openapi.js';
import { createAuthRouter } from './routes/auth.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp({
  pool,
  jwtSecret = process.env.JWT_SECRET,
  corsOrigin = process.env.CORS_ORIGIN || false,
  extraUniversityDomains = process.env.EXTRA_UNIVERSITY_DOMAINS,
  mountExtraRoutes = null,
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

  if (typeof mountExtraRoutes === 'function') {
    mountExtraRoutes(app);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
