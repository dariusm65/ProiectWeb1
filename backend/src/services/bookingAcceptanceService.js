// Transactional booking acceptance, lazy expiry/lapse, and selective auto-rejection
// using raw SQL (mysql2/promise) and InnoDB SELECT ... FOR UPDATE (D-003, D-005, D-007, D-010, D-019).
import {
  getAvailableSeatsForRange,
  findCompetingPendingBookingsToReject,
} from '../domain/segmentAvailability.js';
import { validateTripCostCap } from '../domain/segmentPricing.js';

export class BookingDomainError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'BookingDomainError';
    this.code = code;
  }
}

/**
 * Lazily expire unanswered `pending` bookings at/after ride departure (D-003) and
 * lazily auto-lapse overdue `pending_reconfirmation` bookings to `expired` (D-007),
 * inserting idempotent in-app notifications (`notifications.idempotency_key`).
 *
 * Must be invoked inside an active transaction on `conn` where the ride & bookings
 * are locked with `FOR UPDATE` (if `ride` or `bookings` are omitted, locks them here).
 */
export async function reconcileRideBookings(conn, { rideId, ride = null, bookings = null, now = new Date() }) {
  const nowDate = new Date(now);
  let lockedRide = ride;
  let lockedBookings = bookings;

  if (!lockedRide) {
    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [rideId]);
    if (rideRows.length === 0) {
      throw new BookingDomainError('RIDE_NOT_FOUND', `Ride ${rideId} does not exist`);
    }
    lockedRide = rideRows[0];
  }
  if (!lockedBookings) {
    const [bookingRows] = await conn.query(
      'SELECT * FROM bookings WHERE ride_id = ? ORDER BY id ASC FOR UPDATE',
      [rideId],
    );
    lockedBookings = bookingRows;
  }

  const departureDate = new Date(lockedRide.departure_time);
  const expiredIds = [];
  const lapsedIds = [];

  // 1. Lazily expire unanswered pending bookings if now >= departure_time (D-003)
  if (nowDate >= departureDate) {
    for (const b of lockedBookings) {
      if (b.status !== 'pending') continue;
      await conn.query("UPDATE bookings SET status = 'expired' WHERE id = ?", [b.id]);
      await conn.query(
        `INSERT IGNORE INTO notifications (user_id, type, title, message, idempotency_key)
         VALUES (?, 'booking_expired', 'Cerere de rezervare expirată', ?, ?)`,
        [
          b.passenger_id,
          `Cererea ta pentru cursa ${lockedRide.origin_name} → ${lockedRide.destination_name} a expirat la ora plecării.`,
          `booking_expired:${b.id}`,
        ],
      );
      b.status = 'expired';
      expiredIds.push(b.id);
    }
  }

  // 2. Lazily auto-lapse overdue pending_reconfirmation bookings to 'expired' (D-007)
  for (const b of lockedBookings) {
    if (b.status !== 'pending_reconfirmation' || b.reconfirm_deadline == null) continue;
    const deadlineDate = new Date(b.reconfirm_deadline);
    if (deadlineDate > nowDate) continue;

    await conn.query("UPDATE bookings SET status = 'expired' WHERE id = ?", [b.id]);
    await conn.query(
      `INSERT IGNORE INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES (?, 'reconfirm_lapsed', 'Loc eliberat după expirarea termenului de reconfirmare', ?, ?)`,
      [
        lockedRide.driver_id,
        `Un pasager nu a reconfirmat modificarea opririlor la timp pentru cursa ${lockedRide.origin_name} → ${lockedRide.destination_name}. Locul a fost eliberat.`,
        `reconfirm_lapsed:${b.id}`,
      ],
    );
    b.status = 'expired';
    lapsedIds.push(b.id);
  }

  return { ride: lockedRide, bookings: lockedBookings, expiredIds, lapsedIds };
}

/**
 * Transactionally accept a pending booking on a ride:
 * 1. Lock ride -> ride_stops -> bookings (canonical order prevents deadlocks).
 * 2. Guard ride exists, status === 'active', driver ownership.
 * 3. Reconcile lazy pending expirations and pending_reconfirmation lapses.
 * 4. Verify target booking is still pending and pickup/dropoff stops are not soft-removed.
 * 5. Verify >= 1 free seat on every covered segment (D-005) and D-010 trip cost cap.
 * 6. Confirm target booking and auto-reject ONLY competing pending bookings on saturated segments (D-003).
 */
