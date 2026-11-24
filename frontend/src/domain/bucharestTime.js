// Europe/Bucharest wall-clock formatting and DST-aware ISO-8601 offset helpers (D-020).
// Mirrors backend/src/domain/recurrence.js (bucharestLocalToUtc) using native Intl.DateTimeFormat.

const BUCHAREST_TZ = 'Europe/Bucharest';
const MS_PER_MINUTE = 60 * 1000;

const timeFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateFormatter = new Intl.DateTimeFormat('ro-RO', {
  timeZone: BUCHAREST_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: BUCHAREST_TZ,
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
  for (const p of partsFormat.formatToParts(new Date(instantMs))) {
    out[p.type] = p.value;
  }
  return out;
}

function offsetMs(instantMs) {
  const p = localParts(instantMs);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

function parseDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) throw new RangeError(`Data calendaristică invalidă: ${dateStr}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new RangeError(`Data calendaristică invalidă: ${dateStr}`);
  }
  return { y, mo, d };
}

/**
 * Convert a Europe/Bucharest wall-clock date ('YYYY-MM-DD') + 'HH:MM[:SS]' to the UTC Date instant (D-020).
 * Handles both EET (UTC+2 in winter) and EEST (UTC+3 in summer) plus spring-forward DST gaps.
 */
export function bucharestLocalToUtc(dateStr, timeStr) {
  const { y, mo, d } = parseDate(dateStr);
  const t = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(String(timeStr || '').trim());
  if (!t) throw new RangeError(`Ora plecării este invalidă: ${timeStr}`);
  const localMs = Date.UTC(y, mo - 1, d, Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
  const preOff = offsetMs(localMs - 3 * 60 * MS_PER_MINUTE);
  const first = localMs - preOff;
  const postOff = offsetMs(first);
  if (postOff === preOff) return new Date(first);
  const second = localMs - postOff;
  return new Date(second + offsetMs(second) === localMs ? second : first);
}

export function formatBucharestTime(isoString) {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '--:--';
  return timeFormatter.format(d);
}

export function formatBucharestDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return String(isoString);
  return dateFormatter.format(d);
}

/**
 * Format an ISO timestamp as a 'YYYY-MM-DD' calendar date in Europe/Bucharest wall-clock time (D-020).
 */
export function formatBucharestIsoDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const p = localParts(d.getTime());
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Convert a Europe/Bucharest date string ('YYYY-MM-DD') and time string ('HH:MM')
 * plus optional minute offset into an ISO-8601 UTC timestamp string ('...Z') for POST /api/rides.
 * Throws RangeError if dateStr or timeStr is invalid (never fabricates Date.now() + 1h).
 */
export function buildIsoTimestampFromDateAndTime(dateStr, timeStr, addMinutes = 0) {
  const utcStart = bucharestLocalToUtc(dateStr, timeStr);
  const offsetMin = Number(addMinutes) || 0;
  return new Date(utcStart.getTime() + offsetMin * MS_PER_MINUTE).toISOString();
}

/** Seeded real survey localities for instant quick-pick and fallback coordinates. */
export const KNOWN_SURVEY_PLACES = Object.freeze([
  { city_name: 'Cluj-Napoca', location_name: 'Campus Hașdeu', latitude: 46.7646, longitude: 23.5801 },
  { city_name: 'Turda', location_name: 'Centru Turda', latitude: 46.5667, longitude: 23.7833 },
  { city_name: 'Alba Iulia', location_name: 'Gara Alba Iulia', latitude: 46.0667, longitude: 23.5833 },
  { city_name: 'Sebeș', location_name: 'Centru Sebeș', latitude: 45.9597, longitude: 23.5681 },
  { city_name: 'Sibiu', location_name: 'Gara Mare Sibiu', latitude: 45.7983, longitude: 24.1256 },
  { city_name: 'Brașov', location_name: 'Gara Brașov', latitude: 45.6604, longitude: 25.6137 },
  { city_name: 'Timișoara', location_name: 'Complexul Studențesc', latitude: 45.7489, longitude: 21.2417 },
  { city_name: 'Deva', location_name: 'Gara Deva', latitude: 45.8833, longitude: 22.9 },
  { city_name: 'Bacău', location_name: 'Stadionul Municipal', latitude: 46.567, longitude: 26.9146 },
  { city_name: 'Focșani', location_name: 'Centru Focșani', latitude: 45.6964, longitude: 27.1833 },
  { city_name: 'Buzău', location_name: 'Rond Spătaru', latitude: 45.15, longitude: 26.8167 },
  { city_name: 'Ploiești', location_name: 'Ploiești Nord', latitude: 44.95, longitude: 26.0167 },
  { city_name: 'București', location_name: 'Piața Romană / UPB', latitude: 44.445, longitude: 26.097 },
]);

export function normalizePlaceSearchText(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Resolve typed place text against KNOWN_SURVEY_PLACES (case- and diacritics-insensitive)
 * so typing a locality without clicking the dropdown resolves its real coordinates.
 */
export function resolveKnownSurveyPlace(text) {
  const norm = normalizePlaceSearchText(text);
  if (!norm) return null;
  for (const place of KNOWN_SURVEY_PLACES) {
    const cityNorm = normalizePlaceSearchText(place.city_name);
    const locNorm = normalizePlaceSearchText(place.location_name);
    if (norm === cityNorm || norm.startsWith(`${cityNorm} `) || norm.startsWith(`${cityNorm}(`) || norm.includes(cityNorm) || norm === locNorm) {
      return place;
    }
  }
  return null;
}
