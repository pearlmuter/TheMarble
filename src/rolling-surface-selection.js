import { rollingSurfaceProduct } from './rolling-surface-products.js';

const DAY_MS = 86_400_000;

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function selectRollingSurfaceObservations({
  targetTime,
  previousObservationWindows = [],
  candidates,
  maxCandidateAgeDays = 16,
  minAcceptedFraction = 0.25,
}) {
  const target = timestamp(targetTime);
  if (target === undefined) throw new Error('Invalid rolling-surface targetTime');
  const contributed = new Set(previousObservationWindows.map(window => [
    window.product,
    window.version,
    window.validAt,
    window.observedFrom,
    window.observedTo,
  ].join('|')));

  return candidates
    .filter(candidate => {
      const validAt = timestamp(candidate.validAt);
      const observedFrom = timestamp(candidate.observedFrom);
      const observedTo = timestamp(candidate.observedTo);
      const producedAt = timestamp(candidate.producedAt);
      return rollingSurfaceProduct(candidate.product) !== undefined
        && typeof candidate.version === 'string' && candidate.version.length > 0
        && typeof candidate.href === 'string' && candidate.href.length > 0
        && validAt !== undefined && observedFrom !== undefined && observedTo !== undefined && producedAt !== undefined
        && observedFrom <= validAt && validAt <= observedTo && observedTo <= producedAt && producedAt <= target
        && (target - validAt) / DAY_MS <= maxCandidateAgeDays
        && !contributed.has([candidate.product, candidate.version, candidate.validAt, candidate.observedFrom, candidate.observedTo].join('|'))
        && Number.isFinite(candidate.quality?.acceptedFraction)
        && candidate.quality.acceptedFraction >= minAcceptedFraction;
    })
    .sort((left, right) => {
      const timeDifference = Date.parse(right.validAt) - Date.parse(left.validAt);
      if (timeDifference !== 0) return timeDifference;
      const productDifference = rollingSurfaceProduct(right.product).priority - rollingSurfaceProduct(left.product).priority;
      if (productDifference !== 0) return productDifference;
      return left.href.localeCompare(right.href);
    });
}
