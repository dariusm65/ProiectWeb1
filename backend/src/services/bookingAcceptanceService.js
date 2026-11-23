// Transactional booking acceptance, lazy expiry/lapse, and selective auto-rejection
// using raw SQL (mysql2/promise) and InnoDB SELECT ... FOR UPDATE (D-003, D-005, D-007, D-010, D-013, D-016, D-019).
import {
  CAPACITY_CONSUMING_STATUSES,
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

function parsePositiveInt(value, fieldName) {
  const num = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isInteger(num) || num <= 0) {
    throw new BookingDomainError('INVALID_INPUT', `${fieldName} must be a positive integer`);
  }
  return num;
}

/**
 * Lazily expire unanswered `pending` bookings at/after ride departure (D-003) and
 * lazily auto-lapse overdue `pending_reconfirmation` bookings to `expired` (D-007),
 * using batched SQL updates and idempotent multi-row notifications (`ON DUPLICATE KEY UPDATE`).
 *
 * Must be invoked inside an active transaction on `conn` where the ride & bookings
 * are locked with `FOR UPDATE` (if `ride` or `bookings` are omitted, locks them here).
 */
export async function reconcileRideBookings(conn, { rideId, ride = null, bookings = null, now = new Date() }) {
  const normalizedRideId = parsePositiveInt(rideId, 'rideId');
  const nowDate = new Date(now);
  let lockedRide = ride;
  let lockedBookings = bookings;

  if (!lockedRide) {
    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [normalizedRideId]);
    if (rideRows.length === 0) {
      throw new BookingDomainError('RIDE_NOT_FOUND', `Ride ${normalizedRideId} does not exist`);
    }
    lockedRide = rideRows[0];
  }
  if (!lockedBookings) {
    const [bookingRows] = await conn.query(
      'SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE',
      [normalizedRideId],
    );
    bookingRows.sort((a, b) => a.id - b.id);
    lockedBookings = bookingRows;
  }

  const departureDate = new Date(lockedRide.departure_time);
  const expiredBookings = [];
  const lapsedBookings = [];

  // 1. Collect unanswered pending bookings to expire if now >= departure_time (D-003)
  if (nowDate >= departureDate) {
    for (const b of lockedBookings) {
      if (b.status === 'pending') expiredBookings.push(b);
    }
  }

  // 2. Collect overdue pending_reconfirmation bookings to lapse to 'expired' (D-007)
  for (const b of lockedBookings) {
    if (b.status !== 'pending_reconfirmation' || b.reconfirm_deadline == null) continue;
    if (new Date(b.reconfirm_deadline) <= nowDate) {
      lapsedBookings.push(b);
    }
  }

  const allToExpire = [...expiredBookings, ...lapsedBookings];
  if (allToExpire.length > 0) {
    const allIds = allToExpire.map((b) => b.id);
    await conn.query("UPDATE bookings SET status = 'expired' WHERE id IN (?)", [allIds]);

    const notifRows = [
      ...expiredBookings.map((b) => [
        b.passenger_id,
        'booking_expired',
        'Cerere de rezervare expirată',
        `Cererea ta pentru cursa ${lockedRide.origin_name} → ${lockedRide.destination_name} a expirat la ora plecării.`,
        `booking_expired:${b.id}`,
      ]),
      ...lapsedBookings.map((b) => [
        lockedRide.driver_id,
        'reconfirm_lapsed',
        'Loc eliberat după expirarea termenului de reconfirmare',
        `Un pasager nu a reconfirmat modificarea opririlor la timp pentru cursa ${lockedRide.origin_name} → ${lockedRide.destination_name}. Locul a fost eliberat.`,
        `reconfirm_lapsed:${b.id}`,
      ]),
    ];

    await conn.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES ?
       ON DUPLICATE KEY UPDATE id = id`,
      [notifRows],
    );

    for (const b of allToExpire) {
      b.status = 'expired';
    }
  }

  return {
    ride: lockedRide,
    bookings: lockedBookings,
    expiredIds: expiredBookings.map((b) => b.id),
    lapsedIds: lapsedBookings.map((b) => b.id),
  };
}

/**
 * Transactionally accept a pending booking on a ride:
 * 1. Lock ride -> ride_stops -> bookings (canonical order prevents deadlocks).
 * 2. Guard ride exists, status === 'active', driver ownership.
 * 3. Reconcile lazy pending expirations and pending_reconfirmation lapses.
 *    If any subsequent BookingDomainError is thrown, commit reconciliation changes
 *    before rethrowing so expirations/lapses and notifications are persisted.
 * 4. Guard target exists & pending, non-suspended driver/passenger (D-013/D-016),
 *    no self-booking, no duplicate active booking by same passenger (D-019),
 *    non-removed pickup/dropoff stops, >= 1 free seat (D-005), and D-010 trip cost cap.
 * 5. Confirm target booking and batch-reject ONLY competing pending bookings on
 *    segments whose capacity just dropped to 0 (D-003).
 */
export async function acceptBooking(pool, { rideId, bookingId, driverId, now = new Date() }) {
  const normalizedRideId = parsePositiveInt(rideId, 'rideId');
  const normalizedBookingId = parsePositiveInt(bookingId, 'bookingId');
  const normalizedDriverId = parsePositiveInt(driverId, 'driverId');

  const conn = await pool.getConnection();
  let hasReconciledChanges = false;
  let hasMutatedTarget = false;

  try {
    await conn.beginTransaction();

    // Canonical lock order: rides -> ride_stops -> bookings
    const [rideRows] = await conn.query('SELECT * FROM rides WHERE id = ? FOR UPDATE', [normalizedRideId]);
    if (rideRows.length === 0) {
      throw new BookingDomainError('RIDE_NOT_FOUND', `Ride ${normalizedRideId} does not exist`);
    }
    const ride = rideRows[0];

    if (ride.driver_id !== normalizedDriverId) {
      throw new BookingDomainError('FORBIDDEN', 'Only the ride driver can accept bookings');
    }
    if (ride.status !== 'active') {
      throw new BookingDomainError('RIDE_NOT_ACTIVE', `Ride ${normalizedRideId} is not active (status: ${ride.status})`);
    }

    const [stops] = await conn.query(
      'SELECT * FROM ride_stops WHERE ride_id = ? ORDER BY stop_order ASC FOR UPDATE',
      [normalizedRideId],
    );
    const [bookings] = await conn.query(
      'SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE',
      [normalizedRideId],
    );
    bookings.sort((a, b) => a.id - b.id);

    const { expiredIds, lapsedIds } = await reconcileRideBookings(conn, {
      rideId: normalizedRideId,
      ride,
      bookings,
      now,
    });
    hasReconciledChanges = expiredIds.length > 0 || lapsedIds.length > 0;

    const target = bookings.find((b) => b.id === normalizedBookingId);
    if (!target) {
      throw new BookingDomainError('BOOKING_NOT_FOUND', `Booking ${normalizedBookingId} not found on ride ${normalizedRideId}`);
    }
    if (target.status !== 'pending') {
      throw new BookingDomainError(
        'BOOKING_NOT_PENDING',
        `Booking ${normalizedBookingId} cannot be accepted (current status: ${target.status})`,
      );
    }

    if (target.passenger_id === ride.driver_id) {
      throw new BookingDomainError('SELF_BOOKING_NOT_ALLOWED', 'Driver cannot accept a booking for themselves');
    }

    // Verify neither driver nor passenger is suspended (D-013, D-016)
    const [userRows] = await conn.query(
      'SELECT id, is_suspended FROM users WHERE id IN (?, ?)',
      [normalizedDriverId, target.passenger_id],
    );
    const userById = new Map(userRows.map((u) => [u.id, u]));
    if (!userById.get(normalizedDriverId) || userById.get(normalizedDriverId).is_suspended) {
      throw new BookingDomainError('USER_SUSPENDED', 'Driver account is suspended');
    }
    if (!userById.get(target.passenger_id) || userById.get(target.passenger_id).is_suspended) {
      throw new BookingDomainError('PASSENGER_SUSPENDED', 'Passenger account is suspended');
    }

    // Single-seat-per-account invariant on a ride (D-019)
    const hasActiveBookingForPassenger = bookings.some(
      (b) => b.id !== normalizedBookingId &&
        b.passenger_id === target.passenger_id &&
        CAPACITY_CONSUMING_STATUSES.has(b.status),
    );
    if (hasActiveBookingForPassenger) {
      throw new BookingDomainError(
        'DUPLICATE_ACTIVE_BOOKING',
        'Passenger already has an active booking on this ride (D-019)',
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

    hasMutatedTarget = true;
    await conn.query("UPDATE bookings SET status = 'confirmed' WHERE id = ?", [normalizedBookingId]);
    await conn.query(
      `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
       VALUES (?, 'booking_accepted', 'Rezervare confirmată de șofer', ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [
        target.passenger_id,
        `Rezervarea ta pentru cursa ${ride.origin_name} → ${ride.destination_name} a fost confirmată.`,
        `booking_accepted:${normalizedBookingId}`,
      ],
    );

    const { toReject, toKeepPending } = findCompetingPendingBookingsToReject({
      stops,
      bookings,
      availableSeats: ride.available_seats,
      acceptedBookingId: normalizedBookingId,
    });

    const autoRejectedIds = toReject.map((b) => b.id);
    if (autoRejectedIds.length > 0) {
      await conn.query("UPDATE bookings SET status = 'rejected' WHERE id IN (?)", [autoRejectedIds]);
      const rejectNotifRows = toReject.map((competing) => [
        competing.passenger_id,
        'booking_auto_rejected',
        'Cerere respinsă automat — segment ocupat',
        `Locurile de pe segmentul solicitat pentru cursa ${ride.origin_name} → ${ride.destination_name} s-au ocupat.`,
        `booking_auto_rejected:${competing.id}`,
      ]);
      await conn.query(
        `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
         VALUES ?
         ON DUPLICATE KEY UPDATE id = id`,
        [rejectNotifRows],
      );
    }

    await conn.commit();

    return {
      acceptedBookingId: normalizedBookingId,
      autoRejectedIds,
      keptPendingIds: toKeepPending.map((b) => b.id),
      expiredIds,
      lapsedIds,
    };
  } catch (err) {
    if (err instanceof BookingDomainError && hasReconciledChanges && !hasMutatedTarget) {
      await conn.commit();
    } else {
      try {
        await conn.rollback();
      } catch {
        // preserve original error
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}
