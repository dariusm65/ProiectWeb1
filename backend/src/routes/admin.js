// Moderation & Admin routes (D-013, D-014, D-016, CONTEXT.md):
// - GET /api/admin/reports (moderator, admin)
// - PATCH /api/admin/reports/:reportId (moderator, admin)
// - GET /api/admin/users (moderator, admin)
// - POST /api/admin/users/:userId/suspend (moderator, admin)
// - POST /api/admin/users/:userId/unsuspend (moderator, admin)
// - POST /api/admin/rides/:rideId/cancel (moderator, admin)
// - PATCH /api/admin/users/:userId/role (admin only)
// - GET /api/admin/stats (admin only)
import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listReports,
  resolveOrDismissReport,
  listUsersForModeration,
  suspendUser,
  unsuspendUser,
  moderateCancelRide,
  changeUserRole,
  getPlatformStats,
} from '../services/moderationService.js';

const listLimit = z.coerce.number().int().min(1).max(200).optional().default(100);

const reportsQuerySchema = z.object({
  status: z.enum(['pending', 'resolved', 'dismissed']).optional(),
  limit: listLimit,
});

const usersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: listLimit,
});

const reportIdParams = z.object({
  reportId: z.coerce.number().int().positive(),
});

const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
});

const userIdParams = z.object({
  userId: z.coerce.number().int().positive(),
});

const rideIdParams = z.object({
  rideId: z.coerce.number().int().positive(),
});

const optionalReasonSchema = z
  .object({
    reason: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .optional()
  .default({});

const changeRoleSchema = z.object({
  role: z.enum(['user', 'moderator']),
});

export function createAdminRouter({ pool, jwtSecret, nowFn }) {
  const router = Router();
  const auth = requireAuth(pool, jwtSecret);
  const modOrAdmin = requireRole('moderator', 'admin');
  const adminOnly = requireRole('admin');

  router.get(
    '/reports',
    auth,
    modOrAdmin,
    validateQuery(reportsQuerySchema),
    async (req, res, next) => {
      try {
        const reports = await listReports(pool, req.query);
        return res.status(200).json({ reports });
      } catch (err) {
        return next(err);
      }
    },
  );

  router.patch(
    '/reports/:reportId',
    auth,
    modOrAdmin,
    validateParams(reportIdParams),
    validateBody(resolveReportSchema),
    async (req, res, next) => {
      try {
        const report = await resolveOrDismissReport(
          pool,
          req.user,
          req.params.reportId,
          req.body,
          nowFn(),
        );
        return res.status(200).json({ report });
      } catch (err) {
        return next(err);
      }
    },
  );

  router.get('/users', auth, modOrAdmin, validateQuery(usersQuerySchema), async (req, res, next) => {
    try {
      const users = await listUsersForModeration(pool, nowFn(), {
        q: req.query.q || undefined,
        limit: req.query.limit,
      });
      return res.status(200).json({ users });
    } catch (err) {
      return next(err);
    }
  });

  router.post(
    '/users/:userId/suspend',
    auth,
    modOrAdmin,
    validateParams(userIdParams),
    validateBody(optionalReasonSchema),
    async (req, res, next) => {
      try {
        const result = await suspendUser(
          pool,
          req.user,
          req.params.userId,
          req.body ?? {},
          nowFn(),
        );
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/users/:userId/unsuspend',
    auth,
    modOrAdmin,
    validateParams(userIdParams),
    async (req, res, next) => {
      try {
        const result = await unsuspendUser(pool, req.user, req.params.userId, nowFn());
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/rides/:rideId/cancel',
    auth,
    modOrAdmin,
    validateParams(rideIdParams),
    validateBody(optionalReasonSchema),
    async (req, res, next) => {
      try {
        const result = await moderateCancelRide(
          pool,
          req.user,
          req.params.rideId,
          req.body ?? {},
          nowFn(),
        );
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.patch(
    '/users/:userId/role',
    auth,
    adminOnly,
    validateParams(userIdParams),
    validateBody(changeRoleSchema),
    async (req, res, next) => {
      try {
        const result = await changeUserRole(
          pool,
          req.user,
          req.params.userId,
          req.body,
          nowFn(),
        );
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.get('/stats', auth, adminOnly, async (req, res, next) => {
    try {
      const stats = await getPlatformStats(pool);
      return res.status(200).json({ stats });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
