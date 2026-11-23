// Pure D-016 helpers: seriousness score replayed from infraction events, the 7-day publishing
// ban, the 30-day "Anulare recentă" badge, and driver/passenger late-cancel windows & fee math.
// Nothing here is stored; everything is computed on read.
import { bucharestDateOf } from './recurrence.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const BADGE_WINDOW_MS = 30 * DAY_MS;
const PASSENGER_LATE_CANCEL_WINDOW_MS = 4 * HOUR_MS;
const MAX_PASSENGER_CANCELLATION_FEE_LEI = 20;

const clamp = (n) => Math.max(0, Math.min(100, n));
const time = (v) => new Date(v).getTime();

/**
 * Replay infractions chronologically from a start of 100: apply the penalty, clamp to 0..100,
 * then add +1 point per full 7 days without a new infraction (also up to `now`), clamp to 100.
 */
export function computeSeriousnessScore(infractions, now = new Date()) {
  const nowMs = time(now);
  const events = infractions
    .filter((i) => time(i.occurred_at) <= nowMs)
    .sort((a, b) => time(a.occurred_at) - time(b.occurred_at));

  let score = 100;
  let cursor = null;
  for (const e of events) {
    const t = time(e.occurred_at);
    if (cursor !== null) score = clamp(score + Math.floor((t - cursor) / WEEK_MS));
    score = clamp(score - e.penalty_percentage_points);
    cursor = t;
  }
  if (cursor !== null) score = clamp(score + Math.floor((nowMs - cursor) / WEEK_MS));
  return score;
}

/** A driver_late_cancel within the last 7 days blocks publishing new rides (D-016). */
export function isPublishingBanned(infractions, now = new Date()) {
  const nowMs = time(now);
  const since = nowMs - WEEK_MS;
  return infractions.some(
    (i) => i.infraction_type === 'driver_late_cancel' && time(i.occurred_at) > since && time(i.occurred_at) <= nowMs,
  );
}

/** A driver_late_cancel within the last 30 days activates the "Anulare recentă" badge (D-016). */
export function hasRecentCancellationBadge(infractions, now = new Date()) {
  const nowMs = time(now);
  const since = nowMs - BADGE_WINDOW_MS;
  return infractions.some(
    (i) => i.infraction_type === 'driver_late_cancel' && time(i.occurred_at) > since && time(i.occurred_at) <= nowMs,
  );
}

/**
 * D-016 late-cancel window for drivers: the cancellation happens on the departure day
 * (Europe/Bucharest calendar day, D-020) and before departure.
 */
export function isWithinLateCancelWindow({ departureTime, now }) {
  return time(departureTime) > time(now) && bucharestDateOf(departureTime) === bucharestDateOf(now);
}

/**
 * D-016 late-cancel window for passengers: < 4 hours before departure (and before departure).
 */
export function isWithinPassengerLateCancelWindow({ departureTime, now }) {
  const diff = time(departureTime) - time(now);
  return diff > 0 && diff < PASSENGER_LATE_CANCEL_WINDOW_MS;
}

/**
 * D-016 passenger late-cancellation fee: 50% of the booked segment price (round-half-up),
 * capped at 20 lei.
 */
export function calculatePassengerCancellationFee(priceLei) {
  if (!Number.isInteger(priceLei) || priceLei < 0) {
    throw new RangeError(`priceLei must be a non-negative integer (got ${priceLei})`);
  }
  const halfRoundedUp = Math.floor((priceLei + 1) / 2);
  return Math.min(MAX_PASSENGER_CANCELLATION_FEE_LEI, halfRoundedUp);
}
