import { selectDailyCryosphere } from './cryosphere-selection.js';

const ATTRIBUTION = {
  'ims-snow-ice': 'U.S. National Ice Center IMS',
  'gmasi-snow': 'NOAA/NESDIS GMASI',
  'gmasi-sea-ice': 'NOAA/NESDIS GMASI',
  'amsr2-snow': 'NASA/JAXA AMSR2',
  'amsr2-sea-ice': 'NASA/JAXA AMSR2',
  'viirs-snow': 'NASA VIIRS VNP10_NRT',
};
const CONTINGENCY_PRODUCTS = new Set(['amsr2-snow', 'amsr2-sea-ice']);
const PREFERRED_GLOBAL_PRODUCTS = new Set(['gmasi-snow', 'gmasi-sea-ice']);

const utcDay = value => value.slice(0, 10);

function candidateFrom(entry) {
  if (typeof entry?.arrayPath !== 'string' || entry.arrayPath.trim() === '') {
    throw new Error(`Cryosphere adapter product ${entry?.product ?? 'unknown'} is missing its arrayPath`);
  }
  if (entry.product === 'viirs-snow' && (typeof entry.qualityArrayPath !== 'string' || entry.qualityArrayPath.trim() === '')) {
    throw new Error('A VIIRS snow refinement requires its quality array');
  }
  return {
    product: entry.product,
    validAt: entry.validAt,
    producedAt: entry.producedAt,
    version: entry.version,
    href: `./${entry.arrayPath.replace(/^\.?\//, '')}`,
    coverage: entry.coverage,
    ...(entry.qualityArrayPath ? { qualityHref: `./${entry.qualityArrayPath.replace(/^\.?\//, '')}` } : {}),
    attribution: entry.attribution ?? ATTRIBUTION[entry.product],
  };
}

export function buildCryosphereCatalog({ products, retrievedAt }) {
  if (!Array.isArray(products) || products.length === 0) throw new Error('A cryosphere catalog requires provider adapter products');
  const candidates = products.map(candidateFrom);
  // Validate every claim against the same selector the publisher runs, before any exclusion decision.
  selectDailyCryosphere({ candidates, retrievedAt });

  const preferredDay = candidates
    .filter(candidate => PREFERRED_GLOBAL_PRODUCTS.has(candidate.product))
    .map(candidate => utcDay(candidate.validAt))
    .sort()
    .at(-1);
  const excluded = [];
  const retained = candidates.filter(candidate => {
    if (!CONTINGENCY_PRODUCTS.has(candidate.product)) return true;
    if (preferredDay === undefined || utcDay(candidate.validAt) >= preferredDay) return true;
    excluded.push({
      product: candidate.product,
      validAt: candidate.validAt,
      reason: `${candidate.product} for ${utcDay(candidate.validAt)} is older than the current ${preferredDay} GMASI analysis and must not be presented as contemporary`,
    });
    return false;
  });

  const selection = selectDailyCryosphere({ candidates: retained, retrievedAt });
  const contingency = CONTINGENCY_PRODUCTS.has(selection.analysis.globalFallback.snow.product) ? 'amsr2' : undefined;
  return {
    schemaVersion: 1,
    retrievedAt,
    candidates: retained,
    excluded,
    selection,
    ...(contingency ? {
      contingency,
      contingencyReason: 'No current GMASI delivery was available; the disclosed NASA/JAXA AMSR2 contingency supplies the global analysis.',
    } : {}),
  };
}
