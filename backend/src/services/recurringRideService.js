// Recurring rides: rule + exceptions, materialised on demand (D-006, D-016, D-018, D-020).
// A rule row (days of week, optional end date) plus an exceptions table; concrete `rides` instances
// are created lazily when a date is searched. Bookings attach to the instance, never the rule.
import { ApiError } from '../errors.js';
import { assertCanPublish } from './rideService.js';
import {
  ruleAppliesOn,
  toDateString,
  buildInstanceTimes,
  bucharestLocalToUtc,
} from '../domain/recurrence.js';
import { isPublishingBanned, isWithinLateCancelWindow } from '../domain/seriousnessScore.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DRIVER_LATE_CANCEL_PENALTY = 5; // D-016

const formatRule = (r) => ({
  id: r.id,
  driver_id: r.driver_id,
  origin_name: r.origin_name,
  destination_name: r.destination_name,
  departure_time: r.departure_time,
  start_date: toDateString(r.start_date),
  end_date: r.end_date == null ? null : toDateString(r.end_date),
  days_of_week: r.days_of_week,
  available_seats: r.available_seats,
  declared_trip_cost: Number(r.declared_trip_cost),
  luggage_allowed: Boolean(r.luggage_allowed),
  pets_allowed: Boolean(r.pets_allowed),
  smoking_allowed: Boolean(r.smoking_allowed),
  women_only: Boolean(r.women_only),
});

const formatRuleStop = (s) => ({
  stop_order: s.stop_order,
  city_name: s.city_name,
  location_name: s.location_name,
  latitude: Number(s.latitude),
  longitude: Number(s.longitude),
  distance_from_origin_km: s.distance_from_origin_km,
  estimated_offset_minutes: s.estimated_offset_minutes,
});

async function rollbackQuietly(conn) {
  try {
    await conn.rollback();
  } catch {
    // keep the original error
  }
}

/** Create a recurring rule and its template stops (stop_order 10, 20, 30...). */
export async function createRule(pool, user, data, now) {
  await assertCanPublish(pool, user, data, now);
  const stops = data.stops;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query(
      `INSERT INTO recurring_ride_rules (driver_id, origin_name, destination_name, departure_time, start_date,
         end_date, days_of_week, available_seats, declared_trip_cost, luggage_allowed, pets_allowed,
         smoking_allowed, women_only)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id, stops[0].city_name, stops[stops.length - 1].city_name, data.departure_time, data.start_date,
        data.end_date, JSON.stringify(data.days_of_week), data.available_seats, data.declared_trip_cost,
        data.luggage_allowed, data.pets_allowed, data.smoking_allowed, data.women_only,
      ],
    );
    await conn.query(
      `INSERT INTO recurring_rule_stops (rule_id, stop_order, city_name, location_name, latitude, longitude,
         distance_from_origin_km, estimated_offset_minutes) VALUES ?`,
      [stops.map((s, i) => [
        res.insertId, (i + 1) * 10, s.city_name, s.location_name, s.latitude, s.longitude,
        s.distance_from_origin_km, s.estimated_offset_minutes,
      ])],
    );
    await conn.commit();

    const [[rule]] = await pool.query('SELECT * FROM recurring_ride_rules WHERE id = ?', [res.insertId]);
    const [ruleStops] = await pool.query('SELECT * FROM recurring_rule_stops WHERE rule_id = ? ORDER BY stop_order', [res.insertId]);
    return { rule: formatRule(rule), stops: ruleStops.map(formatRuleStop) };
  } catch (err) {
    await rollbackQuietly(conn);
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Create the ride instance (and its stops) for one rule/date inside a transaction.
 * `INSERT IGNORE` on uq_rule_instance makes this idempotent; stops are inserted only for the
 * winner (affectedRows === 1). Returns the new ride id, or null if nothing was created.
 */
async function materialiseRule(pool, rule, dateStr) {
  for (let attempt = 1; ; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Locking read: waits for a concurrent exception insert and then sees it (no stale snapshot).
      const [blocked] = await conn.query(
        'SELECT 1 FROM recurring_ride_exceptions WHERE rule_id = ? AND exception_date = ? FOR SHARE',
        [rule.id, dateStr],
      );
      if (blocked.length > 0) {
        await conn.commit();
        return null;
      }

      const [ruleStops] = await conn.query(
        'SELECT * FROM recurring_rule_stops WHERE rule_id = ? ORDER BY stop_order',
        [rule.id],
      );
      if (ruleStops.length < 2) {
        await conn.commit();
        return null;
      }
      const times = buildInstanceTimes(rule, ruleStops, dateStr);

      const [result] = await conn.query(
        `INSERT IGNORE INTO rides (driver_id, recurring_rule_id, instance_date, origin_name, destination_name,
           departure_time, estimated_arrival_time, available_seats, declared_trip_cost, luggage_allowed,
           pets_allowed, smoking_allowed, women_only)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rule.driver_id, rule.id, dateStr, rule.origin_name, rule.destination_name, times.departure,
          times.arrival, rule.available_seats, rule.declared_trip_cost, rule.luggage_allowed,
          rule.pets_allowed, rule.smoking_allowed, rule.women_only,
        ],
      );
      if (result.affectedRows === 1) {
        await conn.query(
          `INSERT INTO ride_stops (ride_id, stop_order, city_name, location_name, latitude, longitude,
             distance_from_origin_km, estimated_arrival_time) VALUES ?`,
          [times.stops.map((s) => [
            result.insertId, s.stop_order, s.city_name, s.location_name, s.latitude, s.longitude,
            s.distance_from_origin_km, s.arrival,
          ])],
        );
      }
      await conn.commit();
      return result.affectedRows === 1 ? result.insertId : null;
    } catch (err) {
      await rollbackQuietly(conn);
      if (err && err.code === 'ER_LOCK_DEADLOCK' && attempt < 3) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}

