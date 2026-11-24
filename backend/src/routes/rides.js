// Ride routes: POST /api/rides, GET /api/rides (search), GET /api/rides/:rideId,
// POST /api/rides/:rideId/bookings, GET /api/rides/:rideId/bookings,
// PATCH/PUT /api/rides/:rideId/stops, POST /api/rides/:rideId/cancel,
// GET /api/rides/:rideId/messages, POST /api/rides/:rideId/messages,
// POST /api/rides/:rideId/reviews
// (D-003, D-005, D-007, D-008, D-010, D-011, D-013, D-014, D-016, D-017, D-018, D-019).
import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { numericParam } from './geocoding.js';
import { dayOfWeekName } from '../domain/recurrence.js';
import {
  publishRide,
  getRideDetails,
  searchRides,
  editRideStops,
  cancelRide,
  listMyDrivenRides,
  completeRide,
} from '../services/rideService.js';
import { createBooking, listRideBookings } from '../services/bookingService.js';
import { materialiseForDate } from '../services/recurringRideService.js';
import { listRideMessages, postRideMessage } from '../services/chatService.js';
import { createRideReview } from '../services/reviewService.js';

export const MAX_STOPS = 20;

/** 'YYYY-MM-DD' that is a real calendar date. */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    try {
      dayOfWeekName(d);
      return true;
    } catch {
      return false;
    }
  }, { message: 'Invalid calendar date' });

const money = z
  .number()
  .min(0)
  .max(100000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'At most 2 decimal places' });

/** Fields shared by a single ride and a recurring rule (everything except the schedule). */
export const sharedRideFields = {
  available_seats: z.number().int().min(1).max(8),
  declared_trip_cost: money,
  luggage_allowed: z.boolean().default(true),
  pets_allowed: z.boolean().default(false),
  smoking_allowed: z.boolean().default(false),
  women_only: z.boolean().default(false),
};

