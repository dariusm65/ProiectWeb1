// Transactional booking lifecycle service:
// - POST /api/rides/:rideId/bookings (createBooking)
// - POST /api/bookings/:bookingId/accept (acceptBookingForDriver)
// - POST /api/bookings/:bookingId/reject (rejectBooking)
// - POST /api/bookings/:bookingId/reconfirm (reconfirmBooking)
// - POST /api/bookings/:bookingId/cancel (cancelBookingByPassenger)
// - GET /api/bookings/me (listMyBookings)
// - GET /api/rides/:rideId/bookings (listRideBookings)
// (D-003, D-005, D-007, D-010, D-011, D-013, D-016, D-018, D-019)
import { ApiError } from '../errors.js';
import { UNIVERSITY_BADGE_NOTE } from '../domain/universityDomains.js';
import { getAvailableSeatsForRange } from '../domain/segmentAvailability.js';
import { calculateSegmentPrice, validateTripCostCap } from '../domain/segmentPricing.js';
import {
  isWithinPassengerLateCancelWindow,
  calculatePassengerCancellationFee,
} from '../domain/seriousnessScore.js';
import {
  BookingDomainError,
  acceptBooking,
  reconcileRideBookings,
} from './bookingAcceptanceService.js';
import { reconcileRidesLazily } from './rideService.js';

const NON_TERMINAL_STATUSES = new Set(['pending', 'confirmed', 'pending_reconfirmation']);
const PASSENGER_LATE_CANCEL_PENALTY = 3; // D-016

const DOMAIN_ERROR_STATUS = {
  INVALID_INPUT: 400,
  RIDE_NOT_FOUND: 404,
  BOOKING_NOT_FOUND: 404,
  FORBIDDEN: 403,
  SELF_BOOKING_NOT_ALLOWED: 403,
  USER_SUSPENDED: 403,
  PASSENGER_SUSPENDED: 403,
  RIDE_NOT_ACTIVE: 409,
  BOOKING_NOT_PENDING: 409,
  DUPLICATE_ACTIVE_BOOKING: 409,
  STOP_REMOVED: 409,
  NO_SEATS_AVAILABLE: 409,
  TRIP_COST_CAP_EXCEEDED: 409,
};

function mapBookingDomainError(err) {
  if (err instanceof BookingDomainError) {
    const status = DOMAIN_ERROR_STATUS[err.code] || 400;
    const rawMsg = err.message.startsWith(`${err.code}: `)
      ? err.message.slice(err.code.length + 2)
      : err.message;
    return new ApiError(status, err.code, rawMsg);
  }
  return err;
}

const badge = (domain) => ({
  has_university_badge: Boolean(domain),
  university_badge_note: domain ? UNIVERSITY_BADGE_NOTE : null,
});

function formatEnrichedBooking(row) {
  return {
    id: row.id,
    ride_id: row.ride_id,
    passenger_id: row.passenger_id,
    pickup_stop_id: row.pickup_stop_id,
    dropoff_stop_id: row.dropoff_stop_id,
    pickup_stop_name: row.pickup_stop_name,
    dropoff_stop_name: row.dropoff_stop_name,
    pickup_stop_order: row.pickup_stop_order,
    dropoff_stop_order: row.dropoff_stop_order,
    pickup_stop_removed: row.pickup_removed_at != null,
    dropoff_stop_removed: row.dropoff_removed_at != null,
    price_lei: row.price_lei,
    segment_price_lei: row.price_lei,
    status: row.status,
    reconfirm_deadline: row.reconfirm_deadline,
    // D-003 & A-1: pending requests expire at the ride's departure_time
    expires_at: row.status === 'pending' ? row.ride_departure_time : null,
    cancellation_fee_lei: row.cancellation_fee_lei,
    created_at: row.created_at,
    passenger: {
      id: row.passenger_id,
      full_name: row.passenger_name,
      ...badge(row.passenger_domain),
    },
    ride: {
      id: row.ride_id,
      driver_id: row.driver_id,
      origin_name: row.origin_name,
      destination_name: row.destination_name,
      departure_time: row.ride_departure_time,
      estimated_arrival_time: row.ride_arrival_time,
      status: row.ride_status,
      women_only: Boolean(row.women_only),
    },
  };
}

