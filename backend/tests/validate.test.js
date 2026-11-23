// Unit & Supertest regression tests for Express 5 validateQuery middleware (D-014)
// and createApp security guards (32-byte HS256 JWT_SECRET). Runs without MySQL.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateQuery } from '../src/middleware/validate.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { ApiError } from '../src/errors.js';
import { createApp } from '../src/app.js';

describe('middleware: Express 5 validateQuery, errorHandler & createApp security guards', () => {
  it('validateQuery parses & coerces req.query cleanly on Express 5 getter-only req.query', async () => {
    const app = express();
    const querySchema = z.object({
      radiusKm: z.coerce.number().int().min(1).max(5).default(1),
      origin: z.string().trim().min(1),
    });

    app.get('/search', validateQuery(querySchema), (req, res) => {
      res.status(200).json({ query: req.query });
    });

    const okRes = await request(app).get('/search?origin=Sibiu&radiusKm=3');
    expect(okRes.status).toBe(200);
    expect(okRes.body).toEqual({ query: { origin: 'Sibiu', radiusKm: 3 } });

    const badRes = await request(app).get('/search?origin=Sibiu&radiusKm=99');
    expect(badRes.status).toBe(400);
    expect(badRes.body.error).toBe('VALIDATION_ERROR');
  });

  it('createApp rejects JWT_SECRET shorter than 32 UTF-8 bytes (HS256 floor)', () => {
    const dummyPool = { query: async () => [[{ 1: 1 }]] };
    expect(() => createApp({ pool: dummyPool, jwtSecret: 'too-short-secret-16' })).toThrow(/32 bytes/i);
    expect(() => createApp({ pool: dummyPool, jwtSecret: '   '.repeat(12) })).toThrow(/32 bytes/i);
  });

  it('errorHandler returns explicit ApiError 4xx and 5xx (502/503) status and JSON while masking unexpected errors', async () => {
    const app = express();
    app.get('/upstream-fail', (req, res, next) => {
      next(new ApiError(502, 'GEOCODING_UNAVAILABLE', 'Geocoding provider is unavailable'));
    });
    app.get('/raw-sql-crash', (req, res, next) => {
      next(new Error('ER_SYNTAX_ERROR: SELECT secret FROM users'));
    });
    app.use(errorHandler);

    const upstreamRes = await request(app).get('/upstream-fail');
    expect(upstreamRes.status).toBe(502);
    expect(upstreamRes.body).toEqual({
      error: 'GEOCODING_UNAVAILABLE',
      message: 'Geocoding provider is unavailable',
    });

    const crashRes = await request(app).get('/raw-sql-crash');
    expect(crashRes.status).toBe(500);
    expect(crashRes.body).toEqual({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
  });
});
