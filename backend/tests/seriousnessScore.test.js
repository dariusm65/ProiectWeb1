// Unit tests for the pure D-016 seriousness score, 7-day publishing ban and
// late-cancel window helpers.
import { describe, it, expect } from 'vitest';
import {
  computeSeriousnessScore,
  isPublishingBanned,
  isWithinLateCancelWindow,
  isWithinPassengerLateCancelWindow,
  calculatePassengerCancellationFee,
  hasRecentCancellationBadge,
} from '../src/domain/seriousnessScore.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-12-01T09:00:00Z');
const ago = (days) => new Date(now.getTime() - days * DAY);
const driverLate = (daysAgo) => ({
  infraction_type: 'driver_late_cancel',
  penalty_percentage_points: 5,
  occurred_at: ago(daysAgo),
});
const passengerLate = (daysAgo) => ({
  infraction_type: 'passenger_late_cancel',
  penalty_percentage_points: 3,
  occurred_at: ago(daysAgo),
});

describe('computeSeriousnessScore', () => {
  it('starts at 100 with no infractions', () => {
    expect(computeSeriousnessScore([], now)).toBe(100);
  });

  it('applies a driver penalty of -5 and a passenger penalty of -3', () => {
    expect(computeSeriousnessScore([driverLate(1)], now)).toBe(95);
    expect(computeSeriousnessScore([passengerLate(1)], now)).toBe(97);
  });

  it('recovers +1 per full 7 days since the last infraction', () => {
    expect(computeSeriousnessScore([driverLate(6)], now)).toBe(95);
    expect(computeSeriousnessScore([driverLate(7)], now)).toBe(96);
    expect(computeSeriousnessScore([driverLate(20)], now)).toBe(97);
  });

  it('never exceeds 100', () => {
    expect(computeSeriousnessScore([driverLate(400)], now)).toBe(100);
  });

  it('clamps at 0 and recovers from 0', () => {
    const many = Array.from({ length: 25 }, () => driverLate(0.5));
    expect(computeSeriousnessScore(many, now)).toBe(0);
    expect(computeSeriousnessScore(many, new Date(now.getTime() + 14 * DAY))).toBe(2);
  });

  it('replays events chronologically regardless of input order', () => {
    const a = computeSeriousnessScore([driverLate(1), driverLate(30)], now);
    const b = computeSeriousnessScore([driverLate(30), driverLate(1)], now);
    expect(a).toBe(b);
    // 100 -5 = 95; 29 clean days (+4) = 99; -5 = 94; no full week since => 94
    expect(a).toBe(94);
  });

  it('ignores infractions that occur after now', () => {
    const future = { ...driverLate(0), occurred_at: new Date(now.getTime() + DAY) };
    expect(computeSeriousnessScore([future], now)).toBe(100);
  });
});

describe('isPublishingBanned', () => {
  it('is true for a driver_late_cancel within the last 7 days', () => {
    expect(isPublishingBanned([driverLate(3)], now)).toBe(true);
    expect(isPublishingBanned([driverLate(6.9)], now)).toBe(true);
  });

  it('is false once 7 days have passed', () => {
    expect(isPublishingBanned([driverLate(7)], now)).toBe(false);
    expect(isPublishingBanned([driverLate(8)], now)).toBe(false);
  });

  it('ignores passenger late cancellations and empty history', () => {
    expect(isPublishingBanned([passengerLate(1)], now)).toBe(false);
    expect(isPublishingBanned([], now)).toBe(false);
  });
});

describe('isWithinLateCancelWindow', () => {
  it('is true on the departure day (Europe/Bucharest) before departure', () => {
    const departureTime = new Date('2026-12-01T16:00:00Z'); // 18:00 local
    expect(isWithinLateCancelWindow({ departureTime, now })).toBe(true);
  });

  it('is false on an earlier day or at/after departure', () => {
    const departureTime = new Date('2026-12-04T16:00:00Z');
    expect(isWithinLateCancelWindow({ departureTime, now })).toBe(false);
    expect(
      isWithinLateCancelWindow({ departureTime: new Date('2026-12-01T08:00:00Z'), now }),
    ).toBe(false);
  });

  it('uses the Bucharest calendar day, not the UTC day', () => {
    // 22:30Z on Dec 1 is already Dec 2 locally; departure Dec 2 06:00Z (08:00 local)
    const lateNow = new Date('2026-12-01T22:30:00Z');
    expect(
      isWithinLateCancelWindow({ departureTime: new Date('2026-12-02T06:00:00Z'), now: lateNow }),
    ).toBe(true);
  });
});

describe('isWithinPassengerLateCancelWindow', () => {
  it('is true strictly when < 4 hours remain before departure (D-016)', () => {
    // 3h59m before departure
    expect(
      isWithinPassengerLateCancelWindow({
        departureTime: new Date(now.getTime() + (4 * 60 - 1) * 60 * 1000),
        now,
      }),
    ).toBe(true);
    // 1 minute before departure
    expect(
      isWithinPassengerLateCancelWindow({
        departureTime: new Date(now.getTime() + 60 * 1000),
        now,
      }),
    ).toBe(true);
  });

  it('is false when >= 4 hours remain or at/after departure', () => {
    // Exactly 4 hours before departure -> not < 4h
    expect(
      isWithinPassengerLateCancelWindow({
        departureTime: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        now,
      }),
    ).toBe(false);
    // 5 hours before departure
    expect(
      isWithinPassengerLateCancelWindow({
        departureTime: new Date(now.getTime() + 5 * 60 * 60 * 1000),
        now,
      }),
    ).toBe(false);
    // At or after departure
    expect(isWithinPassengerLateCancelWindow({ departureTime: now, now })).toBe(false);
    expect(
      isWithinPassengerLateCancelWindow({
        departureTime: new Date(now.getTime() - 60 * 1000),
        now,
      }),
    ).toBe(false);
  });
});

describe('calculatePassengerCancellationFee', () => {
  it('calculates 50% of booked segment price with round-half-up, capped at 20 lei (D-016)', () => {
    expect(calculatePassengerCancellationFee(0)).toBe(0);
    expect(calculatePassengerCancellationFee(10)).toBe(5);
    expect(calculatePassengerCancellationFee(15)).toBe(8); // 7.5 -> 8
    expect(calculatePassengerCancellationFee(30)).toBe(15);
    expect(calculatePassengerCancellationFee(40)).toBe(20);
    expect(calculatePassengerCancellationFee(41)).toBe(20); // 20.5 -> capped at 20
    expect(calculatePassengerCancellationFee(80)).toBe(20);
  });

  it('throws on negative or non-integer priceLei', () => {
    expect(() => calculatePassengerCancellationFee(-2)).toThrow(RangeError);
    expect(() => calculatePassengerCancellationFee(12.5)).toThrow(RangeError);
  });
});

describe('hasRecentCancellationBadge', () => {
  it('is true when a driver_late_cancel occurred within the last 30 days (D-016)', () => {
    expect(hasRecentCancellationBadge([driverLate(1)], now)).toBe(true);
    expect(hasRecentCancellationBadge([driverLate(29.9)], now)).toBe(true);
  });

  it('is false once 30 days have passed or for passenger infractions', () => {
    expect(hasRecentCancellationBadge([driverLate(30)], now)).toBe(false);
    expect(hasRecentCancellationBadge([driverLate(35)], now)).toBe(false);
    expect(hasRecentCancellationBadge([passengerLate(1)], now)).toBe(false);
    expect(hasRecentCancellationBadge([], now)).toBe(false);
  });
});