const BOOKING_SELECT_SQL = `
  SELECT b.*,
         ps.location_name AS pickup_stop_name, ps.stop_order AS pickup_stop_order, ps.removed_at AS pickup_removed_at,
         ds.location_name AS dropoff_stop_name, ds.stop_order AS dropoff_stop_order, ds.removed_at AS dropoff_removed_at,
         u.full_name AS passenger_name, u.university_domain AS passenger_domain,
         r.driver_id, r.origin_name, r.destination_name,
         r.departure_time AS ride_departure_time, r.estimated_arrival_time AS ride_arrival_time,
         r.status AS ride_status, r.women_only
  FROM bookings b
  JOIN ride_stops ps ON ps.id = b.pickup_stop_id
  JOIN ride_stops ds ON ds.id = b.dropoff_stop_id
  JOIN users u ON u.id = b.passenger_id
  JOIN rides r ON r.id = b.ride_id
`;

export async function getBookingById(pool, bookingId) {
  const [rows] = await pool.query(`${BOOKING_SELECT_SQL} WHERE b.id = ?`, [bookingId]);
  if (rows.length === 0) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  return formatEnrichedBooking(rows[0]);
}

async function finishTx(conn, err, hasReconciledChanges, hasMutatedTarget) {
  if (err instanceof ApiError && hasReconciledChanges && !hasMutatedTarget) {
    await conn.commit();
  } else {
    try {
      await conn.rollback();
    } catch {
      // preserve original error
    }
  }
}

/**
 * POST /api/rides/:rideId/bookings (authenticated passenger):
 * Request 1 seat (D-019) between pickup_stop_id and dropoff_stop_id.
 */