/** Stop fields common to rides and rules; stop_order is assigned by the server (10, 20, 30...). */
export const stopBaseFields = {
  city_name: z.string().trim().min(1).max(100),
  location_name: z.string().trim().min(1).max(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  distance_from_origin_km: z.number().int().min(0),
};

/** First stop at 0 km, last stop beyond 0 km, distances strictly increasing. */
export function checkDistances(stops, ctx) {
  stops.forEach((s, i) => {
    if (i === 0 && s.distance_from_origin_km !== 0) {
      ctx.addIssue({ code: 'custom', path: [i, 'distance_from_origin_km'], message: 'First stop must be at 0 km' });
    }
    if (i > 0 && s.distance_from_origin_km <= stops[i - 1].distance_from_origin_km) {
      ctx.addIssue({ code: 'custom', path: [i, 'distance_from_origin_km'], message: 'Distances must be strictly increasing' });
    }
  });
}

const rideStop = z.object({
  ...stopBaseFields,
  estimated_arrival_time: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

const publishSchema = z.object({
  ...sharedRideFields,
  stops: z
    .array(rideStop)
    .min(2)
    .max(MAX_STOPS)
    .superRefine((stops, ctx) => {
      checkDistances(stops, ctx);
      stops.forEach((s, i) => {
        if (i > 0 && s.estimated_arrival_time.getTime() <= stops[i - 1].estimated_arrival_time.getTime()) {
          ctx.addIssue({ code: 'custom', path: [i, 'estimated_arrival_time'], message: 'Arrival times must be strictly increasing' });
        }
      });
    }),
});

const optionalBool = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

const optionalDateString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(dateString.optional());

const searchSchema = z.object({
  originLat: numericParam(-90, 90),
  originLng: numericParam(-180, 180),
  destLat: numericParam(-90, 90),
  destLng: numericParam(-180, 180),
  date: optionalDateString,
  // D-017: default 1 km, maximum 5 km
  radiusKm: z.string().trim().min(1).pipe(z.coerce.number().gt(0).max(5)).optional().default(1),
  universityOnly: optionalBool,
  womenOnly: optionalBool,
  luggageAllowed: optionalBool,
  petsAllowed: optionalBool,
  smokingAllowed: optionalBool,
});

const rideIdParams = z.object({ rideId: z.coerce.number().int().positive() });

const createBookingSchema = z.object({
  pickup_stop_id: z.number().int().positive(),
  dropoff_stop_id: z.number().int().positive(),
});

const postChatMessageSchema = z.object({
  message_text: z.string().trim().min(1).max(2000),
});

const createReviewSchema = z.object({
  reviewed_user_id: z.number().int().positive(),
  rating_stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).nullable().optional(),
});

const editableStop = z.object({
  id: z.number().int().positive().optional(),
  ...stopBaseFields,
  estimated_arrival_time: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

const editStopsSchema = z.object({
  stops: z
    .array(editableStop)
    .min(2)
    .max(MAX_STOPS)
    .superRefine((stops, ctx) => {
      checkDistances(stops, ctx);
      stops.forEach((s, i) => {
        if (i > 0 && s.estimated_arrival_time.getTime() <= stops[i - 1].estimated_arrival_time.getTime()) {
          ctx.addIssue({ code: 'custom', path: [i, 'estimated_arrival_time'], message: 'Arrival times must be strictly increasing' });
        }
      });
    }),
});

export function createRidesRouter({ pool, jwtSecret, nowFn }) {
  const router = Router();
  const auth = requireAuth(pool, jwtSecret);

  router.post('/', auth, validateBody(publishSchema), async (req, res, next) => {
    try {
      const now = nowFn();
      const rideId = await publishRide(pool, req.user, req.body, now);
      return res.status(201).json(await getRideDetails(pool, rideId, now));
    } catch (err) {
      return next(err);
    }
  });

  router.get('/', validateQuery(searchSchema), async (req, res, next) => {
    try {
      const now = nowFn();
      if (req.query.date) {
        await materialiseForDate(pool, req.query.date, now);
      }
      return res.status(200).json({ rides: await searchRides(pool, req.query, now) });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', auth, async (req, res, next) => {
    try {
      const rides = await listMyDrivenRides(pool, req.user, nowFn());
      return res.status(200).json({ rides });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:rideId', validateParams(rideIdParams), async (req, res, next) => {
    try {
      return res.status(200).json(await getRideDetails(pool, req.params.rideId, nowFn()));
    } catch (err) {
      return next(err);
    }
  });

  router.post(
    '/:rideId/bookings',
    auth,
    validateParams(rideIdParams),
    validateBody(createBookingSchema),
    async (req, res, next) => {
      try {
        const booking = await createBooking(pool, req.user, req.params.rideId, req.body, nowFn());
        return res.status(201).json({ booking });
      } catch (err) {
        return next(err);
      }
    },
  );

  router.get('/:rideId/bookings', auth, validateParams(rideIdParams), async (req, res, next) => {
    try {
      const bookings = await listRideBookings(pool, req.user, req.params.rideId, nowFn());
      return res.status(200).json({ bookings });
    } catch (err) {
      return next(err);
    }
  });

  const handleEditStops = [
    auth,
    validateParams(rideIdParams),
    validateBody(editStopsSchema),
    async (req, res, next) => {
      try {
        const details = await editRideStops(pool, req.user, req.params.rideId, req.body, nowFn());
        return res.status(200).json(details);
      } catch (err) {
        return next(err);
      }
    },
  ];
  router.patch('/:rideId/stops', ...handleEditStops);
  router.put('/:rideId/stops', ...handleEditStops);

  router.post('/:rideId/cancel', auth, validateParams(rideIdParams), async (req, res, next) => {
    try {
      const result = await cancelRide(pool, req.user, req.params.rideId, nowFn());
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:rideId/complete', auth, validateParams(rideIdParams), async (req, res, next) => {
    try {
      const result = await completeRide(pool, req.user, req.params.rideId, nowFn());
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/:rideId/messages', auth, validateParams(rideIdParams), async (req, res, next) => {
    try {
      const messages = await listRideMessages(pool, req.user, req.params.rideId, nowFn());
      return res.status(200).json({ messages });
    } catch (err) {
      return next(err);
    }
  });

  router.post(
    '/:rideId/messages',
    auth,
    validateParams(rideIdParams),
    validateBody(postChatMessageSchema),
    async (req, res, next) => {
      try {
        const message = await postRideMessage(pool, req.user, req.params.rideId, req.body, nowFn());
        return res.status(201).json({ message });
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/:rideId/reviews',
    auth,
    validateParams(rideIdParams),
    validateBody(createReviewSchema),
    async (req, res, next) => {
      try {
        const review = await createRideReview(pool, req.user, req.params.rideId, req.body, nowFn());
        return res.status(201).json({ review });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
