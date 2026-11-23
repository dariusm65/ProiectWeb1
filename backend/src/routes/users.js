// Public user profile & reviews routes:
// - GET /api/users/:userId/reviews
// - GET /api/users/:userId
// (D-008, D-014, D-016)
import { Router } from 'express';
import { z } from 'zod';
import { validateParams } from '../middleware/validate.js';
import { getUserReviewsAndReputation } from '../services/reviewService.js';

const userIdParams = z.object({
  userId: z.coerce.number().int().positive(),
});

export function createUsersRouter({ pool, nowFn }) {
  const router = Router();

  const handleGetProfileAndReviews = [
    validateParams(userIdParams),
    async (req, res, next) => {
      try {
        const result = await getUserReviewsAndReputation(pool, req.params.userId, nowFn());
        return res.status(200).json(result);
      } catch (err) {
        return next(err);
      }
    },
  ];

  router.get('/:userId/reviews', ...handleGetProfileAndReviews);
  router.get('/:userId', ...handleGetProfileAndReviews);

  return router;
}