export async function acceptBooking(pool, { rideId, bookingId, driverId, now = new Date() }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Canonical lock order: rides -> ride_stops -> bookings
    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [rideId]);
    if (rideRows.length === 0) {
      throw new BookingDomainError('RIDE_NOT_FOUND', `Ride ${rideId} does not exist`);
    }
    const ride = rideRows[0];

    if (ride.driver_id !== driverId) {
      throw new BookingDomainError('FORBIDDEN', 'Only the ride driver can accept bookings');
    }
    if (ride.status !== 'active') {
      throw new BookingDomainError('RIDE_NOT_ACTIVE', `Ride ${rideId} is not active (status: ${ride.status})`);
    }

    const [stops] = await conn.query(
      'SELECT * FROM ride_stops WHERE ride_id = ? ORDER BY stop_order ASC FOR UPDATE',
      [rideId],
    );
    const [bookings] = await conn.query(
      'SELECT * FROM bookings WHERE ride_id = ? ORDER BY id ASC FOR UPDATE',
      [rideId],
    );

    const { expiredIds, lapsedIds } = await reconcileRideBookings(conn, {
      rideId,
      ride,
      bookings,
      now,
    });

    const target = bookings.find((b) => b.id === bookingId);
    if (!target) {
      throw new BookingDomainError('BOOKING_NOT_FOUND', `Booking ${bookingId} not found on ride ${rideId}`);
    }
    if (target.status !== 'pending') {
      throw new BookingDomainError(
        'BOOKING_NOT_PENDING',
        `Booking ${bookingId} cannot be accepted (current status: ${target.status})`,
      );
    }

    const stopById = new Map(stops.map((s) => [s.id, s]));
    const pickupStop = stopById.get(target.pickup_stop_id);
    const dropoffStop = stopById.get(target.dropoff_stop_id);
    if (!pickupStop || !dropoffStop || pickupStop.removed_at != null || dropoffStop.removed_at != null) {
      throw new BookingDomainError('STOP_REMOVED', 'Pickup or dropoff stop has been removed');
    }

    const freeSeats = getAvailableSeatsForRange({
      stops,
      bookings,
      availableSeats: ride.available_seats,
      pickupStopId: target.pickup_stop_id,
      dropoffStopId: target.dropoff_stop_id,
    });
    if (freeSeats < 1) {
      throw new BookingDomainError('NO_SEATS_AVAILABLE', 'No free seats remaining on the requested segment');
    }

    const capCheck = validateTripCostCap({
      declaredTripCost: ride.declared_trip_cost,
      existingBookings: bookings,
      additionalPriceLei: target.price_lei,
    });
    if (!capCheck.withinCap) {
      throw new BookingDomainError(
        'TRIP_COST_CAP_EXCEEDED',
        `Accepting booking would exceed declared trip cost cap (${capCheck.projectedTotalLei} > ${capCheck.declaredTripCost})`,
      );
    }

    await conn.query("UPDATE bookings SET status = 'confirmed' WHERE id = ?", [bookingId]);

    const { toReject, toKeepPending } = findCompetingPendingBookingsToReject({
      stops,
      bookings,
      availableSeats: ride.available_seats,
      acceptedBookingId: bookingId,
    });

    const autoRejectedIds = [];
    for (const competing of toReject) {
      await conn.query("UPDATE bookings SET status = 'rejected' WHERE id = ?", [competing.id]);
      await conn.query(
        `INSERT IGNORE INTO notifications (user_id, type, title, message, idempotency_key)
         VALUES (?, 'booking_auto_rejected', 'Cerere respinsă automat — segment ocupat', ?, ?)`,
        [
          competing.passenger_id,
          `Locurile de pe segmentul solicitat pentru cursa ${ride.origin_name} → ${ride.destination_name} s-au ocupat.`,
          `booking_auto_rejected:${competing.id}`,
        ],
      );
      autoRejectedIds.push(competing.id);
    }

    await conn.commit();

    return {
      acceptedBookingId: bookingId,
      autoRejectedIds,
      keptPendingIds: toKeepPending.map((b) => b.id),
      expiredIds,
      lapsedIds,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
