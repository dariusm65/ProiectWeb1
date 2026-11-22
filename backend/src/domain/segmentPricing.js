// Pure proportional segment pricing (D-010) and reconfirmation deadline (D-007).
// Uses exact BigInt rational arithmetic to avoid IEEE-754 float drift on .5 boundaries.
import { CAPACITY_CONSUMING_STATUSES } from './segmentAvailability.js';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * Parse a non-negative decimal cost (number or string like "152.00") into integer bani (x 100) as BigInt.
 */
function parseCostToBani(declaredTripCost) {
  if (declaredTripCost === null || declaredTripCost === undefined) {
    throw new RangeError('declaredTripCost is required');
  }
  const str = typeof declaredTripCost === 'number'
    ? (Number.isFinite(declaredTripCost) ? declaredTripCost.toFixed(2) : '')
    : String(declaredTripCost).trim();

  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new RangeError(`Invalid declaredTripCost: ${declaredTripCost}`);
  }
  const [whole, frac = ''] = str.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

/**
 * Exact round-half-up for non-negative rational num / den using BigInt division.
 * round_half_up(num / den) = floor((2 * num + den) / (2 * den))
 */
function roundHalfUp(num, den) {
  return (2n * num + den) / (2n * den);
}

/**
 * Calculate integer lei segment price per D-010:
 *   seat_full_price = declared_trip_cost / (available_seats + 1)
 *   cum(i) = (dist(origin -> i) / total_dist) * seat_full_price
 *   segment_price(A, B) = round_half_up(cum(B)) - round_half_up(cum(A))
 */
export function calculateSegmentPrice({
  declaredTripCost,
  availableSeats,
  pickupDistKm,
  dropoffDistKm,
  totalDistKm,
}) {
  const costBani = parseCostToBani(declaredTripCost);
  if (!Number.isInteger(availableSeats) || availableSeats < 1) {
    throw new RangeError('availableSeats must be a positive integer');
  }
  if (!Number.isInteger(totalDistKm) || totalDistKm <= 0) {
    throw new RangeError('totalDistKm must be a positive integer');
  }
  if (
    !Number.isInteger(pickupDistKm) ||
    !Number.isInteger(dropoffDistKm) ||
    pickupDistKm < 0 ||
    dropoffDistKm > totalDistKm ||
    pickupDistKm >= dropoffDistKm
  ) {
    throw new RangeError('pickupDistKm must be < dropoffDistKm within [0, totalDistKm]');
  }

  const denominator = BigInt(totalDistKm) * BigInt(availableSeats + 1) * 100n;
  const cumPickupLei = roundHalfUp(costBani * BigInt(pickupDistKm), denominator);
  const cumDropoffLei = roundHalfUp(costBani * BigInt(dropoffDistKm), denominator);
  return Number(cumDropoffLei - cumPickupLei);
}

/**
 * Verify D-010 invariant: sum of all active passenger payments (confirmed + pending_reconfirmation)
 * plus any newly accepted booking's locked price_lei never exceeds declared_trip_cost.
 */
export function validateTripCostCap({ declaredTripCost, existingBookings, additionalPriceLei = 0 }) {
  const costBani = parseCostToBani(declaredTripCost);
  if (!Number.isInteger(additionalPriceLei) || additionalPriceLei < 0) {
    throw new RangeError('additionalPriceLei must be a non-negative integer');
  }

  let currentActiveTotalLei = 0;
  for (const b of existingBookings) {
    if (!CAPACITY_CONSUMING_STATUSES.has(b.status)) continue;
    currentActiveTotalLei += Number(b.price_lei || 0);
  }

  const projectedTotalLei = currentActiveTotalLei + additionalPriceLei;
  const withinCap = BigInt(projectedTotalLei) * 100n <= costBani;

  return {
    withinCap,
    currentActiveTotalLei,
    projectedTotalLei,
    declaredTripCost: Number(costBani) / 100,
  };
}

/**
 * Compute reconfirmation deadline when a driver modifies/adds/removes a stop (D-007):
 * - Modified > 2 h before departure:  min(modifiedAt + 6 h, departureTime - 2 h)
 * - Modified <= 2 h before departure: min(modifiedAt + 30 min, departureTime)
 */
export function computeReconfirmDeadline({ modifiedAt, departureTime }) {
  const modMs = new Date(modifiedAt).getTime();
  const depMs = new Date(departureTime).getTime();
  if (!Number.isFinite(modMs) || !Number.isFinite(depMs)) {
    throw new RangeError('modifiedAt and departureTime must be valid dates');
  }

  const remainingMs = depMs - modMs;
  const deadlineMs = remainingMs > 2 * MS_PER_HOUR
    ? Math.min(modMs + 6 * MS_PER_HOUR, depMs - 2 * MS_PER_HOUR)
    : Math.min(modMs + 30 * MS_PER_MINUTE, depMs);

  return new Date(deadlineMs);
}
