// Bookings routes:
// - GET /api/bookings/me
// - POST /api/bookings/:bookingId/accept
// - POST /api/bookings/:bookingId/reject
// - POST /api/bookings/:bookingId/reconfirm
// - POST /api/bookings/:bookingId/cancel
// (D-003, D-005, D-007, D-010, D-011, D-013, D-014, D-016)
import { Router } from 'express';
import { z } from 'zod';
import { validateParams } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  listMyBookings,
  acceptBookingForDriver,
  rejectBooking,
  reconfirmBooking,
  cancelBookingByPassenger,
} from '../services/bookingService.js';

const bookingIdParams = z.object({ bookingId: z.coerce.number().int().positive() });

export function createBookingsRouter({ pool, jwtSecret, nowFn }) {
  const router = Router();
  const auth = requireAuth(pool, jwtSecret);

  router.get('/me', auth, async (req, res, next) => {
    try {
      const bookings = await listMyBookings(pool, req.user, nowFn());
      return res.status(200).json({ bookings });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:bookingId/accept', auth, validateParams(bookingIdParams), async (req, res, next) => {
    try {
      const result = await acceptBookingForDriver(pool, req.user, req.params.bookingId, nowFn());
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:bookingId/reject', auth, validateParams(bookingIdParams), async (req, res, next) => {
    try {
      const booking = await rejectBooking(pool, req.user, req.params.bookingId, nowFn());
      return res.status(200).json({ booking });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:bookingId/reconfirm', auth, validateParams(bookingIdParams), async (req, res, next) => {
    try {
      const booking = await reconfirmBooking(pool, req.user, req.params.bookingId, nowFn());
      return res.status(200).json({ booking });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:bookingId/cancel', auth, validateParams(bookingIdParams), async (req, res, next) => {
    try {
      const result = await cancelBookingByPassenger(pool, req.user, req.params.bookingId, nowFn());
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
