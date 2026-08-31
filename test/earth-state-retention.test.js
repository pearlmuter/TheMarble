import assert from 'node:assert/strict';
import test from 'node:test';
import { isContentAddressedAsset, planEarthStateRetention } from '../src/earth-state-retention.js';

const bundle = (day, options = {}) => ({
  bundleId: options.bundleId ?? `themarble-2026-08-${day}T12-00-00Z-${day}${day}${day}`,
  path: `bundles/2026-08-${day}T12-00-00Z-${day}${day}${day}`,
  publishedAt: `2026-08-${day}T12:00:00Z`,
  assetHrefs: options.assetHrefs ?? [`../../assets/${day.repeat(32)}.png`],
});

const plan = (bundles, options = {}) => planEarthStateRetention({
  bundles,
  assetPaths: options.assetPaths ?? bundles.flatMap(entry => entry.assetHrefs.map(href => href.replace('../../', ''))),
  currentBundleId: options.currentBundleId ?? bundles.at(-1).bundleId,
  now: options.now ?? '2026-08-30T12:00:00Z',
  keepDays: options.keepDays ?? 7,
  minimumBundles: options.minimumBundles ?? 3,
});

test('bundles inside the retention window are kept', () => {
  const bundles = ['26', '27', '28', '29', '30'].map(day => bundle(day));
  const result = plan(bundles);
  assert.deepEqual(result.removeBundles, []);
  assert.equal(result.retainBundles.length, 5);
});

test('bundles beyond the window are removed once the minimum is satisfied', () => {
  const bundles = ['10', '11', '12', '28', '29', '30'].map(day => bundle(day));
  const result = plan(bundles);
  assert.deepEqual(result.removeBundles.map(entry => entry.publishedAt.slice(8, 10)), ['10', '11', '12']);
  assert.deepEqual(result.retainBundles.map(entry => entry.publishedAt.slice(8, 10)), ['28', '29', '30']);
});

test('the newest bundles are always kept even when every one is beyond the window', () => {
  const bundles = ['01', '02', '03', '04', '05'].map(day => bundle(day));
  const result = plan(bundles, { currentBundleId: bundle('05').bundleId });
  assert.deepEqual(result.retainBundles.map(entry => entry.publishedAt.slice(8, 10)), ['03', '04', '05']);
  assert.equal(result.removeBundles.length, 2);
});

test('the currently published bundle is never removed, however old it is', () => {
  const bundles = ['01', '02', '28', '29', '30'].map(day => bundle(day));
  const result = plan(bundles, { currentBundleId: bundle('01').bundleId });
  assert.ok(result.retainBundles.some(entry => entry.bundleId === bundle('01').bundleId));
  assert.ok(!result.removeBundles.some(entry => entry.bundleId === bundle('01').bundleId));
});

test('an asset a retained bundle still references is never removed', () => {
  const shared = [`../../assets/${'ab'.repeat(32)}.png`];
  const bundles = [
    bundle('10', { assetHrefs: shared }),
    bundle('29', { assetHrefs: shared }),
    bundle('30', { assetHrefs: shared }),
    bundle('28', { assetHrefs: shared }),
  ].sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
  const result = plan(bundles, { assetPaths: [`assets/${'ab'.repeat(32)}.png`] });
  assert.deepEqual(result.removeAssets, []);
  assert.deepEqual(result.retainAssets, [`assets/${'ab'.repeat(32)}.png`]);
});

test('an asset no retained bundle references is removed', () => {
  const bundles = ['10', '28', '29', '30'].map(day => bundle(day));
  const result = plan(bundles);
  assert.deepEqual(result.removeAssets, [`assets/${'10'.repeat(32)}.png`]);
  assert.equal(result.retainAssets.length, 3);
});

test('an asset in the store that no bundle at all references is removed as an orphan', () => {
  const bundles = ['28', '29', '30'].map(day => bundle(day));
  const result = plan(bundles, {
    assetPaths: [`assets/${'28'.repeat(32)}.png`, `assets/${'29'.repeat(32)}.png`, `assets/${'30'.repeat(32)}.png`, `assets/${'ff'.repeat(32)}.png`],
  });
  assert.deepEqual(result.removeAssets, [`assets/${'ff'.repeat(32)}.png`]);
});

test('pruning refuses to run when the published bundle is not in the listing', () => {
  const bundles = ['28', '29', '30'].map(day => bundle(day));
  assert.throws(
    () => plan(bundles, { currentBundleId: 'themarble-unknown' }),
    /currently published bundle/i,
  );
});

test('an unreadable publication time is refused rather than treated as ancient', () => {
  // A time that will not parse compares false against any window, so a silent
  // pass would mark every recent bundle removable.
  const bundles = ['28', '29', '30'].map(day => bundle(day));
  bundles[0].publishedAt = '2026-08-28T12-00-00.000Z';
  assert.throws(() => plan(bundles), /unreadable publication time/i);
});

test('a retention plan reports the bytes it would reclaim when sizes are known', () => {
  const bundles = ['10', '28', '29', '30'].map(day => bundle(day));
  const result = planEarthStateRetention({
    bundles,
    assetPaths: bundles.flatMap(entry => entry.assetHrefs.map(href => href.replace('../../', ''))),
    assetSizes: { [`assets/${'10'.repeat(32)}.png`]: 5_000_000 },
    currentBundleId: bundle('30').bundleId,
    now: '2026-08-30T12:00:00Z',
    keepDays: 7,
    minimumBundles: 3,
  });
  assert.equal(result.reclaimedBytes, 5_000_000);
});

test('only the publisher\'s own content-addressed objects are prunable', () => {
  assert.equal(isContentAddressedAsset(`assets/${'ab'.repeat(32)}.png`), true);
  // A site build sharing the bucket must survive a prune.
  assert.equal(isContentAddressedAsset('assets/index-BMeVzQTw.js'), false);
  assert.equal(isContentAddressedAsset('assets/style.css'), false);
  assert.equal(isContentAddressedAsset('index.html'), false);
});

test('an unrecognised object sharing the store is never deleted', () => {
  const bundles = ['28', '29', '30'].map(day => bundle(day));
  const result = plan(bundles, {
    assetPaths: [`assets/${'28'.repeat(32)}.png`, `assets/${'29'.repeat(32)}.png`, `assets/${'30'.repeat(32)}.png`, 'assets/index-BMeVzQTw.js'],
  });
  assert.deepEqual(result.removeAssets, []);
});
