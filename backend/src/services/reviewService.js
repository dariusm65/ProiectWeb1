// Post-arrival mutual star ratings & public reputation service:
// - POST /api/rides/:rideId/reviews (createRideReview)
// - GET /api/users/:userId/reviews & GET /api/users/:userId (getUserReviewsAndReputation)
// (D-008, D-011, D-013, D-014, D-016, D-020)
import { ApiError } from '../errors.js';
import { UNIVERSITY_BADGE_NOTE } from '../domain/universityDomains.js';
import { computeSeriousnessScore, hasRecentCancellationBadge } from '../domain/seriousnessScore.js';
import { reconcileRidesLazily } from './rideService.js';

const badge = (domain) => ({
  has_university_badge: Boolean(domain),
  university_badge_note: domain ? UNIVERSITY_BADGE_NOTE : null,
});

function formatReview(row) {
  return {
    id: row.id,
    ride_id: row.ride_id,
    reviewer_id: row.reviewer_id,
    reviewed_user_id: row.reviewed_user_id,
    rating_stars: row.rating_stars,
    comment: row.comment ?? null,
    created_at: row.created_at,
    reviewer: {
      id: row.reviewer_id,
      full_name: row.reviewer_name,
      ...badge(row.reviewer_domain),
    },
  };
}

/**
 * Pure D-008 eligibility validation for mutual star ratings:
 * 1. Ride cannot be `cancelled` (409 RIDE_CANCELLED).
 * 2. Ride's `estimated_arrival_time` must have passed (`estimated_arrival_time <= now`) (403 REVIEW_BEFORE_ARRIVAL).
 * 3. Cannot self-review (`reviewerId !== reviewedUserId`) (400 SELF_REVIEW_NOT_ALLOWED).
 * 4. Strictly mutual between the ride's driver and a passenger with a `confirmed` booking on that ride
 *    (driver -> confirmed passenger, or confirmed passenger -> driver) (403 NOT_CONFIRMED_PARTICIPANT).
 */
export function evaluateReviewEligibility({ ride, bookings, reviewerId, reviewedUserId, now }) {
  if (!ride) {
    throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
  }
  if (reviewerId === reviewedUserId) {
    throw new ApiError(400, 'SELF_REVIEW_NOT_ALLOWED', 'You cannot submit a star rating for yourself');
  }
  if (ride.status === 'cancelled') {
    throw new ApiError(409, 'RIDE_CANCELLED', 'Star ratings cannot be submitted for cancelled rides (D-008)');
  }
  if (new Date(ride.estimated_arrival_time).getTime() > new Date(now).getTime()) {
    throw new ApiError(
      403,
      'REVIEW_BEFORE_ARRIVAL',
      'Star ratings are locked until after the ride estimated arrival time has passed (D-008)',
    );
  }

  const confirmedPassengerIds = new Set(
    bookings.filter((b) => b.status === 'confirmed').map((b) => b.passenger_id),
  );

  const isDriverReviewingConfirmedPax =
    reviewerId === ride.driver_id && confirmedPassengerIds.has(reviewedUserId);
  const isConfirmedPaxReviewingDriver =
    confirmedPassengerIds.has(reviewerId) && reviewedUserId === ride.driver_id;

  if (!isDriverReviewingConfirmedPax && !isConfirmedPaxReviewingDriver) {
    throw new ApiError(
      403,
      'NOT_CONFIRMED_PARTICIPANT',
      'Mutual star ratings are restricted to the ride driver and passengers with a confirmed booking on this ride',
    );
  }

  return true;
}

/**
 * POST /api/rides/:rideId/reviews (authenticated, D-008):
 * Submits a 1–5 star rating (with optional trimmed comment) after lazy reconciliation on the ride.
 * Enforces 1 review per `(ride_id, reviewer_id, reviewed_user_id)` pair (`409 DUPLICATE_REVIEW`).
 */
