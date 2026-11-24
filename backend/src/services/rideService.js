// Ride publishing, ride details, spatial segment search, driver stop editing (D-007),
// and driver ride cancellation (D-003, D-005, D-007, D-010, D-011, D-016, D-017, D-018, D-020).
// Raw parameterised SQL via mysql2; seat maths and pricing come from the pure domain modules.
import { ApiError } from '../errors.js';
import { UNIVERSITY_BADGE_NOTE } from '../domain/universityDomains.js';
import { haversineKm, boundingBox } from '../domain/geo.js';
import { bucharestDayBounds } from '../domain/recurrence.js';
import {
  computeSeriousnessScore,
  isPublishingBanned,
  isWithinLateCancelWindow,
  hasRecentCancellationBadge,
} from '../domain/seriousnessScore.js';
import { computeSegmentAvailability, getAvailableSeatsForRange } from '../domain/segmentAvailability.js';
import { calculateSegmentPrice, computeReconfirmDeadline } from '../domain/segmentPricing.js';
import { reconcileRideBookings } from './bookingAcceptanceService.js';
import { BOOKING_SELECT_SQL, formatEnrichedBooking } from './bookingService.js';

const DRIVER_LATE_CANCEL_PENALTY = 5; // D-016

const badge = (domain) => ({
  has_university_badge: Boolean(domain),
  university_badge_note: domain ? UNIVERSITY_BADGE_NOTE : null,
});

const formatStop = (s) => ({
  id: s.id,
  stop_order: s.stop_order,
  city_name: s.city_name,
  location_name: s.location_name,
  latitude: Number(s.latitude),
  longitude: Number(s.longitude),
  distance_from_origin_km: s.distance_from_origin_km,
  estimated_arrival_time: s.estimated_arrival_time,
});

const formatRide = (r) => ({
  id: r.id,
  driver_id: r.driver_id,
  recurring_rule_id: r.recurring_rule_id,
  origin_name: r.origin_name,
  destination_name: r.destination_name,
  departure_time: r.departure_time,
  estimated_arrival_time: r.estimated_arrival_time,
  available_seats: r.available_seats,
  declared_trip_cost: Number(r.declared_trip_cost),
  luggage_allowed: Boolean(r.luggage_allowed),
  pets_allowed: Boolean(r.pets_allowed),
  smoking_allowed: Boolean(r.smoking_allowed),
  women_only: Boolean(r.women_only),
  status: r.status,
});

const activeStops = (stops) => stops.filter((s) => s.removed_at == null);

/**
 * Publishing guards shared by single rides and recurring rules:
 * D-018 (women_only needs gender = female) and D-016 (7-day ban after a driver_late_cancel).
 */
export async function assertCanPublish(pool, user, { women_only: womenOnly }, now) {
  if (womenOnly && user.gender !== 'female') {
    throw new ApiError(403, 'WOMEN_ONLY_NOT_ALLOWED', 'Only accounts with gender "female" may publish women-only rides');
  }
  const [infractions] = await pool.query(
    `SELECT infraction_type, penalty_percentage_points, occurred_at
     FROM user_infractions WHERE user_id = ? AND infraction_type = 'driver_late_cancel' AND occurred_at > ?`,
    [user.id, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)],
  );
  if (isPublishingBanned(infractions, now)) {
    throw new ApiError(403, 'PUBLISHING_BANNED', 'Publishing is blocked for 7 days after a late cancellation');
  }
}

/**
 * Lazily expire/lapse bookings (D-003, D-007) for the given rides. Each ride is reconciled in its
 * own short transaction, in ascending ride_id order, and the connection is always released.
 * Rides without pending / pending_reconfirmation bookings have nothing to reconcile and are skipped.
 */
export async function reconcileRidesLazily(pool, rideIds, now) {
  if (rideIds.length === 0) return;
  const [rows] = await pool.query(
    `SELECT DISTINCT ride_id FROM bookings
     WHERE ride_id IN (?) AND status IN ('pending', 'pending_reconfirmation')`,
    [rideIds],
  );
  const due = rows.map((r) => r.ride_id).sort((a, b) => a - b);
  for (const rideId of due) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await reconcileRideBookings(conn, { rideId, now });
      await conn.commit();
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // keep the original error
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}

