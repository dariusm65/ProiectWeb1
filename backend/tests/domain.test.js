// Unit tests for pure P18 core domain logic:
// - Segment availability & selective competing-booking rejection (D-003, D-005, D-019)
// - Proportional segment pricing & declared trip cost cap (D-010)
// - Reconfirmation deadline calculation (D-007)
import { describe, it, expect } from 'vitest';
import {
  CAPACITY_CONSUMING_STATUSES,
  computeSegmentAvailability,
  getAvailableSeatsForRange,
  findCompetingPendingBookingsToReject,
} from '../src/domain/segmentAvailability.js';
import {
  calculateSegmentPrice,
  validateTripCostCap,
  computeReconfirmDeadline,
} from '../src/domain/segmentPricing.js';

// Shared fixture: Cluj-Napoca (10) -> Turda (20) -> Alba Iulia (30) -> Sibiu (40)
const clujSibiuStops = [
  { id: 1, stop_order: 10, city_name: 'Cluj-Napoca', distance_from_origin_km: 0, removed_at: null },
  { id: 2, stop_order: 20, city_name: 'Turda', distance_from_origin_km: 32, removed_at: null },
  { id: 3, stop_order: 30, city_name: 'Alba Iulia', distance_from_origin_km: 98, removed_at: null },
  { id: 4, stop_order: 40, city_name: 'Sibiu', distance_from_origin_km: 168, removed_at: null },
];

