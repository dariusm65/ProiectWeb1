// Forward/reverse geocoding with a MySQL cache in front of Nominatim (D-009, C-001).
// Lookup order: geocoding_cache -> known_places (forward only) -> Nominatim -> persist.
// `fetchFn` is injected so tests never reach the live internet. Only real outbound calls are
// throttled (<= 1 request/second per the Nominatim usage policy); cache hits never wait.
import crypto from 'node:crypto';
import { ApiError } from '../errors.js';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const DEFAULT_USER_AGENT = 'StudRide-ULBS-coursework/0.1 (student project; contact via GitHub repo ProiectWeb1)';
const COORD_DECIMALS = 4; // ~11 m: nearby map clicks share one cache entry

export function normalizeQuery(q) {
  return String(q).normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const round = (n) => Number(n.toFixed(COORD_DECIMALS));
const unavailable = (msg = 'Geocoding provider is unavailable') =>
  new ApiError(502, 'GEOCODING_UNAVAILABLE', msg);

export function createGeocodingService({
  pool,
  fetchFn = globalThis.fetch,
  userAgent = DEFAULT_USER_AGENT,
  throttleMs = 1100,
  timeoutMs = 5000,
} = {}) {
  let queue = Promise.resolve();
  let lastCallAt = 0;

  /** Serialise outbound Nominatim calls with at least `throttleMs` between them (C-001). */
  function throttled(task) {
    const run = queue.then(async () => {
      const wait = lastCallAt + throttleMs - Date.now();
      if (throttleMs > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCallAt = Date.now();
      return task();
    });
    queue = run.catch(() => {});
    return run;
  }

  async function callNominatim(pathAndQuery) {
    return throttled(async () => {
      let res;
      try {
        res = await fetchFn(`${NOMINATIM_BASE}${pathAndQuery}`, {
          headers: { 'User-Agent': userAgent, 'Accept-Language': 'ro' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch {
        throw unavailable();
      }
    });
  }

  async function readCache(hash) {
    const [rows] = await pool.query(
      'SELECT latitude, longitude, display_name FROM geocoding_cache WHERE query_hash = ? LIMIT 1',
      [hash],
    );
    if (rows.length === 0) return null;
    return {
      lat: Number(rows[0].latitude),
      lng: Number(rows[0].longitude),
      display_name: rows[0].display_name,
      source: 'cache',
    };
  }

  async function writeCache(hash, queryText, hit) {
    await pool.query(
      `INSERT INTO geocoding_cache (query_hash, query_text, latitude, longitude, display_name)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE latitude = VALUES(latitude), longitude = VALUES(longitude),
         display_name = VALUES(display_name), cached_at = CURRENT_TIMESTAMP`,
      [hash, queryText.slice(0, 255), hit.lat, hit.lng, hit.display_name.slice(0, 255)],
    );
  }

  function parseHit(raw) {
    const lat = Number(raw?.lat);
    const lng = Number(raw?.lon);
    if (
      !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180 ||
      typeof raw.display_name !== 'string'
    ) {
      return null;
    }
    return { lat, lng, display_name: raw.display_name, source: 'nominatim' };
  }

  async function search(q) {
    const normalized = normalizeQuery(q);
    const hash = sha256(`fwd:${normalized}`);

    const cached = await readCache(hash);
    if (cached) return cached;

    const [places] = await pool.query(
      `SELECT name, city, latitude, longitude FROM known_places
       WHERE LOWER(name) = ? AND latitude IS NOT NULL AND longitude IS NOT NULL LIMIT 1`,
      [normalized],
    );
    if (places.length > 0) {
      const p = places[0];
      return {
        lat: Number(p.latitude),
        lng: Number(p.longitude),
        display_name: `${p.name}, ${p.city}`,
        source: 'known_places',
      };
    }

    const params = new URLSearchParams({ q: normalized, format: 'jsonv2', limit: '1', countrycodes: 'ro' });
    const body = await callNominatim(`/search?${params}`);
    const hit = Array.isArray(body) && body.length > 0 ? parseHit(body[0]) : null;
    if (!hit) throw new ApiError(404, 'GEOCODING_NOT_FOUND', 'No place found for this query');

    await writeCache(hash, normalized, hit);
    return hit;
  }

  async function reverse(lat, lng) {
    const rLat = round(lat);
    const rLng = round(lng);
    const hash = sha256(`rev:${rLat},${rLng}`);

    const cached = await readCache(hash);
    if (cached) return cached;

    const params = new URLSearchParams({ lat: String(rLat), lon: String(rLng), format: 'jsonv2' });
    const body = await callNominatim(`/reverse?${params}`);
    const hit = body && !body.error ? parseHit(body) : null;
    if (!hit) throw new ApiError(404, 'GEOCODING_NOT_FOUND', 'No place found at these coordinates');

    await writeCache(hash, `${rLat},${rLng}`, hit);
    return hit;
  }

  return { search, reverse };
}
