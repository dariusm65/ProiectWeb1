// Pure segment availability & selective competing-booking rejection logic
// (D-003, D-005, D-019). Strictly 1 seat per booking; half-open stop_order intervals.

/** Booking statuses that consume segment capacity (D-005). */
export const CAPACITY_CONSUMING_STATUSES = Object.freeze(
  new Set(['confirmed', 'pending_reconfirmation']),
);

/**
 * Build a map from stop ID -> stop row (including soft-removed stops so
 * pending_reconfirmation bookings referencing a removed stop still resolve
 * their stop_order interval).
 */
function indexAllStops(stops) {
  const byId = new Map();
  for (const s of stops) {
    byId.set(s.id, s);
  }
  return byId;
}

/**
 * Return active stops (removed_at == null) ordered ascending by stop_order.
 */
function getActiveStops(stops) {
  return stops
    .filter((s) => s.removed_at == null)
    .slice()
    .sort((a, b) => a.stop_order - b.stop_order);
}

/**
 * Resolve a booking's half-open [pickupOrder, dropoffOrder) interval.
 * Returns null if either stop is missing or order is invalid.
 */
function bookingOrderInterval(booking, stopById) {
  const pickup = stopById.get(booking.pickup_stop_id);
  const dropoff = stopById.get(booking.dropoff_stop_id);
  if (!pickup || !dropoff) return null;
  if (pickup.stop_order >= dropoff.stop_order) return null;
  return [pickup.stop_order, dropoff.stop_order];
}

/** Half-open interval overlap check: [aStart, aEnd) intersects [bStart, bEnd). */
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Compute per-segment occupancy and free seats across all active elementary segments.
 *
 * @param {object} params
 * @param {Array<{id: number, stop_order: number, removed_at?: any}>} params.stops
 * @param {Array<{id?: number, pickup_stop_id: number, dropoff_stop_id: number, status: string}>} params.bookings
 * @param {number} params.availableSeats
 * @returns {Array<{fromStopId: number, toStopId: number, fromOrder: number, toOrder: number, occupiedSeats: number, freeSeats: number}>}
 */
export function computeSegmentAvailability({ stops, bookings, availableSeats }) {
  if (!Number.isInteger(availableSeats) || availableSeats < 1) {
    throw new RangeError('availableSeats must be a positive integer');
  }

  const stopById = indexAllStops(stops);
  const activeStops = getActiveStops(stops);

  const consumingIntervals = [];
  for (const b of bookings) {
    if (!CAPACITY_CONSUMING_STATUSES.has(b.status)) continue;
    const interval = bookingOrderInterval(b, stopById);
    if (interval) consumingIntervals.push(interval);
  }

  const segments = [];
  for (let i = 0; i < activeStops.length - 1; i++) {
    const fromStop = activeStops[i];
    const toStop = activeStops[i + 1];
    let occupiedSeats = 0;
    for (const [bStart, bEnd] of consumingIntervals) {
      if (intervalsOverlap(bStart, bEnd, fromStop.stop_order, toStop.stop_order)) {
        occupiedSeats += 1;
      }
    }
    segments.push({
      fromStopId: fromStop.id,
      toStopId: toStop.id,
      fromOrder: fromStop.stop_order,
      toOrder: toStop.stop_order,
      occupiedSeats,
      freeSeats: Math.max(0, availableSeats - occupiedSeats),
    });
  }

  return segments;
}

/**
 * Return the minimum free seats across all active elementary segments covered
 * by [pickupStopId, dropoffStopId).
 */
export function getAvailableSeatsForRange({ stops, bookings, availableSeats, pickupStopId, dropoffStopId }) {
  const stopById = indexAllStops(stops);
  const pickup = stopById.get(pickupStopId);
  const dropoff = stopById.get(dropoffStopId);
  if (!pickup || !dropoff) {
    throw new Error('Unknown pickup or dropoff stop');
  }
  if (pickup.stop_order >= dropoff.stop_order) {
    throw new Error('pickup stop_order must be strictly less than dropoff stop_order');
  }

  const segments = computeSegmentAvailability({ stops, bookings, availableSeats });
  const covered = segments.filter((seg) =>
    intervalsOverlap(pickup.stop_order, dropoff.stop_order, seg.fromOrder, seg.toOrder),
  );
  if (covered.length === 0) {
    throw new Error('Requested stop range covers no active segments');
  }

  return covered.reduce((min, seg) => Math.min(min, seg.freeSeats), availableSeats);
}

/**
 * After accepting `acceptedBookingId` (treating it as `confirmed`), partition all
 * other `pending` bookings on the ride into:
 * - `toReject`: traverses at least one elementary segment whose remaining freeSeats === 0
 * - `toKeepPending`: all traversed elementary segments still have freeSeats >= 1 (D-003, D-005)
 */
export function findCompetingPendingBookingsToReject({ stops, bookings, availableSeats, acceptedBookingId }) {
  const stopById = indexAllStops(stops);
  const postAcceptanceBookings = bookings.map((b) =>
    b.id === acceptedBookingId ? { ...b, status: 'confirmed' } : b,
  );
  const postSegments = computeSegmentAvailability({
    stops,
    bookings: postAcceptanceBookings,
    availableSeats,
  });

  const saturatedSegments = postSegments.filter((seg) => seg.freeSeats === 0);
  const toReject = [];
  const toKeepPending = [];

  for (const b of bookings) {
    if (b.id === acceptedBookingId || b.status !== 'pending') continue;
    const interval = bookingOrderInterval(b, stopById);
    if (!interval) continue;
    const [bStart, bEnd] = interval;
    const hitsSaturated = saturatedSegments.some((seg) =>
      intervalsOverlap(bStart, bEnd, seg.fromOrder, seg.toOrder),
    );
    if (hitsSaturated) {
      toReject.push(b);
    } else {
      toKeepPending.push(b);
    }
  }

  return { toReject, toKeepPending };
}
