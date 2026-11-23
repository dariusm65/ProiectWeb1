// Notifications routes:
// - GET /api/notifications
// - PATCH /api/notifications/:notificationId/read
// - POST /api/notifications/read-all
// (D-007, D-011, D-013, D-014)
import { Router } from 'express';
import { z } from 'zod';
import { validateQuery, validateParams } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/notificationService.js';

const notificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .default(false),
});

const notificationIdParams = z.object({
  notificationId: z.coerce.number().int().positive(),
});

export function createNotificationsRouter({ pool, jwtSecret, nowFn }) {
  const router = Router();
  const auth = requireAuth(pool, jwtSecret);

  router.get('/', auth, validateQuery(notificationsQuerySchema), async (req, res, next) => {
    try {
      const result = await listMyNotifications(pool, req.user, req.query, nowFn());
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  router.patch(
    '/:notificationId/read',
    auth,
    validateParams(notificationIdParams),
    async (req, res, next) => {
      try {
        const result = await markNotificationRead(pool, req.user, req.params.notificationId);
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post('/read-all', auth, async (req, res, next) => {
    try {
      const result = await markAllNotificationsRead(pool, req.user);
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
