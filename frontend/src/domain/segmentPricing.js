// Pure proportional segment pricing (D-010) mirrored from backend/src/domain/segmentPricing.js.
// Uses exact BigInt rational arithmetic (round-half-up) so live frontend previews match server prices 1:1.

function parseCostToBani(declaredTripCost) {
  if (declaredTripCost === null || declaredTripCost === undefined) {
    return 0n;
  }
  const num = Number(declaredTripCost);
  if (!Number.isFinite(num) || num < 0) {
    return 0n;
  }
  const fixed = num.toFixed(2);
  const [whole, frac = '00'] = fixed.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
}

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
  const seats = Number(availableSeats);
  const totalKm = Number(totalDistKm);
  const pickKm = Number(pickupDistKm);
  const dropKm = Number(dropoffDistKm);

  if (
    !Number.isInteger(seats) ||
    seats < 1 ||
    !Number.isInteger(totalKm) ||
    totalKm <= 0 ||
    !Number.isInteger(pickKm) ||
    !Number.isInteger(dropKm) ||
    pickKm < 0 ||
    dropKm > totalKm ||
    pickKm >= dropKm
  ) {
    return 0;
  }

  const denominator = BigInt(totalKm) * BigInt(seats + 1) * 100n;
  const cumPickupLei = roundHalfUp(costBani * BigInt(pickKm), denominator);
  const cumDropoffLei = roundHalfUp(costBani * BigInt(dropKm), denominator);
  return Number(cumDropoffLei - cumPickupLei);
}
