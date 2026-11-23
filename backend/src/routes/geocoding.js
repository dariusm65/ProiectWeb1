// Geocoding routes: GET /api/geocoding/search, GET /api/geocoding/reverse (D-009, D-014).
import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate.js';

/** Query-string number in [min, max]; rejects empty strings (which Number() would turn into 0). */
export const numericParam = (min, max) =>
  z.string().trim().min(1).pipe(z.coerce.number().min(min).max(max));

const searchSchema = z.object({
  q: z.string().trim().min(2).max(200),
});

const reverseSchema = z.object({
  lat: numericParam(-90, 90),
  lng: numericParam(-180, 180),
});

export function createGeocodingRouter({ geocoding }) {
  const router = Router();

  router.get('/search', validateQuery(searchSchema), async (req, res, next) => {
    try {
      return res.status(200).json(await geocoding.search(req.query.q));
    } catch (err) {
      return next(err);
    }
  });

  router.get('/reverse', validateQuery(reverseSchema), async (req, res, next) => {
    try {
      return res.status(200).json(await geocoding.reverse(req.query.lat, req.query.lng));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
