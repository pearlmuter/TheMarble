const PRODUCTS = new Set(['mcd43a4-nbar', 'viirs-surface-reflectance']);
const DAY_MS = 86_400_000;

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function selectRollingSurfaceObservations({
  targetTime,
  previousValidAt,
  candidates,
  maxCandidateAgeDays = 16,
  minAcceptedFraction = 0.25,
}) {
  const target = timestamp(targetTime);
  if (target === undefined) throw new Error('Invalid rolling-surface targetTime');
  const previous = previousValidAt === undefined ? undefined : timestamp(previousValidAt);
  if (previousValidAt !== undefined && previous === undefined) throw new Error('Invalid rolling-surface previousValidAt');

  return candidates
    .filter(candidate => {
      const validAt = timestamp(candidate.validAt);
      const observedFrom = timestamp(candidate.observedFrom);
      const observedTo = timestamp(candidate.observedTo);
      const producedAt = timestamp(candidate.producedAt);
      return PRODUCTS.has(candidate.product)
        && typeof candidate.version === 'string' && candidate.version.length > 0
        && typeof candidate.href === 'string' && candidate.href.length > 0
        && validAt !== undefined && observedFrom !== undefined && observedTo !== undefined && producedAt !== undefined
        && observedFrom <= validAt && validAt <= observedTo && observedTo <= producedAt && producedAt <= target
        && (target - validAt) / DAY_MS <= maxCandidateAgeDays
        && (previous === undefined || validAt >= previous)
        && Number.isFinite(candidate.quality?.acceptedFraction)
        && candidate.quality.acceptedFraction >= minAcceptedFraction;
    })
    .sort((left, right) => {
      const timeDifference = Date.parse(right.validAt) - Date.parse(left.validAt);
      if (timeDifference !== 0) return timeDifference;
      const productDifference = Number(right.product === 'mcd43a4-nbar') - Number(left.product === 'mcd43a4-nbar');
      if (productDifference !== 0) return productDifference;
      return left.href.localeCompare(right.href);
    });
}
