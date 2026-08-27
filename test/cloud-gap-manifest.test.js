import assert from 'node:assert/strict';
import test from 'node:test';
import { addCloudGapCompletion } from '../src/cloud-gap-manifest.js';

const asset = href => ({
  href, mediaType: 'image/png', byteLength: 100, immutable: true,
  checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
});

const layer = (datasetId, href) => ({
  datasetId, units: 'normalized', dimensions: { width: 8, height: 4 }, colorSpace: 'linear',
  channels: { r: 'value' }, textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
  asset: asset(href),
});

function satcorpsBase() {
  const names = ['cloudOpacity', 'cloudDensity', 'cloudPhysics', 'cloudAge'];
  const frames = ['15', '16'].map(hour => ({
    validAt: `2026-08-25T${hour}:00:00Z`, observedFrom: `2026-08-25T${hour}:00:00Z`,
    observedTo: `2026-08-25T${hour}:09:59Z`, producedAt: `2026-08-25T${hour}:30:00Z`,
    retrievedAt: '2026-08-25T16:40:00Z', coverage: { observedFraction: .94, usableFraction: .92, latitudeRange: [-90, 90] },
    layers: Object.fromEntries(names.map(name => [name, { datasetId: 'satcorps', asset: asset(`./${name}-${hour}.png`) }])),
  }));
  return {
    bundleId: 'satcorps-base', classification: 'observed',
    datasets: [{ id: 'satcorps', version: 'gcc-v2', attribution: 'NASA SatCORPS' }],
    layers: Object.fromEntries(names.map(name => [name, layer('satcorps', `./${name}-16.png`)])),
    cloudSequence: { provider: 'satcorps', interpolation: 'crossfade', transitionSeconds: 300, frames },
    times: {}, resources: {},
  };
}

const completed = (validAt, suffix, forecastHour) => ({
  validAt,
  metadata: {
    coverage: {
      observedFraction: .78, primaryObservedFraction: .68, polarObservedFraction: .1,
      modelAssistedFraction: .2, fallbackFraction: .02, latitudeRange: [-90, 90],
    },
    staticFallback: 'Bundled climatological clouds fill the final rejected pixels.',
  },
  selection: {
    retrievedAt: '2026-08-25T16:45:00Z',
    polarObservation: {
      product: 'viirs-cloud', version: 'v2',
      observedFrom: new Date(Date.parse(validAt) - 25 * 60 * 1000).toISOString(),
      observedTo: new Date(Date.parse(validAt) - 5 * 60 * 1000).toISOString(),
      producedAt: new Date(Date.parse(validAt) + 20 * 60 * 1000).toISOString(),
    },
    model: { product: 'gfs-total-cloud', version: '0p25-v16', runAt: '2026-08-25T12:00:00Z', forecastHour },
  },
  assets: {
    cloudOpacity: asset(`./completed-opacity-${suffix}.png`),
    cloudDensity: asset(`./completed-density-${suffix}.png`),
    cloudProvenance: asset(`./completed-provenance-${suffix}.png`),
  },
});

test('gap completion replaces visual clouds atomically while preserving SatCORPS physical fields', () => {
  const base = satcorpsBase();
  const manifest = addCloudGapCompletion(base, {
    thresholds: { maxObservationAgeSeconds: 10_800, minObservationQuality: .72, seamBlendPixels: 3 },
    completedFrames: [
      completed('2026-08-25T15:00:00Z', '15', 3),
      completed('2026-08-25T16:00:00Z', '16', 4),
    ],
  });

  assert.equal(manifest.classification, 'model-assisted');
  assert.equal(manifest.cloudSequence.provider, 'satcorps');
  assert.equal(manifest.cloudSequence.gapCompletion.maxObservationAgeSeconds, 10_800);
  assert.deepEqual(manifest.layers.cloudPhysics, base.layers.cloudPhysics);
  assert.deepEqual(manifest.layers.cloudAge, base.layers.cloudAge);
  assert.equal(manifest.cloudSequence.frames[1].coverage.modelAssistedFraction, .2);
  assert.equal(manifest.cloudSequence.frames[1].coverage.usableFraction, .92);
  assert.equal(manifest.cloudSequence.frames[1].assistance.model.forecastHour, 4);
  assert.deepEqual(manifest.layers.cloudProvenance.asset, manifest.cloudSequence.frames[1].layers.cloudProvenance.asset);
  assert.deepEqual(manifest.layers.cloudOpacity.asset, manifest.cloudSequence.frames[1].layers.cloudOpacity.asset);
  assert.match(manifest.datasets.at(-1).attribution, /SatCORPS.*VIIRS.*GFS/);
});

test('selected assistance is not claimed when it contributes no pixels', () => {
  const base = satcorpsBase();
  const frames = [
    completed('2026-08-25T15:00:00Z', '15', 3),
    completed('2026-08-25T16:00:00Z', '16', 4),
  ];
  for (const frame of frames) {
    frame.metadata.coverage = {
      observedFraction: 1,
      primaryObservedFraction: 1,
      polarObservedFraction: 0,
      modelAssistedFraction: 0,
      fallbackFraction: 0,
      latitudeRange: [-90, 90],
    };
  }

  const manifest = addCloudGapCompletion(base, {
    thresholds: { maxObservationAgeSeconds: 10_800, minObservationQuality: .72, seamBlendPixels: 3 },
    completedFrames: frames,
  });

  assert.equal(manifest.classification, 'observed');
  assert.equal(manifest.cloudSequence.frames[1].assistance.model, undefined);
  assert.equal(manifest.cloudSequence.frames[1].assistance.staticFallback, undefined);
  assert.doesNotMatch(manifest.datasets.at(-1).attribution, /GFS|static fallback/);
});