export async function createRideReview(
  pool,
  user,
  rideId,
  { reviewed_user_id: reviewedUserId, rating_stars: ratingStars, comment = null },
  now,
) {
  const [rideRows] = await pool.query('SELECT * FROM rides WHERE id = ?', [rideId]);
  if (rideRows.length === 0) {
    throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
  }

  // Reconcile lazy expirations/lapses before checking confirmed bookings
  await reconcileRidesLazily(pool, [rideId], now);

  const [[ride]] = await pool.query('SELECT * FROM rides WHERE id = ?', [rideId]);
  const [bookings] = await pool.query(
    'SELECT id, passenger_id, status FROM bookings WHERE ride_id = ?',
    [rideId],
  );

  evaluateReviewEligibility({
    ride,
    bookings,
    reviewerId: user.id,
    reviewedUserId,
    now,
  });

  let reviewId;
  try {
    const [res] = await pool.query(
      `INSERT INTO reviews (ride_id, reviewer_id, reviewed_user_id, rating_stars, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rideId, user.id, reviewedUserId, ratingStars, comment, now],
    );
    reviewId = res.insertId;
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      throw new ApiError(
        409,
        'DUPLICATE_REVIEW',
        'You have already submitted a star rating for this participant on this ride',
      );
    }
    throw err;
  }

  await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
     VALUES (?, 'review_received', 'Ai primit o evaluare nouă', ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      reviewedUserId,
      `${user.full_name} ți-a acordat ${ratingStars} stele pentru cursa ${ride.origin_name} → ${ride.destination_name}.`,
      `review_received:${reviewId}`,
    ],
  );

  const [[created]] = await pool.query(
    `SELECT r.id, r.ride_id, r.reviewer_id, r.reviewed_user_id, r.rating_stars, r.comment, r.created_at,
            u.full_name AS reviewer_name, u.university_domain AS reviewer_domain
     FROM reviews r
     JOIN users u ON u.id = r.reviewer_id
     WHERE r.id = ?`,
    [reviewId],
  );

  return formatReview(created);
}

/**
 * GET /api/users/:userId/reviews & GET /api/users/:userId (public, D-008, D-016):
 * Returns safe public user profile, dual reputation summary (star rating average + count,
 * seriousness score %, university domain badge + note, 30-day "Anulare recentă" badge),
 * and chronological reviews list without exposing PII (`email`, `phone`, `gender`, `password_hash` omitted).
 */
export async function getUserReviewsAndReputation(pool, userId, now) {
  const [userRows] = await pool.query(
    'SELECT id, full_name, university_domain, created_at FROM users WHERE id = ?',
    [userId],
  );
  if (userRows.length === 0) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
  const u = userRows[0];

  const [[rating]] = await pool.query(
    'SELECT AVG(rating_stars) AS avg_stars, COUNT(*) AS n FROM reviews WHERE reviewed_user_id = ?',
    [userId],
  );
  const [infractions] = await pool.query(
    'SELECT infraction_type, penalty_percentage_points, occurred_at FROM user_infractions WHERE user_id = ?',
    [userId],
  );
  const [reviewRows] = await pool.query(
    `SELECT r.id, r.ride_id, r.reviewer_id, r.reviewed_user_id, r.rating_stars, r.comment, r.created_at,
            ru.full_name AS reviewer_name, ru.university_domain AS reviewer_domain
     FROM reviews r
     JOIN users ru ON ru.id = r.reviewer_id
     WHERE r.reviewed_user_id = ?
     ORDER BY r.created_at DESC, r.id DESC`,
    [userId],
  );

  return {
    user: {
      id: u.id,
      full_name: u.full_name,
      ...badge(u.university_domain),
      rating_average: rating.n > 0 ? Math.round(Number(rating.avg_stars) * 10) / 10 : null,
      rating_count: Number(rating.n),
      seriousness_score: computeSeriousnessScore(infractions, now),
      has_recent_cancellation_badge: hasRecentCancellationBadge(infractions, now),
      created_at: u.created_at,
    },
    reviews: reviewRows.map(formatReview),
  };
}