/**
 * Materialise ride instances for every active rule matching `dateStr` (Europe/Bucharest calendar
 * date). Skips exception dates, past departures, suspended drivers and drivers inside their 7-day
 * publishing ban (D-016). Returns the ids of newly created rides.
 */
export async function materialiseForDate(pool, dateStr, now) {
  const [rules] = await pool.query(
    `SELECT r.* FROM recurring_ride_rules r JOIN users u ON u.id = r.driver_id
     WHERE r.start_date <= ? AND (r.end_date IS NULL OR r.end_date >= ?) AND u.is_suspended = FALSE
     ORDER BY r.id`,
    [dateStr, dateStr],
  );
  const matching = rules.filter((r) => ruleAppliesOn(r, dateStr));
  if (matching.length === 0) return [];

  const driverIds = [...new Set(matching.map((r) => r.driver_id))];
  const [infractions] = await pool.query(
    `SELECT user_id, infraction_type, penalty_percentage_points, occurred_at FROM user_infractions
     WHERE infraction_type = 'driver_late_cancel' AND user_id IN (?) AND occurred_at > ?`,
    [driverIds, new Date(now.getTime() - WEEK_MS)],
  );
  const bannedDrivers = new Set(
    driverIds.filter((id) => isPublishingBanned(infractions.filter((i) => i.user_id === id), now)),
  );

  const created = [];
  for (const rule of matching) {
    if (bannedDrivers.has(rule.driver_id)) continue;
    if (bucharestLocalToUtc(dateStr, rule.departure_time).getTime() <= now.getTime()) continue;
    const rideId = await materialiseRule(pool, rule, dateStr);
    if (rideId !== null) created.push(rideId);
  }
  return created;
}

/**
 * Record an exception date for a rule (driver only). If the concrete instance already exists it is
 * cancelled together with ALL non-terminal bookings (pending, confirmed, pending_reconfirmation),
 * passengers are notified idempotently, and a D-016 driver_late_cancel infraction is written when
 * seat-holding passengers exist and the cancellation falls in the late-cancel window.
 */
export async function addException(pool, user, ruleId, { exception_date: dateStr, reason = null }, now) {
  const [rules] = await pool.query('SELECT * FROM recurring_ride_rules WHERE id = ?', [ruleId]);
  if (rules.length === 0) throw new ApiError(404, 'RULE_NOT_FOUND', 'Recurring ride rule not found');
  const rule = rules[0];
  if (rule.driver_id !== user.id) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the driver who owns this rule can add exceptions');
  }
  if (!ruleAppliesOn(rule, dateStr)) {
    throw new ApiError(400, 'DATE_NOT_IN_RULE', 'Date is not an occurrence of this rule');
  }
  if (bucharestLocalToUtc(dateStr, rule.departure_time).getTime() <= now.getTime()) {
    throw new ApiError(400, 'DEPARTURE_IN_PAST', 'This occurrence has already departed');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'INSERT INTO recurring_ride_exceptions (rule_id, exception_date, reason) VALUES (?, ?, ?)',
      [ruleId, dateStr, reason],
    );

    let cancelledRideId = null;
    let cancelledBookings = 0;
    let infractionRecorded = false;

    const [rides] = await conn.query(
      'SELECT * FROM rides WHERE recurring_rule_id = ? AND instance_date = ? FOR UPDATE',
      [ruleId, dateStr],
    );
    const ride = rides[0];
    if (ride && ride.status === 'active') {
      const [bookings] = await conn.query(
        `SELECT id, passenger_id, status FROM bookings
         WHERE ride_id = ? AND status IN ('pending', 'confirmed', 'pending_reconfirmation') FOR UPDATE`,
        [ride.id],
      );
      await conn.query("UPDATE rides SET status = 'cancelled' WHERE id = ?", [ride.id]);
      cancelledRideId = ride.id;

      if (bookings.length > 0) {
        await conn.query(
          "UPDATE bookings SET status = 'cancelled' WHERE ride_id = ? AND status IN ('pending', 'confirmed', 'pending_reconfirmation')",
          [ride.id],
        );
        cancelledBookings = bookings.length;
        await conn.query(
          `INSERT INTO notifications (user_id, type, title, message, idempotency_key) VALUES ?
           ON DUPLICATE KEY UPDATE id = id`,
          [bookings.map((b) => [
            b.passenger_id,
            'ride_cancelled',
            'Cursă anulată de șofer',
            `Cursa ${ride.origin_name} → ${ride.destination_name} din ${dateStr} a fost anulată de șofer. Rezervarea ta a fost anulată.`,
            `recurring_exception:${ruleId}:${dateStr}:${b.id}`,
          ])],
        );
      }

      const holdsSeats = bookings.some((b) => b.status === 'confirmed' || b.status === 'pending_reconfirmation');
      if (holdsSeats && isWithinLateCancelWindow({ departureTime: ride.departure_time, now })) {
        await conn.query(
          `INSERT INTO user_infractions (user_id, ride_id, infraction_type, penalty_percentage_points, occurred_at)
           VALUES (?, ?, 'driver_late_cancel', ?, ?)`,
          [user.id, ride.id, DRIVER_LATE_CANCEL_PENALTY, now],
        );
        infractionRecorded = true;
      }
    }

    await conn.commit();
    return {
      exception: { rule_id: ruleId, exception_date: dateStr, reason },
      cancelled_ride_id: cancelledRideId,
      cancelled_bookings: cancelledBookings,
      infraction_recorded: infractionRecorded,
    };
  } catch (err) {
    await rollbackQuietly(conn);
    throw err;
  } finally {
    conn.release();
  }
}
