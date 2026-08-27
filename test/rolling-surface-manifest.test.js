import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateEarthStateManifest } from '../src/earth-state.js';
import { withRollingSurfaceUpdate } from '../src/rolling-surface-manifest.js';

const bundled = JSON.parse(await readFile(new URL('../public/earth-state/bundled-v1.json', import.meta.url), 'utf8'));

function asset(href, mediaType = 'image/png') {
  return { ...bundled.layers.cloudOpacity.asset, href, mediaType };
}

function update(overrides = {}) {
  return {
    dataset: {
      id: 'rolling-land-2026-08-27',
      version: 'MCD43A4.061+VNP09GA.002',
      attribution: 'NASA LP DAAC MODIS and VIIRS; modified rolling clear-surface composite',
    },
    surfaceAsset: asset('./rolling-surface.png'),
    ageAsset: asset('./rolling-surface-age.png'),
    validAt: '2026-08-27T12:00:00Z',
    observedFrom: '2026-08-12T00:00:00Z',
    observedTo: '2026-08-26T23:59:59Z',
    producedAt: '2026-08-27T06:30:00Z',
    retrievedAt: '2026-08-27T07:00:00Z',
    coverage: { rollingFraction: 0.73, updatedFraction: 0.08, baselineFraction: 0.27 },
    oldestPixelAgeDays: 41,
    newestPixelAgeDays: 1,
    sourceProducts: ['mcd43a4-nbar', 'viirs-surface-reflectance'],
    observationWindows: [
      { index: 1, product: 'mcd43a4-nbar', version: 'MCD43A4.061', validAt: '2026-08-24T12:00:00Z', observedFrom: '2026-08-12T00:00:00Z', observedTo: '2026-08-26T23:59:59Z' },
      { index: 2, product: 'viirs-surface-reflectance', version: 'VNP09GA.002', validAt: '2026-08-26T12:00:00Z', observedFrom: '2026-08-26T00:00:00Z', observedTo: '2026-08-26T23:59:59Z' },
    ],
    normalization: { method: 'robust-channel-gain-and-delta-limit', maxDailyChange: 0.12 },
    ...overrides,
  };
}

test('adds an auditable rolling surface while preserving every seasonal fallback frame', () => {
  const manifest = withRollingSurfaceUpdate(structuredClone(bundled), update());

  validateEarthStateManifest(manifest);
  assert.equal(manifest.classification, 'observed');
  assert.equal(manifest.layers.surfaceAlbedo.asset.href, './rolling-surface.png');
  assert.equal(manifest.layers.surfaceAlbedo.seasonalCycle.frames.length, 12);
  assert.notEqual(manifest.layers.surfaceAlbedo.seasonalCycle.frames[0].asset.href, manifest.layers.surfaceAlbedo.asset.href);
  assert.equal(manifest.layers.surfaceAge.channels.rg, 'uint16 age in whole days; 65535 means seasonal baseline');
  assert.equal(manifest.layers.surfaceAge.channels.ba, 'uint16 observation-window index; 0 means seasonal baseline');
  assert.equal(manifest.layers.surfaceAlbedo.rollingComposite.observationWindows[0].index, 1);
  assert.equal(manifest.layers.surfaceAlbedo.rollingComposite.coverage.baselineFraction, 0.27);
});

test('a no-observation publication stays explicitly static instead of claiming freshness', () => {
  const manifest = withRollingSurfaceUpdate(structuredClone(bundled), update({
    coverage: { rollingFraction: 0, updatedFraction: 0, baselineFraction: 1 },
    oldestPixelAgeDays: null,
    newestPixelAgeDays: null,
    sourceProducts: [],
    observationWindows: [],
  }));

  validateEarthStateManifest(manifest);
  assert.equal(manifest.classification, 'static-fallback');
  assert.deepEqual(manifest.layers.surfaceAlbedo.rollingComposite.sourceProducts, []);
});

test('rejects a rolling surface without its paired per-pixel age and provenance layer', () => {
  const manifest = withRollingSurfaceUpdate(structuredClone(bundled), update());
  delete manifest.layers.surfaceAge;

  assert.throws(() => validateEarthStateManifest(manifest), /layers\.surfaceAge/);
});
