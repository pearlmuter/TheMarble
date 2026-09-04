const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_VIIRS_AGE_MS = 36 * 60 * 60 * 1000;
const SUPPORTED_PRODUCTS = new Set([
  'ims-snow-ice', 'gmasi-snow', 'gmasi-sea-ice', 'amsr2-snow', 'amsr2-sea-ice', 'viirs-snow',
]);
const GLOBAL_PAIRS = [
  ['gmasi-snow', 'gmasi-sea-ice'],
  ['amsr2-snow', 'amsr2-sea-ice'],
];

function requireTimestamp(value, name) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid cryosphere ${name}`);
  return parsed;
}

function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function newest(entries) {
  return entries.reduce((latest, entry) => (
    !latest || Date.parse(entry.producedAt) > Date.parse(latest.producedAt) ? entry : latest
  ), undefined);
}

function validateCandidate(candidate) {
  if (!candidate || !SUPPORTED_PRODUCTS.has(candidate.product)) throw new Error('Unsupported cryosphere product');
  const validAt = requireTimestamp(candidate.validAt, 'validAt');
  const producedAt = requireTimestamp(candidate.producedAt, 'producedAt');
  if (producedAt < validAt) throw new Error('Invalid cryosphere producedAt');
  for (const field of ['version', 'href']) {
    if (typeof candidate[field] !== 'string' || candidate[field].trim() === '') throw new Error(`Invalid cryosphere ${field}`);
  }
  const range = candidate.coverage?.latitudeRange;
  const fraction = candidate.coverage?.observedFraction;
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)
    || range[0] < -90 || range[1] > 90 || range[0] >= range[1]
    || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error('Invalid cryosphere coverage');
  }
}

function isGlobalCoverage(candidate) {
  return candidate.coverage.latitudeRange[0] <= -89
    && candidate.coverage.latitudeRange[1] >= 89
    && candidate.coverage.observedFraction >= 0.9;
}

function isNorthernCoverage(candidate) {
  return candidate.coverage.latitudeRange[0] <= 1
    && candidate.coverage.latitudeRange[1] >= 89
    && candidate.coverage.observedFraction >= 0.45;
}

function findGlobalPair(products) {
  return GLOBAL_PAIRS.find(([snow, seaIce]) => (
    (products.get(snow) ?? []).some(isGlobalCoverage)
    && (products.get(seaIce) ?? []).some(isGlobalCoverage)
  ));
}

export function selectDailyCryosphere({ candidates, retrievedAt, lastPublishedValidAt }) {
  const retrievedMs = requireTimestamp(retrievedAt, 'retrieval time');
  if (!Array.isArray(candidates)) throw new Error('Cryosphere candidates must be an array');
  candidates.forEach(validateCandidate);

  const usable = candidates.filter(candidate => {
    const validMs = Date.parse(candidate.validAt);
    const producedMs = Date.parse(candidate.producedAt);
    return validMs <= retrievedMs && producedMs <= retrievedMs && retrievedMs - validMs <= 3 * DAY_MS;
  });
  const byDay = new Map();
  for (const candidate of usable) {
    const day = utcDay(candidate.validAt);
    const products = byDay.get(day) ?? new Map();
    const entries = products.get(candidate.product) ?? [];
    entries.push(candidate);
    products.set(candidate.product, entries);
    byDay.set(day, products);
  }

  // A whole globe outranks a newer half of one, so a day carrying a global pair
  // always wins. Failing that, IMS alone still publishes the Northern
  // Hemisphere: no global analysis has a public endpoint that serves values, and
  // requiring one meant nothing was ever published at all.
  const hasNorthern = products => (products.get('ims-snow-ice') ?? []).some(isNorthernCoverage);
  const usableDays = [...byDay.entries()]
    .filter(([, products]) => findGlobalPair(products) !== undefined || hasNorthern(products))
    .sort(([left], [right]) => left.localeCompare(right));
  const selected = usableDays.filter(([, products]) => findGlobalPair(products) !== undefined).at(-1)
    ?? usableDays.at(-1);
  if (!selected) throw new Error('Cryosphere discovery did not find a usable cryosphere day');

  const [day, products] = selected;
  const validAt = `${day}T00:00:00Z`;
  const northernPrimary = newest((products.get('ims-snow-ice') ?? []).filter(isNorthernCoverage));
  const globalPair = findGlobalPair(products);
  const globalSnow = globalPair && newest(products.get(globalPair[0]).filter(isGlobalCoverage));
  const globalSeaIce = globalPair && newest(products.get(globalPair[1]).filter(isGlobalCoverage));
  const viirs = newest(usable.filter(candidate => candidate.product === 'viirs-snow'
    && typeof candidate.qualityHref === 'string' && candidate.qualityHref.trim() !== ''
    && retrievedMs - Date.parse(candidate.validAt) <= MAX_VIIRS_AGE_MS
    && Math.abs(Date.parse(candidate.validAt) - Date.parse(validAt)) <= MAX_VIIRS_AGE_MS));

  return {
    validAt,
    retrievedAt: new Date(retrievedMs).toISOString().replace('.000Z', 'Z'),
    analysis: {
      ...(northernPrimary ? { northernPrimary } : {}),
      ...(globalSnow ? { globalFallback: { snow: globalSnow, seaIce: globalSeaIce } } : {}),
    },
    ...(viirs ? { refinement: viirs } : {}),
    fallback: globalSnow
      ? (northernPrimary
        ? { ims: false }
        : { ims: true, reason: `IMS unavailable for the selected day; global ${globalSnow.product.split('-', 1)[0].toUpperCase()} analysis covers the Northern Hemisphere.` })
      : { ims: false, reason: 'No global analysis is configured, so IMS covers the Northern Hemisphere and the Southern Hemisphere is not observed.' },
    publish: !lastPublishedValidAt || Date.parse(validAt) > requireTimestamp(lastPublishedValidAt, 'last published validAt'),
  };
}