/** Publish a single ride. stop_order is server-assigned as 10, 20, 30... (A1). Returns the new ride id. */
export async function publishRide(pool, user, data, now) {
  const stops = data.stops;
  const departure = stops[0].estimated_arrival_time;
  if (departure.getTime() <= now.getTime()) {
    throw new ApiError(400, 'DEPARTURE_IN_PAST', 'Departure time must be in the future');
  }
  await assertCanPublish(pool, user, data, now);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query(
      `INSERT INTO rides (driver_id, origin_name, destination_name, departure_time, estimated_arrival_time,
         available_seats, declared_trip_cost, luggage_allowed, pets_allowed, smoking_allowed, women_only)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id, stops[0].city_name, stops[stops.length - 1].city_name, departure,
        stops[stops.length - 1].estimated_arrival_time, data.available_seats, data.declared_trip_cost,
        data.luggage_allowed, data.pets_allowed, data.smoking_allowed, data.women_only,
      ],
    );
    await conn.query(
      `INSERT INTO ride_stops (ride_id, stop_order, city_name, location_name, latitude, longitude,
         distance_from_origin_km, estimated_arrival_time) VALUES ?`,
      [stops.map((s, i) => [
        res.insertId, (i + 1) * 10, s.city_name, s.location_name, s.latitude, s.longitude,
        s.distance_from_origin_km, s.estimated_arrival_time,
      ])],
    );
    await conn.commit();
    return res.insertId;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // keep the original error
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** Segment list with availability (D-005) and transparent prices (D-010) for a ride. */
function buildSegments({ ride, stops, bookings }) {
  const active = activeStops(stops).sort((a, b) => a.stop_order - b.stop_order);
  const byId = new Map(active.map((s) => [s.id, s]));
  const totalDistKm = active[active.length - 1].distance_from_origin_km;
  return computeSegmentAvailability({ stops, bookings, availableSeats: ride.available_seats }).map((seg) => {
    const from = byId.get(seg.fromStopId);
    const to = byId.get(seg.toStopId);
    return {
      from_stop_id: seg.fromStopId,
      to_stop_id: seg.toStopId,
      distance_km: to.distance_from_origin_km - from.distance_from_origin_km,
      occupied_seats: seg.occupiedSeats,
      free_seats: seg.freeSeats,
      price_lei: calculateSegmentPrice({
        declaredTripCost: ride.declared_trip_cost,
        availableSeats: ride.available_seats,
        pickupDistKm: from.distance_from_origin_km,
        dropoffDistKm: to.distance_from_origin_km,
        totalDistKm,
      }),
    };
  });
}

async function driverSummary(pool, driverId, now) {
  const [[driver]] = await pool.query('SELECT id, full_name, university_domain FROM users WHERE id = ?', [driverId]);
  const [[rating]] = await pool.query(
    'SELECT AVG(rating_stars) AS avg_stars, COUNT(*) AS n FROM reviews WHERE reviewed_user_id = ?',
    [driverId],
  );
  const [infractions] = await pool.query(
    'SELECT infraction_type, penalty_percentage_points, occurred_at FROM user_infractions WHERE user_id = ?',
    [driverId],
  );
  return {
    id: driver.id,
    full_name: driver.full_name,
    ...badge(driver.university_domain),
    rating_average: rating.n > 0 ? Math.round(Number(rating.avg_stars) * 10) / 10 : null,
    rating_count: rating.n,
    seriousness_score: computeSeriousnessScore(infractions, now),
    has_recent_cancellation_badge: hasRecentCancellationBadge(infractions, now),
  };
}

/** Ride details (public): active stops, segments, driver summary, confirmed passengers (SURVEY §4). */
export async function getRideDetails(pool, rideId, now) {
  const [rideRows] = await pool.query('SELECT * FROM rides WHERE id = ?', [rideId]);
  if (rideRows.length === 0) throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');

  await reconcileRidesLazily(pool, [rideId], now);

  const [[ride]] = await pool.query('SELECT * FROM rides WHERE id = ?', [rideId]);
  const [stops] = await pool.query('SELECT * FROM ride_stops WHERE ride_id = ? ORDER BY stop_order', [rideId]);
  const [bookings] = await pool.query(
    'SELECT id, pickup_stop_id, dropoff_stop_id, status FROM bookings WHERE ride_id = ?',
    [rideId],
  );
  const [passengers] = await pool.query(
    `SELECT u.full_name, u.university_domain, ps.location_name AS pickup_stop_name, ds.location_name AS dropoff_stop_name
     FROM bookings b
     JOIN users u ON u.id = b.passenger_id
     JOIN ride_stops ps ON ps.id = b.pickup_stop_id
     JOIN ride_stops ds ON ds.id = b.dropoff_stop_id
     WHERE b.ride_id = ? AND b.status = 'confirmed' ORDER BY b.id`,
    [rideId],
  );

  return {
    ride: formatRide(ride),
    stops: activeStops(stops).map(formatStop),
    segments: buildSegments({ ride, stops, bookings }),
    driver: await driverSummary(pool, ride.driver_id, now),
    passengers: passengers.map((p) => ({
      full_name: p.full_name,
      ...badge(p.university_domain),
      pickup_stop_name: p.pickup_stop_name,
      dropoff_stop_name: p.dropoff_stop_name,
    })),
  };
}

/**
 * All (pickup, dropoff) stop pairs within radiusKm where pickup.stop_order < dropoff.stop_order,
 * ordered ascending by summed walking distance so the first pair with >= 1 free seat wins.
 */
function candidateStopPairs(stops, origin, dest, radiusKm) {
  const pickups = [];
  const dropoffs = [];
  for (const s of stops) {
    const point = { lat: Number(s.latitude), lng: Number(s.longitude) };
    const toOrigin = haversineKm(origin, point);
    const toDest = haversineKm(dest, point);
    if (toOrigin <= radiusKm) pickups.push({ stop: s, walkKm: toOrigin });
    if (toDest <= radiusKm) dropoffs.push({ stop: s, walkKm: toDest });
  }
  const pairs = [];
  for (const p of pickups) {
    for (const d of dropoffs) {
      if (p.stop.stop_order >= d.stop.stop_order) continue;
      pairs.push({ pickup: p, dropoff: d, total: p.walkKm + d.walkKm });
    }
  }
  return pairs.sort((a, b) => a.total - b.total || a.pickup.stop.stop_order - b.pickup.stop.stop_order);
}

/**
 * Spatial segment search (D-017): active rides on `date` (Europe/Bucharest) that have a pickup stop
 * within radiusKm of the origin and a later drop-off stop within radiusKm of the destination, with
 * at least one free seat on every segment between them.
 * Recurring instances must already be materialised for `date` (see recurringRideService).
 */
export async function searchRides(pool, params, now) {
  const { originLat, originLng, destLat, destLng, date, radiusKm } = params;
  const origin = { lat: originLat, lng: originLng };
  const dest = { lat: destLat, lng: destLng };

  const conditions = ["r.status = 'active'", 'r.departure_time > ?'];
  const args = [now];
  if (date) {
    const { start, end } = bucharestDayBounds(date);
    conditions.push('r.departure_time >= ?', 'r.departure_time < ?');
    args.push(start, end);
  }
  if (params.universityOnly) conditions.push('u.university_domain IS NOT NULL');
  for (const [param, column] of [
    ['womenOnly', 'women_only'],
    ['luggageAllowed', 'luggage_allowed'],
    ['petsAllowed', 'pets_allowed'],
    ['smokingAllowed', 'smoking_allowed'],
  ]) {
    if (params[param] !== undefined) {
      conditions.push(`r.${column} = ?`);
      args.push(params[param]);
    }
  }

  const [candidates] = await pool.query(
    `SELECT r.*, u.full_name AS driver_name, u.university_domain AS driver_domain
     FROM rides r JOIN users u ON u.id = r.driver_id
     WHERE ${conditions.join(' AND ')} ORDER BY r.departure_time, r.id`,
    args,
  );
  if (candidates.length === 0) return [];

  // SQL prefilter on idx_stops_coords, then the exact Haversine check in JS.
  const o = boundingBox(origin, radiusKm);
  const d = boundingBox(dest, radiusKm);
  const [nearbyStops] = await pool.query(
    `SELECT * FROM ride_stops
     WHERE ride_id IN (?) AND removed_at IS NULL
       AND ((latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?)
         OR (latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?))
     ORDER BY ride_id, stop_order`,
    [candidates.map((r) => r.id), o.minLat, o.maxLat, o.minLng, o.maxLng, d.minLat, d.maxLat, d.minLng, d.maxLng],
  );
  const stopsByRide = new Map();
  for (const s of nearbyStops) {
    if (!stopsByRide.has(s.ride_id)) stopsByRide.set(s.ride_id, []);
    stopsByRide.get(s.ride_id).push(s);
  }

  const matches = [];
  for (const ride of candidates) {
    const pairs = candidateStopPairs(stopsByRide.get(ride.id) ?? [], origin, dest, radiusKm);
    if (pairs.length > 0) matches.push({ ride, pairs });
  }
  if (matches.length === 0) return [];

  await reconcileRidesLazily(pool, matches.map((m) => m.ride.id).sort((a, b) => a - b), now);

  const matchedIds = matches.map((m) => m.ride.id);
  const driverIds = [...new Set(matches.map((m) => m.ride.driver_id))];
  const [allStops] = await pool.query('SELECT * FROM ride_stops WHERE ride_id IN (?) ORDER BY ride_id, stop_order', [matchedIds]);
  const [allBookings] = await pool.query(
    'SELECT ride_id, id, pickup_stop_id, dropoff_stop_id, status FROM bookings WHERE ride_id IN (?)',
    [matchedIds],
  );
  const [driverInfractions] = await pool.query(
    `SELECT user_id, infraction_type, penalty_percentage_points, occurred_at
     FROM user_infractions WHERE user_id IN (?) ORDER BY occurred_at ASC, id ASC`,
    [driverIds],
  );
  const [driverRatings] = await pool.query(
    `SELECT reviewed_user_id, AVG(rating_stars) AS avg_stars, COUNT(*) AS n
     FROM reviews WHERE reviewed_user_id IN (?) GROUP BY reviewed_user_id`,
    [driverIds],
  );
  const ratingByDriver = new Map(
    driverRatings.map((r) => [
      r.reviewed_user_id,
      {
        rating_average: Number(r.n) > 0 ? Math.round(Number(r.avg_stars) * 10) / 10 : null,
        rating_count: Number(r.n),
      },
    ]),
  );
  const infractionsByDriver = new Map(driverIds.map((id) => [id, []]));
  for (const inf of driverInfractions) {
    if (infractionsByDriver.has(inf.user_id)) {
      infractionsByDriver.get(inf.user_id).push(inf);
    }
  }

  const allStopsByRide = new Map(matchedIds.map((id) => [id, []]));
  for (const s of allStops) {
    if (allStopsByRide.has(s.ride_id)) {
      allStopsByRide.get(s.ride_id).push(s);
    }
  }
  const allBookingsByRide = new Map(matchedIds.map((id) => [id, []]));
  for (const b of allBookings) {
    if (allBookingsByRide.has(b.ride_id)) {
      allBookingsByRide.get(b.ride_id).push(b);
    }
  }

  const results = [];
  for (const { ride, pairs } of matches) {
    const stops = allStopsByRide.get(ride.id) || [];
    const bookings = allBookingsByRide.get(ride.id) || [];
    let chosen = null;
    for (const candidate of pairs) {
      const freeSeats = getAvailableSeatsForRange({
        stops,
        bookings,
        availableSeats: ride.available_seats,
        pickupStopId: candidate.pickup.stop.id,
        dropoffStopId: candidate.dropoff.stop.id,
      });
      if (freeSeats >= 1) {
        chosen = { pair: candidate, freeSeats };
        break;
      }
    }
    if (!chosen) continue;

    const { pair, freeSeats } = chosen;
    const pickup = pair.pickup.stop;
    const dropoff = pair.dropoff.stop;

    const active = activeStops(stops);
    const priceLei = calculateSegmentPrice({
      declaredTripCost: ride.declared_trip_cost,
      availableSeats: ride.available_seats,
      pickupDistKm: pickup.distance_from_origin_km,
      dropoffDistKm: dropoff.distance_from_origin_km,
      totalDistKm: active[active.length - 1].distance_from_origin_km,
    });
    const dInfs = infractionsByDriver.get(ride.driver_id) || [];
    const dRating = ratingByDriver.get(ride.driver_id) || { rating_average: null, rating_count: 0 };

    results.push({
      ride_id: ride.id,
      recurring_rule_id: ride.recurring_rule_id,
      origin_name: ride.origin_name,
      destination_name: ride.destination_name,
      departure_time: ride.departure_time,
      estimated_arrival_time: ride.estimated_arrival_time,
      available_seats: ride.available_seats,
      declared_trip_cost: Number(ride.declared_trip_cost),
      luggage_allowed: Boolean(ride.luggage_allowed),
      pets_allowed: Boolean(ride.pets_allowed),
      smoking_allowed: Boolean(ride.smoking_allowed),
      women_only: Boolean(ride.women_only),
      driver: {
        id: ride.driver_id,
        full_name: ride.driver_name,
        ...badge(ride.driver_domain),
        rating_average: dRating.rating_average,
        rating_count: dRating.rating_count,
        seriousness_score: computeSeriousnessScore(dInfs, now),
        has_recent_cancellation_badge: hasRecentCancellationBadge(dInfs, now),
      },
      pickup_stop: formatStop(pickup),
      dropoff_stop: formatStop(dropoff),
      stops: active.map(formatStop),
      pickup_distance_km: Math.round(pair.pickup.walkKm * 1000) / 1000,
      dropoff_distance_km: Math.round(pair.dropoff.walkKm * 1000) / 1000,
      free_seats: freeSeats,
      price_lei: priceLei,
      segment_price_lei: priceLei,
    });
  }
  return results;
}

function stopChanged(oldStop, inputStop) {
  return (
    oldStop.city_name !== inputStop.city_name ||
    oldStop.location_name !== inputStop.location_name ||
    Math.abs(Number(oldStop.latitude) - Number(inputStop.latitude)) > 1e-6 ||
    Math.abs(Number(oldStop.longitude) - Number(inputStop.longitude)) > 1e-6 ||
    Number(oldStop.distance_from_origin_km) !== Number(inputStop.distance_from_origin_km) ||
    new Date(oldStop.estimated_arrival_time).getTime() !== new Date(inputStop.estimated_arrival_time).getTime()
  );
}

/**
 * PATCH / PUT /api/rides/:rideId/stops (driver only, D-007, D-010, D-011):
 * Transactionally edits stops on an active future ride, preserving positive monotonic stop_order
 * on soft-removed stops so pending_reconfirmation bookings continue to hold capacity, keeping
 * existing bookings' price_lei immutable, transitioning affected confirmed bookings to
 * pending_reconfirmation with computeReconfirmDeadline, and auto-rejecting pending bookings whose
 * pickup or dropoff stop was removed.
 */
export async function editRideStops(pool, user, rideId, { stops: inputStops }, now) {
  const newDeparture = inputStops[0].estimated_arrival_time;
  const newArrival = inputStops[inputStops.length - 1].estimated_arrival_time;
  if (newDeparture.getTime() <= now.getTime()) {
    throw new ApiError(400, 'DEPARTURE_IN_PAST', 'Departure time must be in the future');
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

    if (ride.driver_id !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the ride driver can edit stops');
    }

    const [allStops] = await conn.query(
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
      throw new ApiError(400, 'DEPARTURE_IN_PAST', 'Cannot edit stops on a ride that has already departed');
    }

    const activeOldStops = allStops.filter((s) => s.removed_at == null).sort((a, b) => a.stop_order - b.stop_order);
    const activeOldById = new Map(activeOldStops.map((s) => [s.id, s]));

    // Validate submitted stop IDs belong to active stops on this ride, have no duplicates, and maintain relative order
    const seenIds = new Set();
    let lastOldOrder = -Infinity;
    for (const s of inputStops) {
      if (s.id !== undefined && s.id !== null) {
        if (seenIds.has(s.id)) {
          throw new ApiError(400, 'DUPLICATE_STOP_ID', `Duplicate stop id ${s.id}`);
        }
        const existing = activeOldById.get(s.id);
        if (!existing) {
          throw new ApiError(400, 'INVALID_STOP_ID', `Stop ${s.id} is not an active stop on this ride`);
        }
        if (existing.stop_order <= lastOldOrder) {
          throw new ApiError(400, 'INVALID_STOP_ORDER', 'Existing stops cannot be reordered out of sequence');
        }
        lastOldOrder = existing.stop_order;
        seenIds.add(s.id);
      }
    }

    // Identify removed stops, edited stops, and newly added stops
    const newlyRemovedStops = activeOldStops.filter((s) => !seenIds.has(s.id));
    const newlyRemovedIds = new Set(newlyRemovedStops.map((s) => s.id));
    const editedOldStops = [];
    const addedPositions = []; // new active stop_order (10, 20, ...) for each newly added stop

    inputStops.forEach((s, idx) => {
      const assignedActiveOrder = (idx + 1) * 10;
      if (s.id != null) {
        const old = activeOldById.get(s.id);
        if (stopChanged(old, s)) {
          editedOldStops.push(old);
        }
      } else {
        addedPositions.push(assignedActiveOrder);
      }
    });

    // Build a merged monotonic timeline of ALL stops (new active stops + previously soft-removed + newly soft-removed)
    // so every stop in ride_stops receives a strictly increasing positive stop_order, with active stops on multiples of 10.
    // Specifically, we anchor each existing stop to its old stop_order and interleave new stops by their position in inputStops.
    const referencedStopIds = new Set();
    for (const b of bookings) {
      referencedStopIds.add(b.pickup_stop_id);
      referencedStopIds.add(b.dropoff_stop_id);
    }

    // Map each surviving active stop id -> its new index in inputStops (0..N-1)
    const survivingIndexById = new Map();
    inputStops.forEach((s, idx) => {
      if (s.id != null) survivingIndexById.set(s.id, idx);
    });

    // Any existing stop (previously removed or newly removed) that is NOT in survivingIndexById and is referenced by a booking
    // is anchored into the active stop intervals using its route position (surviving old stop order AND distance_from_origin_km),
    // ensuring that [pickup.stop_order, dropoff.stop_order) continues to overlap active segments [10, 20), [20, 30)...
    // even when leading stops (or all original stops) are soft-removed.
    const keptRemovedStops = allStops
      .filter((s) => !survivingIndexById.has(s.id) && referencedStopIds.has(s.id))
      .sort((a, b) => a.stop_order - b.stop_order || a.id - b.id);
    const unreferencedRemovedStops = allStops.filter(
      (s) => !survivingIndexById.has(s.id) && !referencedStopIds.has(s.id),
    );

    const survivingOldOrdered = activeOldStops.filter((s) => survivingIndexById.has(s.id));
    const removedAfterSurvivingIdx = new Map(); // inputStops index (0..N-1) -> array of stop rows
    let lastRemovedAnchorIdx = 0;
    for (const rem of keptRemovedStops) {
      let survFloorIdx = -1;
      let survCeilIdx = inputStops.length;
      for (const surv of survivingOldOrdered) {
        const idx = survivingIndexById.get(surv.id);
        if (surv.stop_order < rem.stop_order) {
          survFloorIdx = idx;
        } else if (surv.stop_order > rem.stop_order && survCeilIdx === inputStops.length) {
          survCeilIdx = idx;
        }
      }

      // Within [max(0, survFloorIdx, lastRemovedAnchorIdx), survCeilIdx - 1], find the nearest active stop
      // in inputStops by distance_from_origin_km (clamped so a removed origin at 0 km anchors at index 0 inside [10, 20),
      // while a removed stop replaced by a nearby new active stop at index 1 anchors at index 1 inside [20, 30)
      // rather than colliding with index 0 and causing adjacent non-overlapping bookings to overlap).
      const minIdx = Math.max(0, survFloorIdx, lastRemovedAnchorIdx);
      const maxIdx = Math.min(inputStops.length - 1, Math.max(minIdx, survCeilIdx - 1));
      let anchorInputIdx = minIdx;
      const remKm = Number(rem.distance_from_origin_km);
      let bestDistDiff = Infinity;
      for (let i = minIdx; i <= maxIdx; i += 1) {
        const diff = Math.abs(Number(inputStops[i].distance_from_origin_km) - remKm);
        if (diff <= bestDistDiff) {
          bestDistDiff = diff;
          anchorInputIdx = i;
        }
      }
      lastRemovedAnchorIdx = anchorInputIdx;

      if (!removedAfterSurvivingIdx.has(anchorInputIdx)) {
        removedAfterSurvivingIdx.set(anchorInputIdx, []);
      }
      removedAfterSurvivingIdx.get(anchorInputIdx).push(rem);
    }

    // Compute final positive stop_order for every active stop (multiples of 10, widened if >9 removed stops sit in one gap)
    // so active stops are always multiples of 10 and every soft-removed stop has a unique positive integer strictly between its neighbors.
    const finalActiveOrders = [];
    const finalRemovedOrders = new Map(); // stop.id -> positive integer stop_order
    let cursorOrder = 0;

    for (let i = 0; i < inputStops.length; i += 1) {
      const nextMultipleOf10 = (Math.floor(cursorOrder / 10) + 1) * 10;
      cursorOrder = nextMultipleOf10;
      finalActiveOrders.push(cursorOrder);

      const trailingRemoved = removedAfterSurvivingIdx.get(i) || [];
      for (const rem of trailingRemoved) {
        cursorOrder += 1;
        finalRemovedOrders.set(rem.id, cursorOrder);
      }
    }

    hasMutatedTarget = true;

    // 1. Delete unreferenced removed stops and temporarily move all remaining existing stops to negative stop_order (-id)
    //    to avoid uq_ride_stops_order collisions during re-numbering.
    if (unreferencedRemovedStops.length > 0) {
      await conn.query(
        'DELETE FROM ride_stops WHERE id IN (?)',
        [unreferencedRemovedStops.map((s) => s.id)],
      );
    }
    await conn.query('UPDATE ride_stops SET stop_order = -id WHERE ride_id = ?', [rideId]);

    // 2. Soft-remove newly removed stops that are referenced by bookings and assign their final positive monotonic stop_order
    for (const rem of keptRemovedStops) {
      const removedAtVal = rem.removed_at ?? now;
      await conn.query(
        'UPDATE ride_stops SET stop_order = ?, removed_at = ? WHERE id = ?',
        [finalRemovedOrders.get(rem.id), removedAtVal, rem.id],
      );
    }

    // 3. Update existing surviving active stops or insert newly added stops at their final positive multiple-of-10 stop_order
    const newStopOrderByOldId = new Map();
    for (const rem of keptRemovedStops) {
      newStopOrderByOldId.set(rem.id, finalRemovedOrders.get(rem.id));
    }
    const newlyAddedFinalOrders = [];

    for (let i = 0; i < inputStops.length; i += 1) {
      const s = inputStops[i];
      const finalOrder = finalActiveOrders[i];
      if (s.id != null) {
        await conn.query(
          `UPDATE ride_stops
           SET stop_order = ?, city_name = ?, location_name = ?, latitude = ?, longitude = ?,
               distance_from_origin_km = ?, estimated_arrival_time = ?, removed_at = NULL
           WHERE id = ?`,
          [
            finalOrder, s.city_name, s.location_name, s.latitude, s.longitude,
            s.distance_from_origin_km, s.estimated_arrival_time, s.id,
          ],
        );
        newStopOrderByOldId.set(s.id, finalOrder);
      } else {
        await conn.query(
          `INSERT INTO ride_stops (ride_id, stop_order, city_name, location_name, latitude, longitude,
             distance_from_origin_km, estimated_arrival_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rideId, finalOrder, s.city_name, s.location_name, s.latitude, s.longitude,
            s.distance_from_origin_km, s.estimated_arrival_time,
          ],
        );
        newlyAddedFinalOrders.push(finalOrder);
      }
    }

    // 4. Update ride header (origin, destination, departure_time, estimated_arrival_time)
    const originName = inputStops[0].city_name;
    const destinationName = inputStops[inputStops.length - 1].city_name;
    await conn.query(
      `UPDATE rides
       SET origin_name = ?, destination_name = ?, departure_time = ?, estimated_arrival_time = ?
       WHERE id = ?`,
      [originName, destinationName, newDeparture, newArrival, rideId],
    );

    // 5. Evaluate D-007 impact on existing seat-holding bookings (confirmed + pending_reconfirmation):
    //    - Rule (1): For edited or deleted stops, all bookings whose pickup, drop-off, or
    //      traversed segment includes that stop (pickup.old_order <= stop.old_order <= dropoff.old_order)
    //      transition to (or update) pending_reconfirmation.
    //    - Rule (2): For a newly added stop, only bookings whose drop-off stop is ordered
    //      AFTER the new stop (dropoff.new_order > new_stop.new_order) transition to (or update) pending_reconfirmation.
    //    - Consecutive edit rule: If a booking is already in pending_reconfirmation and departure_time changed,
    //      also re-evaluate its reconfirm_deadline so it is always clamped to the new schedule.
    //    - Rule (3): Locked price_lei on existing bookings never changes.
    const oldOrderById = new Map(allStops.map((s) => [s.id, s.stop_order]));
    const modifiedOrRemovedOldOrders = [
      ...newlyRemovedStops.map((s) => s.stop_order),
      ...editedOldStops.map((s) => s.stop_order),
    ];
    const departureTimeChanged =
      new Date(ride.departure_time).getTime() !== newDeparture.getTime();

    const affectedConfirmed = [];
    for (const b of bookings) {
      if (b.status !== 'confirmed' && b.status !== 'pending_reconfirmation') continue;
      const pOldOrder = oldOrderById.get(b.pickup_stop_id);
      const dOldOrder = oldOrderById.get(b.dropoff_stop_id);
      const dNewOrder = newStopOrderByOldId.get(b.dropoff_stop_id);

      const hitEditedOrRemoved = modifiedOrRemovedOldOrders.some(
        (ord) => pOldOrder <= ord && ord <= dOldOrder,
      );
      const hitAddedBeforeDropoff = newlyAddedFinalOrders.some(
        (addedOrd) => dNewOrder > addedOrd,
      );
      const hitScheduleChangeWhilePendingReconfirm =
        b.status === 'pending_reconfirmation' && departureTimeChanged;

      if (hitEditedOrRemoved || hitAddedBeforeDropoff || hitScheduleChangeWhilePendingReconfirm) {
        affectedConfirmed.push(b);
      }
    }

    if (affectedConfirmed.length > 0) {
      const deadline = computeReconfirmDeadline({ modifiedAt: now, departureTime: newDeparture });
      const deadlineIso = deadline.toISOString();
      const nowIso = now.toISOString();
      const affectedIds = affectedConfirmed.map((b) => b.id);
      await conn.query(
        "UPDATE bookings SET status = 'pending_reconfirmation', reconfirm_deadline = ? WHERE id IN (?)",
        [deadline, affectedIds],
      );
      const notifRows = affectedConfirmed.map((b) => [
        b.passenger_id,
        'stop_edit_reconfirm_required',
        'Modificare traseu/orar — reconfirmare necesară',
        `Șoferul a modificat opririle cursei ${originName} → ${destinationName}. Te rugăm să reconfirmi rezervarea până la ${deadlineIso}.`,
        `stop_edit_reconfirm:${b.id}:${nowIso}:${deadlineIso}`,
      ]);
      await conn.query(
        `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
         VALUES ?
         ON DUPLICATE KEY UPDATE id = id`,
        [notifRows],
      );
    }

    // 6. Guardrail 2: Auto-reject any pending bookings whose pickup or dropoff stop was removed,
    //    notifying those passengers idempotently (acceptBooking also blocks STOP_REMOVED).
    const pendingWithRemovedStop = bookings.filter(
      (b) =>
        b.status === 'pending' &&
        (newlyRemovedIds.has(b.pickup_stop_id) || newlyRemovedIds.has(b.dropoff_stop_id)),
    );
    if (pendingWithRemovedStop.length > 0) {
      await conn.query(
        "UPDATE bookings SET status = 'rejected' WHERE id IN (?)",
        [pendingWithRemovedStop.map((b) => b.id)],
      );
      await conn.query(
        `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
         VALUES ?
         ON DUPLICATE KEY UPDATE id = id`,
        [
          pendingWithRemovedStop.map((b) => [
            b.passenger_id,
            'booking_rejected_stop_removed',
            'Cerere respinsă — oprire eliminată',
            `Oprirea selectată pentru cursa ${originName} → ${destinationName} a fost eliminată de șofer.`,
            `booking_rejected_stop_removed:${b.id}`,
          ]),
        ],
      );
    }

    await conn.commit();
    return await getRideDetails(pool, rideId, now);
  } catch (err) {
    if (err instanceof ApiError && hasReconciledChanges && !hasMutatedTarget) {
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

/**
 * POST /api/rides/:rideId/cancel (driver only, D-016, D-011, D-020):
 * Cancels an active future ride inside a FOR UPDATE transaction (after reconcileRideBookings),
 * cancels all non-terminal bookings (pending, confirmed, pending_reconfirmation), notifies all
 * affected passengers idempotently, and records a driver_late_cancel (-5 pp) infraction when
 * seat-holding passengers exist on the Europe/Bucharest departure day.
 */
export async function cancelRide(pool, user, rideId, now) {
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
      throw new ApiError(403, 'FORBIDDEN', 'Only the ride driver can cancel this ride');
    }

    const [allBookings] = await conn.query(
      'SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE',
      [rideId],
    );
    allBookings.sort((a, b) => a.id - b.id);

    const { expiredIds, lapsedIds } = await reconcileRideBookings(conn, {
      rideId,
      ride,
      bookings: allBookings,
      now,
    });
    hasReconciledChanges = expiredIds.length > 0 || lapsedIds.length > 0;

    if (ride.status !== 'active') {
      throw new ApiError(409, 'RIDE_NOT_ACTIVE', `Ride is not active (status: ${ride.status})`);
    }
    if (new Date(ride.departure_time).getTime() <= now.getTime()) {
      throw new ApiError(400, 'DEPARTURE_IN_PAST', 'Cannot cancel a ride that has already departed');
    }

    const activeBookings = allBookings.filter((b) =>
      ['pending', 'confirmed', 'pending_reconfirmation'].includes(b.status),
    );

    hasMutatedTarget = true;
    await conn.query("UPDATE rides SET status = 'cancelled' WHERE id = ?", [rideId]);

    if (activeBookings.length > 0) {
      await conn.query(
        `UPDATE bookings
         SET status = 'cancelled', reconfirm_deadline = NULL
         WHERE ride_id = ? AND status IN ('pending', 'confirmed', 'pending_reconfirmation')`,
        [rideId],
      );
      await conn.query(
        `INSERT INTO notifications (user_id, type, title, message, idempotency_key)
         VALUES ?
         ON DUPLICATE KEY UPDATE id = id`,
        [
          activeBookings.map((b) => [
            b.passenger_id,
            'ride_cancelled',
            'Cursă anulată de șofer',
            `Cursa ${ride.origin_name} → ${ride.destination_name} a fost anulată de șofer. Rezervarea ta a fost anulată.`,
            `ride_cancelled:${rideId}:${b.id}`,
          ]),
        ],
      );
    }

    const holdsSeats = activeBookings.some(
      (b) => b.status === 'confirmed' || b.status === 'pending_reconfirmation',
    );
    let infractionRecorded = false;
    if (holdsSeats && isWithinLateCancelWindow({ departureTime: ride.departure_time, now })) {
      await conn.query(
        `INSERT INTO user_infractions (user_id, ride_id, infraction_type, penalty_percentage_points, occurred_at)
         VALUES (?, ?, 'driver_late_cancel', ?, ?)`,
        [user.id, ride.id, DRIVER_LATE_CANCEL_PENALTY, now],
      );
      infractionRecorded = true;
    }

    await conn.commit();
    return {
      cancelled_ride_id: ride.id,
      cancelled_bookings: activeBookings.length,
      infraction_recorded: infractionRecorded,
    };
  } catch (err) {
    if (err instanceof ApiError && hasReconciledChanges && !hasMutatedTarget) {
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

/**
 * GET /api/rides/me (authenticated driver):
 * Reconciles lazy expirations/lapses on all rides published by the caller first, then batches
 * stops and non-PII bookings with IN (?) + Map grouping (zero N+1 SQL queries).
 */
export async function listMyDrivenRides(pool, user, now) {
  const [initialRides] = await pool.query(
    'SELECT id FROM rides WHERE driver_id = ? ORDER BY departure_time DESC, id DESC',
    [user.id],
  );
  if (initialRides.length === 0) return [];

  const rideIds = initialRides.map((r) => r.id);
  await reconcileRidesLazily(pool, rideIds, now);

  const [rides] = await pool.query(
    'SELECT * FROM rides WHERE driver_id = ? ORDER BY departure_time DESC, id DESC',
    [user.id],
  );
  const [allStops] = await pool.query(
    'SELECT * FROM ride_stops WHERE ride_id IN (?) ORDER BY ride_id ASC, stop_order ASC',
    [rideIds],
  );
  const [allBookingRows] = await pool.query(
    `${BOOKING_SELECT_SQL} WHERE b.ride_id IN (?) ORDER BY b.ride_id ASC, b.id ASC`,
    [rideIds],
  );

  const stopsByRide = new Map(rideIds.map((id) => [id, []]));
  for (const s of allStops) {
    if (stopsByRide.has(s.ride_id)) {
      stopsByRide.get(s.ride_id).push(s);
    }
  }

  const bookingsByRide = new Map(rideIds.map((id) => [id, []]));
  for (const row of allBookingRows) {
    if (bookingsByRide.has(row.ride_id)) {
      bookingsByRide.get(row.ride_id).push(formatEnrichedBooking(row));
    }
  }

  return rides.map((ride) => {
    const stops = stopsByRide.get(ride.id) || [];
    const bookings = bookingsByRide.get(ride.id) || [];
    return {
      ride: formatRide(ride),
      stops: activeStops(stops).map(formatStop),
      segments: buildSegments({ ride, stops, bookings }),
      bookings,
    };
  });
}

/**
 * POST /api/rides/:rideId/complete (driver only, D-008):
 * Marks an active ride as completed inside a FOR UPDATE transaction (after reconcileRideBookings),
 * strictly requiring estimated_arrival_time <= now (consistent with D-008 review eligibility).
 */
export async function completeRide(pool, user, rideId, now) {
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
      throw new ApiError(403, 'FORBIDDEN', 'Only the ride driver can mark this ride completed');
    }

    const [allBookings] = await conn.query(
      'SELECT * FROM bookings WHERE ride_id = ? FOR UPDATE',
      [rideId],
    );
    allBookings.sort((a, b) => a.id - b.id);

    const { expiredIds, lapsedIds } = await reconcileRideBookings(conn, {
      rideId,
      ride,
      bookings: allBookings,
      now,
    });
    hasReconciledChanges = expiredIds.length > 0 || lapsedIds.length > 0;

    if (ride.status !== 'active') {
      throw new ApiError(409, 'RIDE_NOT_ACTIVE', `Ride is not active (status: ${ride.status})`);
    }
    if (new Date(ride.estimated_arrival_time).getTime() > now.getTime()) {
      throw new ApiError(
        409,
        'RIDE_BEFORE_ARRIVAL',
        'Ride can only be marked completed after its estimated arrival time has passed',
      );
    }

    hasMutatedTarget = true;
    await conn.query("UPDATE rides SET status = 'completed' WHERE id = ?", [rideId]);
    await conn.commit();

    return {
      ride: formatRide({ ...ride, status: 'completed' }),
    };
  } catch (err) {
    if (err instanceof ApiError && hasReconciledChanges && !hasMutatedTarget) {
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
