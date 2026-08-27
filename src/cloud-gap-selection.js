const POLAR_PRODUCTS = new Set(['viirs-cloud', 'modis-cloud']);
const MODEL_PRODUCT = 'gfs-total-cloud';

function timestamp(value, field) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid cloud-gap ${field}`);
  return parsed;
}

function requireFraction(value, field) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid cloud-gap ${field}`);
}

function validateThresholds(thresholds) {
  if (!Number.isSafeInteger(thresholds?.maxObservationAgeSeconds) || thresholds.maxObservationAgeSeconds <= 0) {
    throw new Error('Invalid cloud-gap maxObservationAgeSeconds');
  }
  requireFraction(thresholds.minObservationQuality, 'minObservationQuality');
  if (!Number.isSafeInteger(thresholds.seamBlendPixels) || thresholds.seamBlendPixels < 0) {
    throw new Error('Invalid cloud-gap seamBlendPixels');
  }
  return { ...thresholds };
}

function validateCandidate(candidate) {
  if (!candidate || (!POLAR_PRODUCTS.has(candidate.product) && candidate.product !== MODEL_PRODUCT)) {
    throw new Error('Unsupported cloud-gap product');
  }
  for (const field of ['validAt', 'producedAt']) timestamp(candidate[field], field);
  for (const field of ['version', 'href']) {
    if (typeof candidate[field] !== 'string' || candidate[field].trim() === '') throw new Error(`Invalid cloud-gap ${field}`);
  }
  const range = candidate.coverage?.latitudeRange;
  requireFraction(candidate.coverage?.observedFraction, 'coverage.observedFraction');
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)
    || range[0] < -90 || range[1] > 90 || range[0] >= range[1]) {
    throw new Error('Invalid cloud-gap coverage.latitudeRange');
  }
  if (POLAR_PRODUCTS.has(candidate.product)) {
    const observedFrom = timestamp(candidate.observedFrom, 'observedFrom');
    const observedTo = timestamp(candidate.observedTo, 'observedTo');
    const validAt = timestamp(candidate.validAt, 'validAt');
    if (observedFrom > observedTo || observedTo > validAt || validAt > timestamp(candidate.producedAt, 'producedAt')) {
      throw new Error('Invalid cloud-gap polar observation window');
    }
  } else {
    const runAt = timestamp(candidate.runAt, 'runAt');
    if (!Number.isSafeInteger(candidate.forecastHour) || candidate.forecastHour < 0
      || timestamp(candidate.validAt, 'validAt') - runAt !== candidate.forecastHour * 60 * 60 * 1000) {
      throw new Error('Invalid cloud-gap GFS forecast hour');
    }
  }
}

export function selectCloudGapSources({ candidates, targetValidAt, retrievedAt, thresholds }) {
  if (!Array.isArray(candidates)) throw new Error('Cloud-gap candidates must be an array');
  const targetMs = timestamp(targetValidAt, 'targetValidAt');
  const retrievedMs = timestamp(retrievedAt, 'retrievedAt');
  if (targetMs > retrievedMs) throw new Error('Cloud-gap target time cannot follow retrieval');
  const selectedThresholds = validateThresholds(thresholds);
  candidates.forEach(validateCandidate);

  const polarObservation = candidates
    .filter(candidate => POLAR_PRODUCTS.has(candidate.product)
      && Date.parse(candidate.validAt) <= targetMs
      && Date.parse(candidate.observedFrom) <= targetMs
      && Date.parse(candidate.observedTo) <= retrievedMs
      && Date.parse(candidate.producedAt) <= retrievedMs
      && targetMs - Date.parse(candidate.observedTo) <= selectedThresholds.maxObservationAgeSeconds * 1000)
    .sort((left, right) => Date.parse(right.observedTo) - Date.parse(left.observedTo))[0];
  const model = candidates
    .filter(candidate => candidate.product === MODEL_PRODUCT
      && Date.parse(candidate.validAt) === targetMs
      && Date.parse(candidate.runAt) <= targetMs
      && Date.parse(candidate.producedAt) <= retrievedMs)
    .sort((left, right) => Date.parse(right.runAt) - Date.parse(left.runAt))[0];

  return {
    targetValidAt: new Date(targetMs).toISOString().replace('.000Z', 'Z'),
    retrievedAt: new Date(retrievedMs).toISOString().replace('.000Z', 'Z'),
    ...(polarObservation ? { polarObservation } : {}),
    ...(model ? { model } : {}),
    thresholds: selectedThresholds,
  };
}
