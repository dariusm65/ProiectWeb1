// Pure recurring-rule date matching (D-006) and Europe/Bucharest wall-clock conversion (D-020).
// Timezone maths uses the native Intl API only (DST-aware, no extra dependency).

const TIME_ZONE = 'Europe/Bucharest';
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** Parse a strict 'YYYY-MM-DD' calendar date; throws RangeError for malformed/impossible dates. */
function parseDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!m) throw new RangeError(`Invalid date: ${dateStr}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new RangeError(`Invalid date: ${dateStr}`);
  }
  return { y, mo, d };
}

/** Normalise a DATE column value (Date at UTC midnight from mysql2, or string) to 'YYYY-MM-DD'. */
export function toDateString(value) {
  const str = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  parseDate(str);
  return str;
}

/** Lowercase weekday name of a calendar date, e.g. '2026-12-04' -> 'friday'. */
export function dayOfWeekName(dateStr) {
  const { y, mo, d } = parseDate(dateStr);
  return DAY_NAMES[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
}

/**
 * Does a recurring rule produce a ride on `date`? start_date/end_date are inclusive,
 * a null end_date is open-ended, and exception dates are skipped (D-006).
 */
export function ruleAppliesOn(rule, date, exceptionDates = []) {
  const day = toDateString(date);
  if (day < toDateString(rule.start_date)) return false;
  if (rule.end_date != null && day > toDateString(rule.end_date)) return false;
  if (!rule.days_of_week.includes(dayOfWeekName(day))) return false;
  return !exceptionDates.some((e) => toDateString(e) === day);
}

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function localParts(instantMs) {
  const out = {};
  for (const p of partsFormat.formatToParts(new Date(instantMs))) out[p.type] = p.value;
  return out;
}

/** Offset (ms) of Europe/Bucharest from UTC at the given instant. */
function offsetMs(instantMs) {
  const p = localParts(instantMs);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Convert a Europe/Bucharest wall-clock date + 'HH:MM[:SS]' to the UTC instant. */
export function bucharestLocalToUtc(dateStr, timeStr) {
  const { y, mo, d } = parseDate(dateStr);
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeStr));
  if (!t) throw new RangeError(`Invalid time: ${timeStr}`);
  const localMs = Date.UTC(y, mo - 1, d, Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
  // Anchor before the requested time (localMs - 3h) so the first pass uses the pre-transition offset
  const preOff = offsetMs(localMs - 3 * 60 * MS_PER_MINUTE);
  const first = localMs - preOff;
  const postOff = offsetMs(first);
  if (postOff === preOff) return new Date(first);
  const second = localMs - postOff;
  // If `second + offsetMs(second)` does not round-trip to `localMs`, `timeStr` fell inside a
  // spring-forward DST gap (e.g. 03:30 when clocks jump 03:00 -> 04:00): return `first` (04:30 EEST).
  return new Date(second + offsetMs(second) === localMs ? second : first);
}

/** Europe/Bucharest calendar date ('YYYY-MM-DD') of a UTC instant. */
export function bucharestDateOf(instant) {
  const p = localParts(new Date(instant).getTime());
  return `${p.year}-${p.month}-${p.day}`;
}

/** UTC instants [start, end) bounding a Europe/Bucharest calendar day (23/25 h on DST days). */
export function bucharestDayBounds(dateStr) {
  const { y, mo, d } = parseDate(dateStr);
  const next = new Date(Date.UTC(y, mo - 1, d) + MS_PER_DAY).toISOString().slice(0, 10);
  return {
    start: bucharestLocalToUtc(dateStr, '00:00:00'),
    end: bucharestLocalToUtc(next, '00:00:00'),
  };
}

/**
 * Compute concrete UTC times for a ride instance of a rule on `dateStr`: departure from the
 * rule's local departure_time, each stop's arrival = departure + estimated_offset_minutes.
 */
export function buildInstanceTimes(rule, stops, dateStr) {
  const departure = bucharestLocalToUtc(dateStr, rule.departure_time);
  const withTimes = stops.map((s) => ({
    ...s,
    arrival: new Date(departure.getTime() + s.estimated_offset_minutes * MS_PER_MINUTE),
  }));
  return { departure, stops: withTimes, arrival: withTimes[withTimes.length - 1].arrival };
}
