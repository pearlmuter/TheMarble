const DAY_MS = 24 * 60 * 60 * 1000;

const assetPathOf = href => href.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');

/**
 * Decide which published bundles and content-addressed assets a store may drop.
 *
 * The store is append-only, so without pruning it grows for as long as the feed
 * runs. Three rules keep that safe: the bundle a client is being pointed at is
 * never removed, a minimum number of recent bundles survives however old they
 * are, and an asset is removed only when no retained bundle still names it.
 */
export function planEarthStateRetention({
  bundles,
  assetPaths,
  assetSizes,
  currentBundleId,
  now,
  keepDays = 7,
  minimumBundles = 3,
}) {
  if (!Array.isArray(bundles) || !Array.isArray(assetPaths)) {
    throw new Error('Earth-state retention requires the published bundles and asset paths');
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) throw new Error(`Invalid Earth-state retention time: ${now}`);
  if (!bundles.some(bundle => bundle.bundleId === currentBundleId)) {
    throw new Error(`The currently published bundle ${currentBundleId} is not in the store listing; refusing to prune`);
  }

  for (const bundle of bundles) {
    if (Number.isNaN(Date.parse(bundle.publishedAt))) {
      throw new Error(`Bundle ${bundle.bundleId} has an unreadable publication time (${bundle.publishedAt}); refusing to prune`);
    }
  }
  const ordered = [...bundles].sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
  const cutoff = nowMs - keepDays * DAY_MS;
  const newest = new Set(ordered.slice(-Math.max(1, minimumBundles)).map(bundle => bundle.bundleId));
  const retainBundles = ordered.filter(bundle => bundle.bundleId === currentBundleId
    || newest.has(bundle.bundleId)
    || Date.parse(bundle.publishedAt) >= cutoff);
  const retainedIds = new Set(retainBundles.map(bundle => bundle.bundleId));
  const removeBundles = ordered.filter(bundle => !retainedIds.has(bundle.bundleId));

  const referenced = new Set(retainBundles.flatMap(bundle => bundle.assetHrefs.map(assetPathOf)));
  const retainAssets = assetPaths.filter(path => referenced.has(path));
  const removeAssets = assetPaths.filter(path => !referenced.has(path));
  const reclaimedBytes = removeAssets.reduce((total, path) => total + (assetSizes?.[path] ?? 0), 0);

  return { retainBundles, removeBundles, retainAssets, removeAssets, reclaimedBytes };
}