// ------------------------------------------------ Segment Availability (D-005)
describe('domain: segmentAvailability (D-005, D-019)', () => {
  it('only confirmed and pending_reconfirmation consume segment capacity', () => {
    expect([...CAPACITY_CONSUMING_STATUSES].sort()).toEqual(['confirmed', 'pending_reconfirmation']);
  });

  it('1. single-segment booking reduces capacity by 1 on that segment only', () => {
    const bookings = [
      { id: 101, pickup_stop_id: 1, dropoff_stop_id: 2, status: 'confirmed' },
    ];
    const segments = computeSegmentAvailability({
      stops: clujSibiuStops,
      bookings,
      availableSeats: 3,
    });
    expect(segments.map((s) => s.freeSeats)).toEqual([2, 3, 3]);
    expect(getAvailableSeatsForRange({
      stops: clujSibiuStops, bookings, availableSeats: 3, pickupStopId: 1, dropoffStopId: 2,
    })).toBe(2);
    expect(getAvailableSeatsForRange({
      stops: clujSibiuStops, bookings, availableSeats: 3, pickupStopId: 2, dropoffStopId: 4,
    })).toBe(3);
  });

  it('2. P18 sheet example: Cluj -> Turda -> Alba -> Sibiu (available_seats = 3)', () => {
    // P1 books Cluj(1) -> Alba(3), P2 books Turda(2) -> Sibiu(4)
    const bookings = [
      { id: 1, pickup_stop_id: 1, dropoff_stop_id: 3, status: 'confirmed' },
      { id: 2, pickup_stop_id: 2, dropoff_stop_id: 4, status: 'confirmed' },
    ];
    // Segment occupancy: Cluj->Turda: 1, Turda->Alba: 2, Alba->Sibiu: 1
    // Free seats:         2,              1,             2
    const beforeP3 = computeSegmentAvailability({
      stops: clujSibiuStops, bookings, availableSeats: 3,
    });
    expect(beforeP3.map((s) => s.freeSeats)).toEqual([2, 1, 2]);
    expect(getAvailableSeatsForRange({
      stops: clujSibiuStops, bookings, availableSeats: 3, pickupStopId: 3, dropoffStopId: 4,
    })).toBe(2);

    // Add P3 on Turda(2) -> Alba(3): Turda->Alba drops to 0, Alba->Sibiu remains 2
    const withP3 = [
      ...bookings,
      { id: 3, pickup_stop_id: 2, dropoff_stop_id: 3, status: 'confirmed' },
    ];
    const afterP3 = computeSegmentAvailability({
      stops: clujSibiuStops, bookings: withP3, availableSeats: 3,
    });
    expect(afterP3.map((s) => s.freeSeats)).toEqual([2, 0, 2]);
  });

  it('3. mid-route seat reuse: non-overlapping A->B and B->C reuse the same seat', () => {
    const bookings = [
      { id: 1, pickup_stop_id: 1, dropoff_stop_id: 2, status: 'confirmed' },
      { id: 2, pickup_stop_id: 2, dropoff_stop_id: 3, status: 'confirmed' },
      { id: 3, pickup_stop_id: 3, dropoff_stop_id: 4, status: 'confirmed' },
    ];
    const segments = computeSegmentAvailability({
      stops: clujSibiuStops, bookings, availableSeats: 1,
    });
    expect(segments.map((s) => s.occupiedSeats)).toEqual([1, 1, 1]);
    expect(segments.map((s) => s.freeSeats)).toEqual([0, 0, 0]);

    // With 2 seats, a full-route passenger still fits in the 2nd seat
    expect(getAvailableSeatsForRange({
      stops: clujSibiuStops, bookings, availableSeats: 2, pickupStopId: 1, dropoffStopId: 4,
    })).toBe(1);
  });

  it('4. pending, expired, rejected, and cancelled bookings do not consume capacity', () => {
    const bookings = [
      { id: 1, pickup_stop_id: 1, dropoff_stop_id: 4, status: 'pending' },
      { id: 2, pickup_stop_id: 1, dropoff_stop_id: 4, status: 'expired' },
      { id: 3, pickup_stop_id: 1, dropoff_stop_id: 4, status: 'rejected' },
      { id: 4, pickup_stop_id: 1, dropoff_stop_id: 4, status: 'cancelled' },
    ];
    const segments = computeSegmentAvailability({
      stops: clujSibiuStops, bookings, availableSeats: 2,
    });
    expect(segments.map((s) => s.freeSeats)).toEqual([2, 2, 2]);
  });

  it('5. soft-removed stop referenced by pending_reconfirmation booking still holds capacity', () => {
    // Turda (stop_order 20) is soft-removed; active segments become [10, 30) and [30, 40)
    const stopsWithSoftRemoval = [
      { id: 1, stop_order: 10, city_name: 'Cluj-Napoca', removed_at: null },
      { id: 2, stop_order: 20, city_name: 'Turda', removed_at: '2026-11-20 12:00:00' },
      { id: 3, stop_order: 30, city_name: 'Alba Iulia', removed_at: null },
      { id: 4, stop_order: 40, city_name: 'Sibiu', removed_at: null },
    ];
    // Booking [20, 40) in pending_reconfirmation overlaps both active segments [10, 30) and [30, 40)
    const bookings = [
      { id: 10, pickup_stop_id: 2, dropoff_stop_id: 4, status: 'pending_reconfirmation' },
    ];
    const segments = computeSegmentAvailability({
      stops: stopsWithSoftRemoval, bookings, availableSeats: 2,
    });
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => [s.fromOrder, s.toOrder, s.freeSeats])).toEqual([
      [10, 30, 1],
      [30, 40, 1],
    ]);

    // Once that booking lapses to expired, capacity returns to 2 on both active segments
    const afterLapse = computeSegmentAvailability({
      stops: stopsWithSoftRemoval,
      bookings: [{ id: 10, pickup_stop_id: 2, dropoff_stop_id: 4, status: 'expired' }],
      availableSeats: 2,
    });
    expect(afterLapse.map((s) => s.freeSeats)).toEqual([2, 2]);
  });

  it('6. newly inserted intermediate stop (stop_order 15 between 10 and 20) splits capacity accurately', () => {
    const stopsWithInsert = [
      { id: 1, stop_order: 10, city_name: 'Cluj-Napoca', removed_at: null },
      { id: 5, stop_order: 15, city_name: 'Feleacu', removed_at: null },
      { id: 2, stop_order: 20, city_name: 'Turda', removed_at: null },
      { id: 3, stop_order: 30, city_name: 'Alba Iulia', removed_at: null },
    ];
    const bookings = [
      { id: 1, pickup_stop_id: 1, dropoff_stop_id: 2, status: 'confirmed' }, // [10, 20) covers [10,15) and [15,20)
    ];
    const segments = computeSegmentAvailability({
      stops: stopsWithInsert, bookings, availableSeats: 2,
    });
    expect(segments.map((s) => [s.fromOrder, s.toOrder, s.freeSeats])).toEqual([
      [10, 15, 1],
      [15, 20, 1],
      [20, 30, 2],
    ]);
  });

  it('7. full-capacity segment returns 0 free seats across any covering range', () => {
    const bookings = [
      { id: 1, pickup_stop_id: 2, dropoff_stop_id: 3, status: 'confirmed' },
      { id: 2, pickup_stop_id: 2, dropoff_stop_id: 3, status: 'pending_reconfirmation' },
    ];
    expect(getAvailableSeatsForRange({
      stops: clujSibiuStops, bookings, availableSeats: 2, pickupStopId: 1, dropoffStopId: 4,
    })).toBe(0);
    expect(getAvailableSeatsForRange({
      stops: clujSibiuStops, bookings, availableSeats: 2, pickupStopId: 1, dropoffStopId: 2,
    })).toBe(2);
  });

  it('8. selective auto-rejection: rejects only competing pending bookings on saturated segments', () => {
    // available_seats = 2
    // Already confirmed: B1 on Turda(2)->Alba(3) => free seats: [2, 1, 2]
    // Driver accepts B2 (pending -> confirmed) on Cluj(1)->Alba(3) => free seats become: [1, 0, 2]
    // Competing pending bookings:
    // - B3 on Cluj(1)->Turda(2): overlaps B2 on [10,20) which still has 1 free seat -> MUST STAY PENDING
    // - B4 on Turda(2)->Sibiu(4): traverses [20,30) which dropped to 0 free seats -> MUST BE REJECTED
    // - B5 on Alba(3)->Sibiu(4): disjoint, 2 free seats -> MUST STAY PENDING
    const bookings = [
      { id: 1, pickup_stop_id: 2, dropoff_stop_id: 3, status: 'confirmed' },
      { id: 2, pickup_stop_id: 1, dropoff_stop_id: 3, status: 'pending' },
      { id: 3, pickup_stop_id: 1, dropoff_stop_id: 2, status: 'pending' },
      { id: 4, pickup_stop_id: 2, dropoff_stop_id: 4, status: 'pending' },
      { id: 5, pickup_stop_id: 3, dropoff_stop_id: 4, status: 'pending' },
    ];
    const { toReject, toKeepPending } = findCompetingPendingBookingsToReject({
      stops: clujSibiuStops,
      bookings,
      availableSeats: 2,
      acceptedBookingId: 2,
    });
    expect(toReject.map((b) => b.id)).toEqual([4]);
    expect(toKeepPending.map((b) => b.id).sort((a, b) => a - b)).toEqual([3, 5]);
  });

  it('rejects invalid stop ranges (pickup >= dropoff or unknown stop)', () => {
    expect(() => getAvailableSeatsForRange({
      stops: clujSibiuStops, bookings: [], availableSeats: 3, pickupStopId: 3, dropoffStopId: 2,
    })).toThrow(/stop_order/i);
    expect(() => getAvailableSeatsForRange({
      stops: clujSibiuStops, bookings: [], availableSeats: 3, pickupStopId: 999, dropoffStopId: 2,
    })).toThrow(/stop/i);
  });

  it('rejects soft-removed pickup or dropoff stop in getAvailableSeatsForRange', () => {
    const stopsWithSoftRemoval = [
      { id: 1, stop_order: 10, city_name: 'Cluj-Napoca', removed_at: null },
      { id: 2, stop_order: 20, city_name: 'Turda', removed_at: '2026-11-20 12:00:00' },
      { id: 3, stop_order: 30, city_name: 'Sibiu', removed_at: null },
    ];
    expect(() => getAvailableSeatsForRange({
      stops: stopsWithSoftRemoval, bookings: [], availableSeats: 2, pickupStopId: 2, dropoffStopId: 3,
    })).toThrow(/removed/i);
  });

  it('strict D-003 selective rejection: does not reject pending booking on a disjoint already-saturated segment', () => {
    // available_seats = 1
    // B1 (pending_reconfirmation) already saturates Alba(3)->Sibiu(4) (pre freeSeats = 0)
    // Driver accepts B2 on Cluj(1)->Turda(2) (only Cluj->Turda drops from 1 to 0)
    // Competing pending B3 on Alba(3)->Sibiu(4) was already at 0 before B2; MUST NOT be rejected by B2
    const bookings = [
      { id: 1, pickup_stop_id: 3, dropoff_stop_id: 4, status: 'pending_reconfirmation' },
      { id: 2, pickup_stop_id: 1, dropoff_stop_id: 2, status: 'pending' },
      { id: 3, pickup_stop_id: 3, dropoff_stop_id: 4, status: 'pending' },
    ];
    const { toReject, toKeepPending } = findCompetingPendingBookingsToReject({
      stops: clujSibiuStops,
      bookings,
      availableSeats: 1,
      acceptedBookingId: '2', // also verifies string ID normalization
    });
    expect(toReject).toEqual([]);
    expect(toKeepPending.map((b) => b.id)).toEqual([3]);
  });
});

