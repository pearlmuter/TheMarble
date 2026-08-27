import assert from 'node:assert/strict';
import test from 'node:test';
import { addSatcorpsCloudSequence } from '../src/satcorps-manifest.js';

const asset = href => ({
  href, mediaType: 'image/png', byteLength: 100, immutable: true,
  checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
});

const selectedFrame = (validAt, suffix) => ({
  provider: 'satcorps', validAt, observedFrom: validAt,
  observedTo: new Date(Date.parse(validAt) + 10 * 60 * 1000).toISOString(),
  producedAt: new Date(Date.parse(validAt) + 25 * 60 * 1000).toISOString(),
  retrievedAt: '2026-08-25T16:00:00Z', version: 'gcc-v2',
  coverage: { observedFraction: .97 }, quality: { usableFraction: .94 },
  assets: { manifest: `https://fixtures.test/${suffix}.nc` },
});

const composed = (frame, suffix) => ({
  metadata: {
    observedFrom: frame.observedFrom, observedTo: frame.observedTo,
    producedAt: frame.producedAt, version: frame.version,
    dimensions: { width: 4096, height: 2048 },
    coverage: { observedFraction: .97, latitudeRange: [-90, 90] },
    quality: { usableFraction: .94 },
  },
  assets: {
    cloudOpacity: asset(`./cloud-opacity-${suffix}.png`),
    cloudDensity: asset(`./cloud-density-${suffix}.png`),
    cloudPhysics: asset(`./cloud-physics-${suffix}.png`),
    cloudAge: asset(`./cloud-age-${suffix}.png`),
  },
});

test('two composed SatCORPS frames replace clouds atomically while preserving unrelated Earth state', () => {
  const frames = [
    selectedFrame('2026-08-25T15:00:00Z', '1500'),
    selectedFrame('2026-08-25T16:00:00Z', '1600'),
  ];
  const base = {
    bundleId: 'prior', classification: 'observed',
    times: {}, datasets: [{ id: 'surface', version: 'v1', attribution: 'surface' }],
    layers: { surfaceAlbedo: { datasetId: 'surface' }, snowCover: { datasetId: 'snow' } },
    resources: { starCatalog: { datasetId: 'sky' } },
  };

  const manifest = addSatcorpsCloudSequence(base, {
    selection: { provider: 'satcorps', retrievedAt: '2026-08-25T16:00:00Z', frames },
    composedFrames: [composed(frames[0], '1500'), composed(frames[1], '1600')],
  });

  assert.deepEqual(manifest.layers.surfaceAlbedo, base.layers.surfaceAlbedo);
  assert.deepEqual(manifest.layers.snowCover, base.layers.snowCover);
  assert.deepEqual(manifest.resources.starCatalog, base.resources.starCatalog);
  assert.equal(manifest.cloudSequence.provider, 'satcorps');
  assert.equal(manifest.cloudSequence.frames[1].validAt, '2026-08-25T16:00:00Z');
  assert.equal(manifest.cloudSequence.frames[1].coverage.usableFraction, .94);
  for (const name of ['cloudOpacity', 'cloudDensity', 'cloudPhysics', 'cloudAge']) {
    assert.deepEqual(manifest.layers[name].asset, manifest.cloudSequence.frames[1].layers[name].asset);
  }
  assert.equal(manifest.times.observedFrom, frames[0].observedFrom);
  assert.equal(manifest.times.observedTo, frames[1].observedTo);
});

test('GMGSI to SatCORPS replacement removes the superseded cloud dataset for safe provider round trips', () => {
  const frames = [
    selectedFrame('2026-08-25T15:00:00Z', '1500'),
    selectedFrame('2026-08-25T16:00:00Z', '1600'),
  ];
  const oldCloud = { datasetId: 'noaa-gmgsi-v1', asset: asset('./old.png') };
  const base = {
    bundleId: 'gmgsi', classification: 'observed', times: {}, resources: {},
    datasets: [
      { id: 'surface', version: 'v1', attribution: 'surface' },
      { id: 'noaa-gmgsi-v1', version: 'v1', attribution: 'GMGSI' },
    ],
    layers: { surfaceAlbedo: { datasetId: 'surface' }, cloudOpacity: oldCloud, cloudDensity: oldCloud },
  };
  const manifest = addSatcorpsCloudSequence(base, {
    selection: { provider: 'satcorps', retrievedAt: '2026-08-25T16:00:00Z', frames },
    composedFrames: [composed(frames[0], '1500'), composed(frames[1], '1600')],
  });
  const ids = manifest.datasets.map(dataset => dataset.id);
  assert.ok(!ids.includes('noaa-gmgsi-v1'));
  assert.equal(new Set(ids).size, ids.length);
});

test('manifest construction rejects compositor provenance that disagrees with provider selection', () => {
  const frames = [
    selectedFrame('2026-08-25T15:00:00Z', '1500'),
    selectedFrame('2026-08-25T16:00:00Z', '1600'),
  ];
  const outputs = [composed(frames[0], '1500'), composed(frames[1], '1600')];
  outputs[1].metadata.version = 'silently-changed';

  assert.throws(() => addSatcorpsCloudSequence({ layers: {}, datasets: [] }, {
    selection: { provider: 'satcorps', retrievedAt: '2026-08-25T16:00:00Z', frames },
    composedFrames: outputs,
  }), /version disagrees/i);
});

test('manifest construction rejects catalog quality that is not borne out by composed pixels', () => {
  const frames = [
    selectedFrame('2026-08-25T15:00:00Z', '1500'),
    selectedFrame('2026-08-25T16:00:00Z', '1600'),
  ];
  const outputs = [composed(frames[0], '1500'), composed(frames[1], '1600')];
  outputs[1].metadata.quality.usableFraction = .71;

  assert.throws(() => addSatcorpsCloudSequence({ layers: {}, datasets: [] }, {
    selection: { provider: 'satcorps', retrievedAt: '2026-08-25T16:00:00Z', frames },
    composedFrames: outputs,
  }), /quality disagrees/i);
});
