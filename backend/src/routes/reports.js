// User moderation reports filing route:
// - POST /api/reports
// (D-013, D-014, CONTEXT.md)
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { createReport } from '../services/moderationService.js';

const createReportSchema = z.object({
  reported_user_id: z.number().int().positive().nullable().optional(),
  ride_id: z.number().int().positive().nullable().optional(),
  message_id: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(1).max(100),
  details: z.string().trim().max(2000).nullable().optional(),
});

export function createReportsRouter({ pool, jwtSecret, nowFn }) {
  const router = Router();
  const auth = requireAuth(pool, jwtSecret);

  router.post('/', auth, validateBody(createReportSchema), async (req, res, next) => {
    try {
      const report = await createReport(pool, req.user, req.body, nowFn());
      return res.status(201).json({ report });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
