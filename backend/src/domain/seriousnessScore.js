// Pure D-016 helpers: seriousness score replayed from infraction events, the 7-day publishing
// ban, and the driver late-cancel window. Nothing here is stored; everything is computed on read.
import { bucharestDateOf } from './recurrence.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
  const since = time(now) - WEEK_MS;
  return infractions.some(
    (i) => i.infraction_type === 'driver_late_cancel' && time(i.occurred_at) > since,
  );
}

/**
 * D-016 late-cancel window for drivers: the cancellation happens on the departure day
 * (Europe/Bucharest calendar day, D-020) and before departure.
 */
export function isWithinLateCancelWindow({ departureTime, now }) {
  return time(departureTime) > time(now) && bucharestDateOf(departureTime) === bucharestDateOf(now);
}
