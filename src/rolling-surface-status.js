import { rollingSurfaceProduct } from './rolling-surface-products.js';

const percent = value => Math.round(value * 100);
const shortDate = value => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function formatRollingSurfaceStatus(rolling) {
  if (!rolling) return undefined;
  if (rolling.coverage.rollingFraction === 0) {
    return 'land seasonal fallback · no accepted contemporary surface observations';
  }
  const products = rolling.sourceProducts.map(product => rollingSurfaceProduct(product).label).join(' + ');
  const ages = rolling.newestPixelAgeDays === rolling.oldestPixelAgeDays
    ? `${rolling.newestPixelAgeDays} d old`
    : `ages ${rolling.newestPixelAgeDays}–${rolling.oldestPixelAgeDays} d`;
  return `land rolling ${products} · observations ${shortDate(rolling.observedFrom)} → ${shortDate(rolling.observedTo)} · ${ages} · ${percent(rolling.coverage.rollingFraction)}% rolling, ${percent(rolling.coverage.updatedFraction)}% refreshed, ${percent(rolling.coverage.baselineFraction)}% seasonal fallback`;
}