export async function createBooking(pool, user, rideId, { pickup_stop_id: pickupStopId, dropoff_stop_id: dropoffStopId }, now) {
  if (pickupStopId === dropoffStopId) {
    throw new ApiError(400, 'INVALID_STOP_RANGE', 'Pickup and dropoff stops must be different');
  }

  const conn = await pool.getConnection();
  let hasReconciledChanges = false;
  let hasMutatedTarget = false;

  try {
    await conn.beginTransaction();

    // Canonical lock order: rides -> ride_stops -> bookings
    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [rideId]);
    if (rideRows.length === 0) {
      throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    }
    const ride = rideRows[0];

    const [stops] = await conn.query(
      'SELECT * FROM ride_stops WHERE ride_id = ? ORDER BY stop_order ASC FOR UPDATE',
      [rideId],
    );
    const [bookings] = await conn.query(
      'SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE',
      [rideId],
    );
    bookings.sort((a, b) => a.id - b.id);

    const { expiredIds, lapsedIds } = await reconcileRideBookings(conn, {
      rideId,
      ride,
      bookings,
      now,
    });
    hasReconciledChanges = expiredIds.length > 0 || lapsedIds.length > 0;

    if (ride.status !== 'active') {
      throw new ApiError(409, 'RIDE_NOT_ACTIVE', `Ride is not active (status: ${ride.status})`);
    }
    if (new Date(ride.departure_time).getTime() <= now.getTime()) {
      throw new ApiError(400, 'DEPARTURE_IN_PAST', 'Cannot book a ride that has already departed');
    }
    if (ride.driver_id === user.id) {
      throw new ApiError(403, 'SELF_BOOKING_NOT_ALLOWED', 'Driver cannot book their own ride');
    }
    if (ride.women_only && user.gender !== 'female') {
      throw new ApiError(403, 'WOMEN_ONLY_NOT_ALLOWED', 'Only accounts with gender "female" may book women-only rides');
    }

    const stopById = new Map(stops.map((s) => [s.id, s]));
    const pickup = stopById.get(pickupStopId);
    const dropoff = stopById.get(dropoffStopId);
    if (!pickup || !dropoff || pickup.removed_at != null || dropoff.removed_at != null) {
      throw new ApiError(400, 'INVALID_STOP', 'Pickup and dropoff stops must be active stops on this ride');
    }
    if (pickup.stop_order >= dropoff.stop_order) {
      throw new ApiError(400, 'INVALID_STOP_RANGE', 'Pickup stop must come before dropoff stop');
    }

    // D-019 & A-3: prevent duplicate non-terminal booking by same passenger on same ride
    const hasDuplicate = bookings.some(
      (b) => b.passenger_id === user.id && NON_TERMINAL_STATUSES.has(b.status),
    );
    if (hasDuplicate) {
      throw new ApiError(
        409,
        'DUPLICATE_ACTIVE_BOOKING',
        'You already have an active or pending booking on this ride',
      );
    }

    const freeSeats = getAvailableSeatsForRange({
      stops,
      bookings,
      availableSeats: ride.available_seats,
      pickupStopId,
      dropoffStopId,
    });
    if (freeSeats < 1) {
      throw new ApiError(409, 'NO_SEATS_AVAILABLE', 'No free seats available on the requested segment');
    }

    const activeStops = stops.filter((s) => s.removed_at == null).sort((a, b) => a.stop_order - b.stop_order);
    const totalDistKm = activeStops[activeStops.length - 1].distance_from_origin_km;
    const priceLei = calculateSegmentPrice({
      declaredTripCost: ride.declared_trip_cost,
      availableSeats: ride.available_seats,
      pickupDistKm: pickup.distance_from_origin_km,
      dropoffDistKm: dropoff.distance_from_origin_km,
      totalDistKm,
    });

    const capCheck = validateTripCostCap({
      declaredTripCost: ride.declared_trip_cost,
      existingBookings: bookings,
      additionalPriceLei: priceLei,
    });
    if (!capCheck.withinCap) {
      throw new ApiError(409, 'TRIP_COST_CAP_EXCEEDED', 'Booking would exceed the declared trip cost cap');
    }

    hasMutatedTarget = true;
    const [res] = await conn.query(
      `INSERT INTO bookings (ride_id, passenger_id, pickup_stop_id, dropoff_stop_id, price_lei, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [rideId, user.id, pickupStopId, dropoffStopId, priceLei],
    );
    const bookingId = res.insertId;

    await conn.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES (?, 'booking_requested', 'Cerere nouă de rezervare', ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [
        ride.driver_id,
        `${user.full_name} a solicitat 1 loc pe segmentul ${pickup.location_name} → ${dropoff.location_name} (${priceLei} lei).`,
        `booking_requested:${bookingId}`,
      ],
    );

    await conn.commit();
    return await getBookingById(pool, bookingId);
  } catch (err) {
    await finishTx(conn, err, hasReconciledChanges, hasMutatedTarget);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/bookings/:bookingId/accept (driver only):
 * Delegates to transactional acceptBooking (SELECT FOR UPDATE + D-003 selective rejection + D-011 notifications).
 */
export async function acceptBookingForDriver(pool, user, bookingId, now) {
  const [rows] = await pool.query('SELECT id, ride_id FROM bookings WHERE id = ?', [bookingId]);
  if (rows.length === 0) {
    throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  const rideId = rows[0].ride_id;

  try {
    const result = await acceptBooking(pool, {
      rideId,
      bookingId,
      driverId: user.id,
      now,
    });
    const booking = await getBookingById(pool, bookingId);
    return {
      booking,
      auto_rejected_ids: result.autoRejectedIds,
      kept_pending_ids: result.keptPendingIds,
    };
  } catch (err) {
    throw mapBookingDomainError(err);
  }
}

/**
 * POST /api/bookings/:bookingId/reject (driver only):
 * Rejects a pending booking inside a FOR UPDATE transaction after lazy reconciliation.
 */
export async function rejectBooking(pool, user, bookingId, now) {
  const [lookup] = await pool.query('SELECT id, ride_id FROM bookings WHERE id = ?', [bookingId]);
  if (lookup.length === 0) {
    throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  const rideId = lookup[0].ride_id;

  const conn = await pool.getConnection();
  let hasReconciledChanges = false;
  let hasMutatedTarget = false;

  try {
    await conn.beginTransaction();

    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [rideId]);
    if (rideRows.length === 0) {
      throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    }
    const ride = rideRows[0];

    if (ride.driver_id !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the ride driver can reject bookings');
    }
    if (ride.status !== 'active') {
      throw new ApiError(409, 'RIDE_NOT_ACTIVE', `Ride is not active (status: ${ride.status})`);
    }

    const [bookings] = await conn.query('SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE', [rideId]);
    bookings.sort((a, b) => a.id - b.id);

    const { expiredIds, lapsedIds } = await reconcileRideBookings(conn, {
      rideId,
      ride,
      bookings,
      now,
    });
    hasReconciledChanges = expiredIds.length > 0 || lapsedIds.length > 0;

    const target = bookings.find((b) => b.id === bookingId);
    if (!target) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    if (target.status !== 'pending') {
      throw new ApiError(409, 'BOOKING_NOT_PENDING', `Booking cannot be rejected (current status: ${target.status})`);
    }

    hasMutatedTarget = true;
    await conn.query("UPDATE bookings SET status = 'rejected' WHERE id = ?", [bookingId]);
    await conn.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES (?, 'booking_rejected', 'Cerere de rezervare respinsă', ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [
        target.passenger_id,
        `Cererea ta de rezervare pentru cursa ${ride.origin_name} → ${ride.destination_name} a fost respinsă de șofer.`,
        `booking_rejected:${bookingId}`,
      ],
    );

    await conn.commit();
    return await getBookingById(pool, bookingId);
  } catch (err) {
    await finishTx(conn, err, hasReconciledChanges, hasMutatedTarget);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/bookings/:bookingId/reconfirm (passenger only, D-007):
 * Reconfirms a pending_reconfirmation booking before reconfirm_deadline.
 * If overdue, reconcileRideBookings lazily transitions it to expired and we commit before throwing 409.
 * If the booking's own pickup or dropoff stop was soft-removed, returns 409 STOP_REMOVED.
 */
export async function reconfirmBooking(pool, user, bookingId, now) {
  const [lookup] = await pool.query('SELECT id, ride_id FROM bookings WHERE id = ?', [bookingId]);
  if (lookup.length === 0) {
    throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  const rideId = lookup[0].ride_id;

  const conn = await pool.getConnection();
  let hasReconciledChanges = false;
  let hasMutatedTarget = false;

  try {
    await conn.beginTransaction();

    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [rideId]);
    if (rideRows.length === 0) {
      throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    }
    const ride = rideRows[0];

    const [stops] = await conn.query(
      'SELECT * FROM ride_stops WHERE ride_id = ? ORDER BY stop_order ASC FOR UPDATE',
      [rideId],
    );
    const [bookings] = await conn.query('SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE', [rideId]);
    bookings.sort((a, b) => a.id - b.id);

    const { expiredIds, lapsedIds } = await reconcileRideBookings(conn, {
      rideId,
      ride,
      bookings,
      now,
    });
    hasReconciledChanges = expiredIds.length > 0 || lapsedIds.length > 0;

    const target = bookings.find((b) => b.id === bookingId);
    if (!target) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    if (target.passenger_id !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the booking passenger can reconfirm this booking');
    }
    if (ride.status !== 'active') {
      throw new ApiError(409, 'RIDE_NOT_ACTIVE', `Ride is not active (status: ${ride.status})`);
    }
    if (target.status !== 'pending_reconfirmation') {
      throw new ApiError(
        409,
        'BOOKING_NOT_PENDING_RECONFIRMATION',
        `Booking cannot be reconfirmed (current status: ${target.status})`,
      );
    }

    const stopById = new Map(stops.map((s) => [s.id, s]));
    const pickup = stopById.get(target.pickup_stop_id);
    const dropoff = stopById.get(target.dropoff_stop_id);
    if (!pickup || !dropoff || pickup.removed_at != null || dropoff.removed_at != null) {
      throw new ApiError(
        409,
        'STOP_REMOVED',
        'Your pickup or dropoff stop was removed by the driver; please cancel this booking free of penalty',
      );
    }

    const [[prevReconf]] = await conn.query(
      "SELECT COUNT(*) AS n FROM notifications WHERE type = 'booking_reconfirmed' AND idempotency_key LIKE ?",
      [`booking_reconfirmed:${bookingId}%`],
    );
    const reconfKey = prevReconf.n === 0
      ? `booking_reconfirmed:${bookingId}`
      : `booking_reconfirmed:${bookingId}:${prevReconf.n + 1}`;

    hasMutatedTarget = true;
    await conn.query(
      "UPDATE bookings SET status = 'confirmed', reconfirm_deadline = NULL WHERE id = ?",
      [bookingId],
    );
    await conn.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES (?, 'booking_reconfirmed', 'Rezervare reconfirmată de pasager', ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [
        ride.driver_id,
        `${user.full_name} a reconfirmat rezervarea pentru cursa ${ride.origin_name} → ${ride.destination_name}.`,
        reconfKey,
      ],
    );

    await conn.commit();
    return await getBookingById(pool, bookingId);
  } catch (err) {
    await finishTx(conn, err, hasReconciledChanges, hasMutatedTarget);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * POST /api/bookings/:bookingId/cancel (passenger only, D-016):
 * Cancels a passenger's own pending, confirmed, or pending_reconfirmation booking.
 * If the booking was `confirmed` and cancelled < 4 hours before departure, records a
 * `passenger_late_cancel` (-3 pp) infraction and sets `cancellation_fee_lei = min(20, round(0.5 * price_lei))`.
 * Bookings in `pending` or `pending_reconfirmation` (or cancelled >= 4h before departure) incur no penalty.
 */
export async function cancelBookingByPassenger(pool, user, bookingId, now) {
  const [lookup] = await pool.query('SELECT id, ride_id FROM bookings WHERE id = ?', [bookingId]);
  if (lookup.length === 0) {
    throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  const rideId = lookup[0].ride_id;

  const conn = await pool.getConnection();
  let hasReconciledChanges = false;
  let hasMutatedTarget = false;

  try {
    await conn.beginTransaction();

    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [rideId]);
    if (rideRows.length === 0) {
      throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
    }
    const ride = rideRows[0];

    const [bookings] = await conn.query('SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE', [rideId]);
    bookings.sort((a, b) => a.id - b.id);

    const { expiredIds, lapsedIds } = await reconcileRideBookings(conn, {
      rideId,
      ride,
      bookings,
      now,
    });
    hasReconciledChanges = expiredIds.length > 0 || lapsedIds.length > 0;

    const target = bookings.find((b) => b.id === bookingId);
    if (!target) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    if (target.passenger_id !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the booking passenger can cancel this booking');
    }
    if (!NON_TERMINAL_STATUSES.has(target.status)) {
      throw new ApiError(
        409,
        'BOOKING_NOT_CANCELLABLE',
        `Booking cannot be cancelled (current status: ${target.status})`,
      );
    }
    if (new Date(ride.departure_time).getTime() <= now.getTime()) {
      throw new ApiError(400, 'DEPARTURE_IN_PAST', 'Cannot cancel a booking after departure');
    }

    const previousStatus = target.status;
    const isLateConfirmedCancel =
      previousStatus === 'confirmed' &&
      isWithinPassengerLateCancelWindow({ departureTime: ride.departure_time, now });

    const cancellationFeeLei = isLateConfirmedCancel
      ? calculatePassengerCancellationFee(target.price_lei)
      : null;

    hasMutatedTarget = true;
    await conn.query(
      "UPDATE bookings SET status = 'cancelled', reconfirm_deadline = NULL, cancellation_fee_lei = ? WHERE id = ?",
      [cancellationFeeLei, bookingId],
    );

    let infractionRecorded = false;
    if (isLateConfirmedCancel) {
      await conn.query(
        `INSERT INTO user_infractions (user_id, ride_id, infraction_type, penalty_percentage_points, occurred_at)
         VALUES (?, ?, 'passenger_late_cancel', ?, ?)`,
        [user.id, ride.id, PASSENGER_LATE_CANCEL_PENALTY, now],
      );
      infractionRecorded = true;
    }

    const feeSuffix = cancellationFeeLei != null
      ? ` Taxă anulare târzie datorată: ${cancellationFeeLei} lei.`
      : '';
    await conn.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES (?, 'booking_cancelled_by_passenger', 'Rezervare anulată de pasager', ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [
        ride.driver_id,
        `${user.full_name} și-a anulat rezervarea pentru cursa ${ride.origin_name} → ${ride.destination_name}.${feeSuffix}`,
        `booking_cancelled_by_passenger:${bookingId}`,
      ],
    );

    await conn.commit();
    return {
      booking: await getBookingById(pool, bookingId),
      infraction_recorded: infractionRecorded,
    };
  } catch (err) {
    await finishTx(conn, err, hasReconciledChanges, hasMutatedTarget);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * GET /api/bookings/me (authenticated passenger):
 * Reconciles lazy expirations/lapses on the caller's rides first, then returns all bookings.
 */
export async function listMyBookings(pool, user, now) {
  const [rideRows] = await pool.query(
    'SELECT DISTINCT ride_id FROM bookings WHERE passenger_id = ?',
    [user.id],
  );
  await reconcileRidesLazily(
    pool,
    rideRows.map((r) => r.ride_id),
    now,
  );

  const [rows] = await pool.query(
    `${BOOKING_SELECT_SQL} WHERE b.passenger_id = ? ORDER BY b.id DESC`,
    [user.id],
  );
  return rows.map(formatEnrichedBooking);
}

/**
 * GET /api/rides/:rideId/bookings (driver only):
 * Reconciles lazy expirations/lapses on the ride first, then returns all bookings on the ride.
 */
export async function listRideBookings(pool, user, rideId, now) {
  const [rideRows] = await pool.query('SELECT id, driver_id FROM rides WHERE id = ?', [rideId]);
  if (rideRows.length === 0) {
    throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
  }
  if (rideRows[0].driver_id !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the ride driver can view all bookings for this ride');
  }

  await reconcileRidesLazily(pool, [rideId], now);

  const [rows] = await pool.query(
    `${BOOKING_SELECT_SQL} WHERE b.ride_id = ? ORDER BY b.id ASC`,
    [rideId],
  );
  return rows.map(formatEnrichedBooking);
}
