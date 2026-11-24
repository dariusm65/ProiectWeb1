// Recurring ride routes: GET /api/recurring-rides/me, POST /api/recurring-rides, POST /api/recurring-rides/:ruleId/exceptions
// (D-006, D-013, D-014, D-018).
import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { createRule, addException, listMyRecurringRules } from '../services/recurringRideService.js';
import { MAX_STOPS, dateString, sharedRideFields, stopBaseFields, checkDistances } from './rides.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const ruleStop = z.object({
  ...stopBaseFields,
  estimated_offset_minutes: z.number().int().min(0),
});

const ruleSchema = z
  .object({
    ...sharedRideFields,
    // Europe/Bucharest wall-clock time (D-020); normalised to HH:MM:SS
    departure_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
      .transform((v) => (v.length === 5 ? `${v}:00` : v)),
    start_date: dateString,
    end_date: dateString.nullable().optional().default(null),
    days_of_week: z.array(z.enum(DAYS)).min(1).max(7).refine((d) => new Set(d).size === d.length, { message: 'Duplicate days' }),
    stops: z
      .array(ruleStop)
      .min(2)
      .max(MAX_STOPS)
      .superRefine((stops, ctx) => {
        checkDistances(stops, ctx);
        stops.forEach((s, i) => {
          if (i === 0 && s.estimated_offset_minutes !== 0) {
            ctx.addIssue({ code: 'custom', path: [i, 'estimated_offset_minutes'], message: 'First stop offset must be 0' });
          }
          if (i > 0 && s.estimated_offset_minutes <= stops[i - 1].estimated_offset_minutes) {
            ctx.addIssue({ code: 'custom', path: [i, 'estimated_offset_minutes'], message: 'Offsets must be strictly increasing' });
          }
        });
      }),
  })
  .refine((r) => r.end_date === null || r.end_date >= r.start_date, {
    message: 'end_date must not be before start_date',
    path: ['end_date'],
  });

const exceptionSchema = z.object({
  exception_date: dateString,
  reason: z.string().trim().max(255).nullable().optional(),
});

const ruleIdParams = z.object({ ruleId: z.coerce.number().int().positive() });

export function createRecurringRidesRouter({ pool, jwtSecret, nowFn }) {
  const router = Router();
  const auth = requireAuth(pool, jwtSecret);

  router.get('/me', auth, async (req, res, next) => {
    try {
      const rules = await listMyRecurringRules(pool, req.user);
      return res.status(200).json({ rules });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', auth, validateBody(ruleSchema), async (req, res, next) => {
    try {
      return res.status(201).json(await createRule(pool, req.user, req.body, nowFn()));
    } catch (err) {
      return next(err);
    }
  });

  router.post(
    '/:ruleId/exceptions',
    auth,
    validateParams(ruleIdParams),
    validateBody(exceptionSchema),
    async (req, res, next) => {
      try {
        const result = await addException(pool, req.user, req.params.ruleId, req.body, nowFn());
        return res.status(201).json(result);
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
