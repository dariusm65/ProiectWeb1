// Unit tests for pure geo helpers: Haversine distance and bounding box (D-017).
import { describe, it, expect } from 'vitest';
import { haversineKm, boundingBox } from '../src/domain/geo.js';

describe('haversineKm', () => {
  it('is 0 for identical points', () => {
    expect(haversineKm({ lat: 45.8, lng: 24.1 }, { lat: 45.8, lng: 24.1 })).toBe(0);
  });

  it('matches a known reference distance (Paris-London ~343.5 km)', () => {
    const d = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 });
    expect(Math.abs(d - 343.5)).toBeLessThan(1);
  });

  it('is symmetric', () => {
    const a = { lat: 46.77, lng: 23.6 };
    const b = { lat: 45.79, lng: 24.15 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });

  it('one degree of latitude is ~111.2 km and 0.009 deg is ~1 km', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.195, 2);
    const oneKm = haversineKm({ lat: 46, lng: 24 }, { lat: 46.009, lng: 24 });
    expect(oneKm).toBeGreaterThan(0.99);
    expect(oneKm).toBeLessThan(1.01);
  });

  it('handles the antimeridian', () => {
    const d = haversineKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 });
    expect(d).toBeCloseTo(111.195, 2);
  });
});

describe('boundingBox', () => {
  it('contains every point within the radius (all compass directions)', () => {
    const center = { lat: 45.8, lng: 24.1 };
    const radiusKm = 5;
    const box = boundingBox(center, radiusKm);
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      // point ~4.99 km away (flat approximation is fine at this scale)
      const dLat = (4.99 / 111.195) * Math.cos(rad);
      const dLng = ((4.99 / 111.195) * Math.sin(rad)) / Math.cos((center.lat * Math.PI) / 180);
      const p = { lat: center.lat + dLat, lng: center.lng + dLng };
      expect(haversineKm(center, p)).toBeLessThanOrEqual(radiusKm);
      expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(p.lat).toBeLessThanOrEqual(box.maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(p.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });

  it('excludes a point clearly outside the radius', () => {
    const box = boundingBox({ lat: 45.8, lng: 24.1 }, 1);
    expect(46.0).toBeGreaterThan(box.maxLat);
  });

  it('clamps latitude near the poles', () => {
    const box = boundingBox({ lat: 89.99, lng: 0 }, 5);
    expect(box.maxLat).toBeLessThanOrEqual(90);
  });
});
