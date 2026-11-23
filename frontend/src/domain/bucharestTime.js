// Europe/Bucharest wall-clock formatting and ISO-8601 offset helpers (D-020).

const BUCHAREST_TZ = 'Europe/Bucharest';

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
 * Convert a date string ('YYYY-MM-DD') and time string ('HH:MM') plus optional minute offset
 * into an ISO-8601 string with explicit UTC ('Z') offset suitable for POST /api/rides.
 */
export function buildIsoTimestampFromDateAndTime(dateStr, timeStr, addMinutes = 0) {
  const baseIso = `${dateStr}T${timeStr.length === 5 ? `${timeStr}:00` : timeStr}+02:00`;
  const d = new Date(baseIso);
  if (Number.isNaN(d.getTime())) {
    return new Date(Date.now() + (addMinutes + 60) * 60 * 1000).toISOString();
  }
  return new Date(d.getTime() + addMinutes * 60 * 1000).toISOString();
}

/** Seeded real survey localities for instant quick-pick and fallback coordinates (SURVEY.md). */
export const KNOWN_SURVEY_PLACES = Object.freeze([
  { city_name: 'Cluj-Napoca', location_name: 'Campus Hașdeu', latitude: 46.7646, longitude: 23.5801 },
  { city_name: 'Turda', location_name: 'Centru Turda', latitude: 46.5667, longitude: 23.7833 },
  { city_name: 'Alba Iulia', location_name: 'Gara Alba Iulia', latitude: 46.0667, longitude: 23.5833 },
  { city_name: 'Sebeș', location_name: 'Centru Sebeș', latitude: 45.9597, longitude: 23.5681 },
  { city_name: 'Sibiu', location_name: 'Gara Mare Sibiu', latitude: 45.7983, longitude: 24.1256 },
  { city_name: 'Timișoara', location_name: 'Complexul Studențesc', latitude: 45.7489, longitude: 21.2417 },
  { city_name: 'Deva', location_name: 'Gara Deva', latitude: 45.8833, longitude: 22.9 },
  { city_name: 'Bacău', location_name: 'Stadionul Municipal', latitude: 46.567, longitude: 26.9146 },
  { city_name: 'Focșani', location_name: 'Centru Focșani', latitude: 45.6964, longitude: 27.1833 },
  { city_name: 'Buzău', location_name: 'Rond Spătaru', latitude: 45.15, longitude: 26.8167 },
  { city_name: 'Ploiești', location_name: 'Ploiești Nord', latitude: 44.95, longitude: 26.0167 },
  { city_name: 'București', location_name: 'Piața Romană / UPB', latitude: 44.445, longitude: 26.097 },
]);