// ------------------------------------------------ Proportional Pricing (D-010)
describe('domain: segmentPricing (D-010) & reconfirmDeadline (D-007)', () => {
  it('9. exact sub-segment additivity without clamping across multi-stop routes', () => {
    // Cluj(0) -> Turda(32) -> Alba(98) -> Sibiu(168), cost = 152 lei, available_seats = 3 (divisor 4 => full = 38)
    const p12 = calculateSegmentPrice({ declaredTripCost: 152, availableSeats: 3, pickupDistKm: 0, dropoffDistKm: 32, totalDistKm: 168 });
    const p23 = calculateSegmentPrice({ declaredTripCost: 152, availableSeats: 3, pickupDistKm: 32, dropoffDistKm: 98, totalDistKm: 168 });
    const p34 = calculateSegmentPrice({ declaredTripCost: 152, availableSeats: 3, pickupDistKm: 98, dropoffDistKm: 168, totalDistKm: 168 });
    const p14 = calculateSegmentPrice({ declaredTripCost: 152, availableSeats: 3, pickupDistKm: 0, dropoffDistKm: 168, totalDistKm: 168 });

    expect(p14).toBe(38);
    expect(p12 + p23 + p34).toBe(p14);

    // Also verify with a tricky non-divisible cost (e.g. 100 lei, 2 seats => seat_full_price = 33.333...)
    const q12 = calculateSegmentPrice({ declaredTripCost: 100, availableSeats: 2, pickupDistKm: 0, dropoffDistKm: 33, totalDistKm: 100 });
    const q23 = calculateSegmentPrice({ declaredTripCost: 100, availableSeats: 2, pickupDistKm: 33, dropoffDistKm: 67, totalDistKm: 100 });
    const q34 = calculateSegmentPrice({ declaredTripCost: 100, availableSeats: 2, pickupDistKm: 67, dropoffDistKm: 100, totalDistKm: 100 });
    const q14 = calculateSegmentPrice({ declaredTripCost: 100, availableSeats: 2, pickupDistKm: 0, dropoffDistKm: 100, totalDistKm: 100 });
    expect(q12 + q23 + q34).toBe(q14);
  });

  it('10. exact .5 half-up rounding via rational/BigInt math without IEEE-754 drift', () => {
    // cost = 35, seats = 1 (divisor 2 => seat_full_price = 17.5 -> rounds half-up to 18)
    expect(calculateSegmentPrice({
      declaredTripCost: 35, availableSeats: 1, pickupDistKm: 0, dropoffDistKm: 100, totalDistKm: 100,
    })).toBe(18);

    // Decimal cost where float math drifts: declared_trip_cost = 10.05, seats = 2 (divisor 3 => 3.35),
    // half-route (50/100) => 1.675 -> 2; cost = 15.00, seats = 1 => 7.5 -> 8
    expect(calculateSegmentPrice({
      declaredTripCost: '15.00', availableSeats: 1, pickupDistKm: 0, dropoffDistKm: 50, totalDistKm: 50,
    })).toBe(8);

    // Exact 0.5 boundary: cost = 3, seats = 2 (divisor 3 => seat_full = 1), dist 50/100 => cum = 0.5 -> 1
    expect(calculateSegmentPrice({
      declaredTripCost: 3, availableSeats: 2, pickupDistKm: 0, dropoffDistKm: 50, totalDistKm: 100,
    })).toBe(1);
    // Remaining half [50, 100]: round_half_up(1.0) - round_half_up(0.5) = 1 - 1 = 0, sum = 1 === full seat price
    expect(calculateSegmentPrice({
      declaredTripCost: 3, availableSeats: 2, pickupDistKm: 50, dropoffDistKm: 100, totalDistKm: 100,
    })).toBe(0);

    // Zero-cost ride is valid (CHECK declared_trip_cost >= 0)
    expect(calculateSegmentPrice({
      declaredTripCost: 0, availableSeats: 3, pickupDistKm: 0, dropoffDistKm: 100, totalDistKm: 100,
    })).toBe(0);
  });

  it('rejects invalid pricing inputs (zero totalDistKm, pickup >= dropoff, negative cost)', () => {
    expect(() => calculateSegmentPrice({
      declaredTripCost: 100, availableSeats: 3, pickupDistKm: 0, dropoffDistKm: 0, totalDistKm: 0,
    })).toThrow();
    expect(() => calculateSegmentPrice({
      declaredTripCost: 100, availableSeats: 3, pickupDistKm: 80, dropoffDistKm: 40, totalDistKm: 100,
    })).toThrow();
    expect(() => calculateSegmentPrice({
      declaredTripCost: -10, availableSeats: 3, pickupDistKm: 0, dropoffDistKm: 50, totalDistKm: 100,
    })).toThrow();
  });

  it('11. validateTripCostCap sums only confirmed + pending_reconfirmation bookings', () => {
    const bookings = [
      { id: 1, status: 'confirmed', price_lei: 38 },
      { id: 2, status: 'pending_reconfirmation', price_lei: 38 },
      { id: 3, status: 'pending', price_lei: 38 },
      { id: 4, status: 'cancelled', price_lei: 38 },
      { id: 5, status: 'expired', price_lei: 38 },
    ];
    // Active sum = 76; adding 38 => 114 <= 152 (ok)
    expect(validateTripCostCap({ declaredTripCost: 152, existingBookings: bookings, additionalPriceLei: 38 }))
      .toEqual({ withinCap: true, currentActiveTotalLei: 76, projectedTotalLei: 114, declaredTripCost: 152 });

    // Adding 80 => 156 > 152 (exceeds cap)
    expect(validateTripCostCap({ declaredTripCost: 152, existingBookings: bookings, additionalPriceLei: 80 }).withinCap)
      .toBe(false);
  });

  it('12. computeReconfirmDeadline obeys D-007 (> 2h and <= 2h branches)', () => {
    const dep = new Date('2026-12-01T18:00:00Z');

    // > 2h before departure, plenty of time (10h out): min(now + 6h, dep - 2h) = now + 6h
    const d1 = computeReconfirmDeadline({ modifiedAt: new Date('2026-12-01T08:00:00Z'), departureTime: dep });
    expect(d1.toISOString()).toBe('2026-12-01T14:00:00.000Z');

    // > 2h before departure, 4h out: min(now + 6h = 20:00, dep - 2h = 16:00) = 16:00
    const d2 = computeReconfirmDeadline({ modifiedAt: new Date('2026-12-01T14:00:00Z'), departureTime: dep });
    expect(d2.toISOString()).toBe('2026-12-01T16:00:00.000Z');

    // Exactly 2h before departure (<= 2h branch): min(now + 30m, dep) = 16:30
    const d3 = computeReconfirmDeadline({ modifiedAt: new Date('2026-12-01T16:00:00Z'), departureTime: dep });
    expect(d3.toISOString()).toBe('2026-12-01T16:30:00.000Z');

    // 15 min before departure (<= 2h branch): min(now + 30m = 18:15, dep = 18:00) = 18:00
    const d4 = computeReconfirmDeadline({ modifiedAt: new Date('2026-12-01T17:45:00Z'), departureTime: dep });
    expect(d4.toISOString()).toBe('2026-12-01T18:00:00.000Z');
  });

  it('allows same-city zero-distance segment (returns 0 lei) and enforces strict decimal/price validation', () => {
    expect(calculateSegmentPrice({
      declaredTripCost: 120, availableSeats: 3, pickupDistKm: 32, dropoffDistKm: 32, totalDistKm: 168,
    })).toBe(0);

    // Numeric >2 decimal places rejected consistently with strings
    expect(() => calculateSegmentPrice({
      declaredTripCost: 10.005, availableSeats: 2, pickupDistKm: 0, dropoffDistKm: 50, totalDistKm: 100,
    })).toThrow(RangeError);
    expect(() => calculateSegmentPrice({
      declaredTripCost: '10.005', availableSeats: 2, pickupDistKm: 0, dropoffDistKm: 50, totalDistKm: 100,
    })).toThrow(RangeError);

    // Negative or non-integer active booking price_lei rejected in validateTripCostCap
    expect(() => validateTripCostCap({
      declaredTripCost: 100,
      existingBookings: [{ id: 1, status: 'confirmed', price_lei: -10 }],
      additionalPriceLei: 20,
    })).toThrow(RangeError);
    expect(() => validateTripCostCap({
      declaredTripCost: 100,
      existingBookings: [{ id: 1, status: 'confirmed', price_lei: 12.5 }],
      additionalPriceLei: 20,
    })).toThrow(RangeError);
  });
});
