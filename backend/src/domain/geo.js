// Pure geographic helpers for spatial segment search (D-005, D-017).

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = (Math.PI * EARTH_RADIUS_KM) / 180; // ~111.195 km
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle (Haversine) distance in kilometres between two {lat, lng} points. */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Axis-aligned lat/lng box that contains every point within `radiusKm` of `center`.
 * Used as a cheap SQL prefilter (idx_stops_coords) before the exact Haversine check.
 */
export function boundingBox(center, radiusKm) {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const minLat = Math.max(-90, center.lat - latDelta);
  const maxLat = Math.min(90, center.lat + latDelta);
  // Longitude degrees shrink with latitude; use the box edge farthest from the equator.
  const cosLat = Math.cos(toRad(Math.min(89.999, Math.abs(center.lat) + latDelta)));
  const lngDelta = latDelta / cosLat;
  return {
    minLat,
    maxLat,
    minLng: Math.max(-180, center.lng - lngDelta),
    maxLng: Math.min(180, center.lng + lngDelta),
  };
}
