// Ride publishing, ride details and spatial segment search (D-003, D-005, D-010, D-016, D-017, D-018, D-020).
// Raw parameterised SQL via mysql2; seat maths and pricing come from the pure domain modules.
import { ApiError } from '../errors.js';
import { UNIVERSITY_BADGE_NOTE } from '../domain/universityDomains.js';
import { haversineKm, boundingBox } from '../domain/geo.js';
import { bucharestDayBounds } from '../domain/recurrence.js';
import { computeSeriousnessScore, isPublishingBanned } from '../domain/seriousnessScore.js';
import { computeSegmentAvailability, getAvailableSeatsForRange } from '../domain/segmentAvailability.js';
import { calculateSegmentPrice } from '../domain/segmentPricing.js';
import { reconcileRideBookings } from './bookingAcceptanceService.js';

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
async function reconcileRidesLazily(pool, rideIds, now) {
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

/** Best (pickup, dropoff) stop pair for a ride: pickup before dropoff, least total walking distance. */
function bestStopPair(stops, origin, dest, radiusKm) {
  const pickups = [];
  const dropoffs = [];
  for (const s of stops) {
    const point = { lat: Number(s.latitude), lng: Number(s.longitude) };
    const toOrigin = haversineKm(origin, point);
    const toDest = haversineKm(dest, point);
    if (toOrigin <= radiusKm) pickups.push({ stop: s, walkKm: toOrigin });
    if (toDest <= radiusKm) dropoffs.push({ stop: s, walkKm: toDest });
  }
  let best = null;
  for (const p of pickups) {
    for (const d of dropoffs) {
      if (p.stop.stop_order >= d.stop.stop_order) continue;
      const total = p.walkKm + d.walkKm;
      if (best === null || total < best.total) best = { pickup: p, dropoff: d, total };
    }
  }
  return best;
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
  const { start, end } = bucharestDayBounds(date);

  const conditions = ["r.status = 'active'", 'r.departure_time >= ?', 'r.departure_time < ?', 'r.departure_time > ?'];
  const args = [start, end, now];
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
    const pair = bestStopPair(stopsByRide.get(ride.id) ?? [], origin, dest, radiusKm);
    if (pair) matches.push({ ride, pair });
  }
  if (matches.length === 0) return [];

  await reconcileRidesLazily(pool, matches.map((m) => m.ride.id).sort((a, b) => a - b), now);

  const matchedIds = matches.map((m) => m.ride.id);
  const [allStops] = await pool.query('SELECT * FROM ride_stops WHERE ride_id IN (?) ORDER BY ride_id, stop_order', [matchedIds]);
  const [allBookings] = await pool.query(
    'SELECT ride_id, id, pickup_stop_id, dropoff_stop_id, status FROM bookings WHERE ride_id IN (?)',
    [matchedIds],
  );

  const results = [];
  for (const { ride, pair } of matches) {
    const stops = allStops.filter((s) => s.ride_id === ride.id);
    const bookings = allBookings.filter((b) => b.ride_id === ride.id);
    const pickup = pair.pickup.stop;
    const dropoff = pair.dropoff.stop;
    const freeSeats = getAvailableSeatsForRange({
      stops,
      bookings,
      availableSeats: ride.available_seats,
      pickupStopId: pickup.id,
      dropoffStopId: dropoff.id,
    });
    if (freeSeats < 1) continue;

    const active = activeStops(stops);
    results.push({
      ride_id: ride.id,
      recurring_rule_id: ride.recurring_rule_id,
      origin_name: ride.origin_name,
      destination_name: ride.destination_name,
      departure_time: ride.departure_time,
      estimated_arrival_time: ride.estimated_arrival_time,
      available_seats: ride.available_seats,
      luggage_allowed: Boolean(ride.luggage_allowed),
      pets_allowed: Boolean(ride.pets_allowed),
      smoking_allowed: Boolean(ride.smoking_allowed),
      women_only: Boolean(ride.women_only),
      driver: {
        id: ride.driver_id,
        full_name: ride.driver_name,
        ...badge(ride.driver_domain),
      },
      pickup_stop: formatStop(pickup),
      dropoff_stop: formatStop(dropoff),
      pickup_distance_km: Math.round(pair.pickup.walkKm * 1000) / 1000,
      dropoff_distance_km: Math.round(pair.dropoff.walkKm * 1000) / 1000,
      free_seats: freeSeats,
      segment_price_lei: calculateSegmentPrice({
        declaredTripCost: ride.declared_trip_cost,
        availableSeats: ride.available_seats,
        pickupDistKm: pickup.distance_from_origin_km,
        dropoffDistKm: dropoff.distance_from_origin_km,
        totalDistKm: active[active.length - 1].distance_from_origin_km,
      }),
    });
  }
  return results;
}
