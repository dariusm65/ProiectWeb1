// User moderation reports filing route:
// - POST /api/reports
// (D-013, D-014, C-002, CONTEXT.md)
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { createReport } from '../services/moderationService.js';
import { REPORT_REASONS } from '../domain/reportReasons.js';

const createReportSchema = z.object({
  reported_user_id: z.number().int().positive().nullable().optional(),
  ride_id: z.number().int().positive().nullable().optional(),
  message_id: z.number().int().positive().nullable().optional(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(2000).nullable().optional(),
});

export const DEFAULT_REPORT_RATE_LIMIT = Object.freeze({ windowMs: 15 * 60 * 1000, max: 10 });

export function createReportsRouter({ pool, jwtSecret, nowFn, rateLimit = DEFAULT_REPORT_RATE_LIMIT }) {
  const router = Router();
  const auth = requireAuth(pool, jwtSecret);
  // Keyed by authenticated user id (runs after requireAuth), so it is independent of proxy IP headers.
  const limiter = createRateLimiter({
    windowMs: rateLimit.windowMs ?? DEFAULT_REPORT_RATE_LIMIT.windowMs,
    max: rateLimit.max,
    keyFn: (req) => `user:${req.user.id}`,
    clock: rateLimit.clock,
  });

  router.post('/', auth, limiter, validateBody(createReportSchema), async (req, res, next) => {
    try {
      const report = await createReport(pool, req.user, req.body, nowFn());
      return res.status(201).json({ report });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
