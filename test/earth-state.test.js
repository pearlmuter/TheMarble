import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadEarthStateJsonDocument } from '../src/earth-state-document.js';
import { createEarthStateActivator } from '../src/earth-state.js';

const fixtureBytes = new TextEncoder().encode('fixture asset');
const checksum = 'dc9905c9a7e70f6485604c96e9a3ff0f5fc0b8ae936ef644a6ae31afbc10acd4';
const loaded = value => ({ value, bytes: fixtureBytes });
const jsonDocumentFixture = value => ({ value, bytes: new TextEncoder().encode(JSON.stringify(value)), mediaType: 'application/json' });

function latestPointerForBytes(bundleId, href, manifestBytes) {
  return {
    schemaVersion: 1,
    bundleId,
    manifest: {
      href,
      mediaType: 'application/json',
      byteLength: manifestBytes.byteLength,
      immutable: true,
      checksum: { algorithm: 'sha256', value: createHash('sha256').update(manifestBytes).digest('hex') },
    },
  };
}

function latestPointerFixture(manifest, href) {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return { manifestBytes, latest: latestPointerForBytes(manifest.bundleId, href, manifestBytes) };
}

function fixtureManifest() {
  const textureDescriptor = (href, datasetId = 'earth') => ({
    datasetId,
    units: 'display-referred reflectance',
    dimensions: { width: 4, height: 2 },
    colorSpace: 'srgb',
    channels: { rgb: 'color', a: 'opacity' },
    textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
    asset: { href, mediaType: 'image/png', byteLength: fixtureBytes.byteLength, immutable: true, checksum: { algorithm: 'sha256', value: checksum } },
  });

  return {
    schemaVersion: 1,
    bundleId: 'fixture-2026-08-25T00:00:00Z',
    classification: 'static-fallback',
    geographicConvention: {
      crs: 'EPSG:4326',
      projection: 'equirectangular',
      longitudeRange: [-180, 180],
      latitudeRange: [-90, 90],
      northAtTop: true,
      seamLongitude: -180,
    },
    times: {
      observedFrom: '2004-01-01T00:00:00Z',
      observedTo: '2004-01-31T23:59:59Z',
      validAt: '2026-08-25T00:00:00Z',
      producedAt: '2026-08-25T00:00:00Z',
      retrievedAt: '2026-08-25T00:00:00Z',
    },
    datasets: [
      { id: 'earth', version: 'fixture-1', attribution: 'Fixture Earth data' },
      { id: 'sky', version: 'fixture-1', attribution: 'Fixture sky data' },
    ],
    layers: {
      surfaceAlbedo: textureDescriptor('./surface.png'),
      nightLights: textureDescriptor('./lights.png'),
      cloudOpacity: textureDescriptor('./clouds.png'),
      cloudDensity: textureDescriptor('./cloud-density.json'),
    },
    resources: {
      moonAlbedo: { ...textureDescriptor('./moon.png', 'sky'), semantics: 'lunar albedo texture' },
      milkyWay: { ...textureDescriptor('./milky-way.jpg', 'sky'), semantics: 'equatorial all-sky panorama' },
      starCatalog: {
        datasetId: 'sky',
        semantics: 'equatorial star catalogue',
        asset: { href: './stars.json', mediaType: 'application/json', byteLength: fixtureBytes.byteLength, immutable: true, checksum: { algorithm: 'sha256', value: checksum } },
      },
    },
  };
}

function addHourlyCloudSequence(manifest) {
  const frame = (hour, suffix, producedMinute, observedFraction) => ({
    validAt: `2026-08-25T${hour}:00:00Z`,
    observedFrom: `2026-08-25T${hour}:00:00Z`,
    observedTo: `2026-08-25T${hour}:09:59Z`,
    producedAt: `2026-08-25T${hour}:${producedMinute}:00Z`,
    retrievedAt: `2026-08-25T${hour}:48:00Z`,
    coverage: { observedFraction, latitudeRange: [-72.7, 72.7] },
    layers: {
      cloudOpacity: {
        datasetId: 'earth',
        asset: { ...manifest.layers.cloudOpacity.asset, href: `./clouds-${suffix}.png` },
      },
      cloudDensity: {
        datasetId: 'earth',
        asset: { ...manifest.layers.cloudDensity.asset, href: `./cloud-density-${suffix}.png` },
      },
    },
  });
  const frames = [frame('11', '11', '42', 0.79), frame('12', '12', '43', 0.8)];
  manifest.cloudSequence = { interpolation: 'crossfade', transitionSeconds: 300, frames };
  manifest.layers.cloudOpacity.asset = structuredClone(frames[1].layers.cloudOpacity.asset);
  manifest.layers.cloudDensity.asset = structuredClone(frames[1].layers.cloudDensity.asset);
  manifest.times = {
    observedFrom: frames[0].observedFrom,
    observedTo: frames[1].observedTo,
    validAt: frames[1].validAt,
    producedAt: frames[1].producedAt,
    retrievedAt: frames[1].retrievedAt,
  };
  manifest.classification = 'observed';
  return frames;
}

function addSatcorpsCloudSequence(manifest) {
  const physicalLayer = (href, channels) => ({
    datasetId: 'earth',
    units: 'normalized physical retrieval',
    dimensions: { width: 4, height: 2 },
    colorSpace: 'linear',
    channels,
    textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
    asset: { ...manifest.layers.cloudOpacity.asset, href },
  });
  manifest.layers.cloudPhysics = physicalLayer('./cloud-physics-1300.png', {
    r: 'log optical depth / log(151)', g: 'thermodynamic phase', b: 'effective height / 20 km', a: 'retrieval quality',
  });
  manifest.layers.cloudAge = physicalLayer('./cloud-age-1300.png', { r: 'absolute observation age / 3 hours' });
  const frame = (hour, suffix) => ({
    validAt: `2026-08-25T${hour}:00:00Z`,
    observedFrom: `2026-08-25T${hour}:00:00Z`,
    observedTo: `2026-08-25T${hour}:09:59Z`,
    producedAt: `2026-08-25T${hour}:30:00Z`,
    retrievedAt: '2026-08-25T13:45:00Z',
    coverage: { observedFraction: .97, latitudeRange: [-90, 90], usableFraction: .94 },
    layers: Object.fromEntries(['cloudOpacity', 'cloudDensity', 'cloudPhysics', 'cloudAge'].map(name => [name, {
      datasetId: 'earth',
      asset: {
        ...manifest.layers[name].asset,
        href: `./${name}-${suffix}.png`,
      },
    }])),
  });
  const frames = [frame('12', '1200'), frame('13', '1300')];
  manifest.cloudSequence = { provider: 'satcorps', interpolation: 'crossfade', transitionSeconds: 300, frames };
  for (const name of ['cloudOpacity', 'cloudDensity', 'cloudPhysics', 'cloudAge']) {
    manifest.layers[name].asset = structuredClone(frames[1].layers[name].asset);
  }
  manifest.times = {
    observedFrom: frames[0].observedFrom,
    observedTo: frames[1].observedTo,
    validAt: frames[1].validAt,
    producedAt: frames[1].producedAt,
    retrievedAt: frames[1].retrievedAt,
  };
  manifest.classification = 'observed';
  return frames;
}

function addCloudGapCompletion(manifest) {
  const frames = addHourlyCloudSequence(manifest);
  manifest.layers.cloudProvenance = {
    ...manifest.layers.cloudDensity,
    colorSpace: 'linear',
    channels: { r: 'source class', g: 'observation age', b: 'source quality', a: 'native contribution' },
    asset: { ...manifest.layers.cloudDensity.asset, href: './cloud-provenance-12.png' },
  };
  manifest.cloudSequence.gapCompletion = {
    maxObservationAgeSeconds: 10_800,
    minObservationQuality: .72,
    seamBlendPixels: 3,
  };
  for (const [index, frame] of frames.entries()) {
    const polarObservedTo = new Date(Date.parse(frame.validAt) - 4 * 60 * 1000).toISOString();
    const polarObservedFrom = new Date(Date.parse(polarObservedTo) - 16 * 60 * 1000).toISOString();
    frame.coverage = {
      observedFraction: index === 0 ? .72 : .75,
      primaryObservedFraction: index === 0 ? .64 : .67,
      polarObservedFraction: .08,
      modelAssistedFraction: .2,
      fallbackFraction: index === 0 ? .08 : .05,
      latitudeRange: [-90, 90],
    };
    frame.assistance = {
      polarObservation: {
        product: 'viirs-cloud', version: 'v2',
        observedFrom: polarObservedFrom, observedTo: polarObservedTo,
      },
      model: { product: 'gfs-total-cloud', version: '0p25-v16', runAt: '2026-08-25T06:00:00Z', forecastHour: index + 5 },
      staticFallback: 'Bundled climatological cloud texture fills the final rejected pixels.',
    };
    frame.layers.cloudProvenance = {
      datasetId: 'earth',
      asset: { ...manifest.layers.cloudProvenance.asset, href: `./cloud-provenance-${index === 0 ? '11' : '12'}.png` },
    };
  }
  manifest.layers.cloudProvenance.asset = structuredClone(frames[1].layers.cloudProvenance.asset);
  manifest.classification = 'model-assisted';
  return frames;
}

function addDailyCryosphere(manifest) {
  const textureDescriptor = href => ({
    datasetId: 'cryosphere',
    units: 'fraction',
    dimensions: { width: 4, height: 2 },
    colorSpace: 'linear',
    channels: { r: 'fraction', g: 'confidence', b: 'source code' },
    textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
    asset: { href, mediaType: 'image/png', byteLength: fixtureBytes.byteLength, immutable: true, checksum: { algorithm: 'sha256', value: checksum } },
    provenance: {
      validAt: '2026-08-25T00:00:00Z',
      producedAt: '2026-08-25T18:00:00Z',
      retrievedAt: '2026-08-26T03:00:00Z',
      sourceVersion: 'IMS v3 + AMSR2 L3 + VNP10_NRT V2',
      coverage: { observedFraction: 0.96, latitudeRange: [-90, 90], fallbackFraction: 0.5 },
      fallback: 'AMSR2 fills the Southern Hemisphere and any missing IMS coverage.',
      attribution: 'USNIC IMS; NASA/JAXA AMSR2; NASA VIIRS, modified by TheMarble',
    },
  });
  manifest.datasets.push({ id: 'cryosphere', version: '2026-08-25', attribution: 'USNIC IMS; NASA/JAXA AMSR2; NASA VIIRS' });
  manifest.layers.snowCover = textureDescriptor('./snow.png');
  manifest.layers.seaIce = textureDescriptor('./sea-ice.png');
}

test('a complete Earth-state manifest activates one coherent scene asset set', async () => {
  const manifest = fixtureManifest();
  const loadedUrls = [];
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ url }) => {
      loadedUrls.push(url);
      return loaded(`loaded:${url}`);
    },
  });

  const activated = await activator.activate('https://example.test/states/fixture/manifest.json');

  assert.equal(activated.manifest.bundleId, 'fixture-2026-08-25T00:00:00Z');
  assert.equal(activated.layers.surfaceAlbedo, 'loaded:https://example.test/states/fixture/surface.png');
  assert.equal(activated.resources.starCatalog, 'loaded:https://example.test/states/fixture/stars.json');
  assert.equal(activated.layerDatasets.surfaceAlbedo.version, 'fixture-1');
  assert.equal(loadedUrls.length, 7);
  assert.equal(activator.current, activated);
});

test('a presentation manifest must match its tier index reference before any asset loads', async () => {
  const manifest = fixtureManifest();
  const document = jsonDocumentFixture(manifest);
  let assetLoads = 0;
  const activator = createEarthStateActivator({
    loadDocument: async () => document,
    loadAsset: async () => {
      assetLoads += 1;
      return loaded('not reached');
    },
  });
  const reference = {
    href: './manifest.json', mediaType: 'application/json', byteLength: document.bytes.byteLength,
    immutable: true, checksum: { algorithm: 'sha256', value: '0'.repeat(64) },
  };

  await assert.rejects(
    activator.activate('https://example.test/presentations/8k/manifest.json', reference),
    /checksum mismatch for presentation\.manifest/,
  );

  assert.equal(assetLoads, 0);
  assert.equal(activator.current, undefined);
});

test('an hourly cloud sequence activates two complete observation states with truthful windows', async () => {
  const manifest = fixtureManifest();
  addHourlyCloudSequence(manifest);
  const loadedUrls = [];
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ url }) => {
      loadedUrls.push(url);
      return loaded(`loaded:${url}`);
    },
  });

  const activated = await activator.activate('https://example.test/states/clouds/manifest.json');

  assert.deepEqual(
    activated.cloudSequence.frames.map(frame => [frame.validAt, frame.observedFrom, frame.observedTo]),
    [
      ['2026-08-25T11:00:00Z', '2026-08-25T11:00:00Z', '2026-08-25T11:09:59Z'],
      ['2026-08-25T12:00:00Z', '2026-08-25T12:00:00Z', '2026-08-25T12:09:59Z'],
    ],
  );
  assert.match(activated.cloudSequence.frames[0].layers.cloudOpacity, /clouds-11\.png$/);
  assert.equal(activated.cloudSequence.frames[1].layers.cloudOpacity, activated.layers.cloudOpacity);
  assert.equal(activated.cloudSequence.frames[1].layers.cloudDensity, activated.layers.cloudDensity);
  assert.equal(loadedUrls.length, 9);
});

test('a SatCORPS sequence activates all physical fields as one coherent hourly observation pair', async () => {
  const manifest = fixtureManifest();
  addSatcorpsCloudSequence(manifest);
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ url }) => loaded(`loaded:${url}`),
  });

  const activated = await activator.activate('https://example.test/states/satcorps/manifest.json');

  assert.equal(activated.cloudSequence.provider, 'satcorps');
  assert.deepEqual(activated.cloudSequence.frames.map(frame => frame.validAt), [
    '2026-08-25T12:00:00Z', '2026-08-25T13:00:00Z',
  ]);
  for (const name of ['cloudOpacity', 'cloudDensity', 'cloudPhysics', 'cloudAge']) {
    assert.match(activated.cloudSequence.frames[0].layers[name], new RegExp(`${name}-1200\\.png$`));
    assert.equal(activated.cloudSequence.frames[1].layers[name], activated.layers[name]);
  }
});

test('gap-completed clouds activate provenance and assistance metadata as one coherent pair', async () => {
  const manifest = fixtureManifest();
  addCloudGapCompletion(manifest);
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ url }) => loaded(`loaded:${url}`),
  });

  const activated = await activator.activate('https://example.test/states/gap-completed/manifest.json');

  assert.equal(activated.manifest.classification, 'model-assisted');
  assert.equal(activated.cloudSequence.gapCompletion.maxObservationAgeSeconds, 10_800);
  assert.equal(activated.cloudSequence.frames[1].coverage.observedFraction, .75);
  assert.equal(activated.cloudSequence.frames[1].coverage.modelAssistedFraction, .2);
  assert.equal(activated.cloudSequence.frames[1].coverage.fallbackFraction, .05);
  assert.equal(activated.cloudSequence.frames[1].assistance.model.forecastHour, 6);
  assert.match(activated.cloudSequence.frames[0].layers.cloudProvenance, /cloud-provenance-11\.png$/);
  assert.equal(activated.cloudSequence.frames[1].layers.cloudProvenance, activated.layers.cloudProvenance);
});

test('gap completion rejects unclassified area, missing provenance, or undisclosed model assistance', async () => {
  const cases = [
    ['cloudSequence.frames.1.coverage', manifest => { manifest.cloudSequence.frames[1].coverage.fallbackFraction = .04; }],
    ['cloudSequence.frames.0.layers.cloudProvenance', manifest => { delete manifest.cloudSequence.frames[0].layers.cloudProvenance; }],
    ['cloudSequence.frames.1.assistance.model', manifest => { delete manifest.cloudSequence.frames[1].assistance.model; }],
  ];

  for (const [expectedPath, mutate] of cases) {
    const manifest = fixtureManifest();
    addCloudGapCompletion(manifest);
    mutate(manifest);
    const activator = createEarthStateActivator({
      loadDocument: async () => jsonDocumentFixture(manifest),
      loadAsset: async () => loaded('unused'),
    });

    await assert.rejects(
      activator.activate('https://example.test/states/invalid-gap/manifest.json'),
      new RegExp(expectedPath.replaceAll('.', '\\.')),
    );
  }
});

test('a physical cloud observation is rejected atomically when one field is absent or unpaired', async () => {
  for (const mutate of [
    manifest => { delete manifest.layers.cloudAge; },
    manifest => { delete manifest.cloudSequence.frames[0].layers.cloudPhysics; },
    manifest => { manifest.cloudSequence.frames[1].coverage.usableFraction = .69; },
  ]) {
    const manifest = fixtureManifest();
    addSatcorpsCloudSequence(manifest);
    mutate(manifest);
    let loads = 0;
    const activator = createEarthStateActivator({
      loadDocument: async () => jsonDocumentFixture(manifest),
      loadAsset: async () => { loads += 1; return loaded('unused'); },
    });
    await assert.rejects(() => activator.activate('https://example.test/states/satcorps/manifest.json'), /cloudAge|cloudPhysics|usableFraction/);
    assert.equal(loads, 0);
  }
});

test('daily snow cover and sea ice activate as distinct layers with explicit provenance', async () => {
  const manifest = fixtureManifest();
  addDailyCryosphere(manifest);
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ url }) => loaded(`loaded:${url}`),
  });

  const activated = await activator.activate('https://example.test/states/fixture/manifest.json');

  assert.match(activated.layers.snowCover, /snow\.png$/);
  assert.match(activated.layers.seaIce, /sea-ice\.png$/);
  assert.equal(activated.manifest.layers.snowCover.provenance.coverage.fallbackFraction, 0.5);
  assert.match(activated.manifest.layers.seaIce.provenance.attribution, /AMSR2/);
});

test('a cryosphere update is atomic and rejects a missing paired layer or dishonest coverage', async () => {
  for (const mutate of [
    manifest => { delete manifest.layers.seaIce; },
    manifest => { manifest.layers.snowCover.provenance.coverage.fallbackFraction = 1.01; },
  ]) {
    const manifest = fixtureManifest();
    addDailyCryosphere(manifest);
    mutate(manifest);
    const activator = createEarthStateActivator({
      loadDocument: async () => jsonDocumentFixture(manifest),
      loadAsset: async () => loaded('unused'),
    });
    await assert.rejects(() => activator.activate('https://example.test/manifest.json'), /snowCover|seaIce|fallbackFraction/);
  }
});

test('a cloud sequence rejects broken cadence, coverage, pairing, or bounding provenance', async () => {
  const cases = [
    ['cloudSequence.frames.1.validAt', manifest => {
      const frame = manifest.cloudSequence.frames[1];
      frame.validAt = '2026-08-25T13:00:00Z';
      frame.observedFrom = '2026-08-25T13:00:00Z';
      frame.observedTo = '2026-08-25T13:09:59Z';
      frame.producedAt = '2026-08-25T13:43:00Z';
      frame.retrievedAt = '2026-08-25T13:48:00Z';
      Object.assign(manifest.times, {
        observedTo: frame.observedTo,
        validAt: frame.validAt,
        producedAt: frame.producedAt,
        retrievedAt: frame.retrievedAt,
      });
    }],
    ['cloudSequence.frames.0.coverage', manifest => { manifest.cloudSequence.frames[0].coverage.observedFraction = 1.01; }],
    ['cloudSequence.frames.1.layers.cloudOpacity.asset', manifest => { manifest.layers.cloudOpacity.asset.href = './different.png'; }],
    ['times.observedFrom', manifest => { manifest.times.observedFrom = '2026-08-25T10:00:00Z'; }],
    ['times.validAt', manifest => { manifest.times.validAt = '2026-08-25T11:00:00Z'; }],
  ];

  for (const [expectedPath, mutate] of cases) {
    const manifest = fixtureManifest();
    addHourlyCloudSequence(manifest);
    mutate(manifest);
    let loads = 0;
    const activator = createEarthStateActivator({
      loadDocument: async () => jsonDocumentFixture(manifest),
      loadAsset: async () => { loads += 1; return loaded(undefined); },
    });

    await assert.rejects(
      activator.activate('https://example.test/states/invalid/manifest.json'),
      new RegExp(expectedPath.replaceAll('.', '\\.')),
    );
    assert.equal(loads, 0);
  }
});

test('a seasonal surface contract activates all 12 immutable monthly states coherently', async () => {
  const manifest = fixtureManifest();
  manifest.layers.surfaceAlbedo.seasonalCycle = {
    interpolation: 'linear',
    frames: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      datasetId: 'earth',
      asset: index === 0
        ? manifest.layers.surfaceAlbedo.asset
        : { ...manifest.layers.surfaceAlbedo.asset, href: `./surface-${String(index + 1).padStart(2, '0')}.png` },
    })),
  };
  const loadedUrls = [];
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ url }) => {
      loadedUrls.push(url);
      return loaded(`loaded:${url}`);
    },
  });

  const activated = await activator.activate('https://example.test/states/fixture/manifest.json');

  assert.equal(activated.seasonalLayers.surfaceAlbedo.length, 12);
  assert.deepEqual(
    activated.seasonalLayers.surfaceAlbedo.map(frame => frame.month),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(activated.seasonalLayers.surfaceAlbedo[0].value, activated.layers.surfaceAlbedo);
  assert.match(activated.seasonalLayers.surfaceAlbedo[11].value, /surface-12\.png$/);
  assert.equal(loadedUrls.length, 18);
});

test('a seasonal surface contract rejects a missing or duplicated calendar month', async () => {
  for (const frames of [
    Array.from({ length: 11 }, (_, index) => index + 1),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11],
  ]) {
    const manifest = fixtureManifest();
    manifest.layers.surfaceAlbedo.seasonalCycle = {
      interpolation: 'linear',
      frames: frames.map(month => ({ month, datasetId: 'earth', asset: manifest.layers.surfaceAlbedo.asset })),
    };
    const activator = createEarthStateActivator({
      loadDocument: async () => jsonDocumentFixture(manifest),
      loadAsset: async () => loaded(undefined),
    });

    await assert.rejects(
      activator.activate('https://example.test/states/invalid/manifest.json'),
      /layers\.surfaceAlbedo\.seasonalCycle\.frames/,
    );
  }
});

test('seasonal cycles are rejected on layers the renderer does not consume seasonally', async () => {
  const manifest = fixtureManifest();
  manifest.layers.cloudOpacity.seasonalCycle = {
    interpolation: 'linear',
    frames: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      datasetId: 'earth',
      asset: manifest.layers.cloudOpacity.asset,
    })),
  };
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async () => loaded(undefined),
  });

  await assert.rejects(
    activator.activate('https://example.test/states/invalid/manifest.json'),
    /layers\.cloudOpacity\.seasonalCycle/,
  );
});

test('an incomplete manifest is rejected without replacing the active Earth state', async () => {
  const complete = fixtureManifest();
  const incomplete = fixtureManifest();
  delete incomplete.layers.cloudOpacity;
  let nextManifest = complete;
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(nextManifest),
    loadAsset: async ({ url }) => loaded(`loaded:${url}`),
  });
  const active = await activator.activate('https://example.test/states/current/manifest.json');

  nextManifest = incomplete;

  await assert.rejects(
    activator.activate('https://example.test/states/replacement/manifest.json'),
    /cloudOpacity/,
  );
  assert.equal(activator.current, active);
});

test('an asset-loading failure leaves the previous coherent Earth state active', async () => {
  const manifest = fixtureManifest();
  let failClouds = false;
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ name, url }) => {
      if (failClouds && name === 'cloudOpacity') throw new Error('cloud texture unavailable');
      return loaded(`loaded:${url}`);
    },
  });
  const active = await activator.activate('https://example.test/states/current/manifest.json');

  failClouds = true;

  await assert.rejects(
    activator.activate('https://example.test/states/replacement/manifest.json'),
    /cloud texture unavailable/,
  );
  assert.equal(activator.current, active);
});

test('malformed Earth-state contract metadata is rejected before assets load', async () => {
  const cases = [
    ['schemaVersion', manifest => { manifest.schemaVersion = 2; }],
    ['classification', manifest => { manifest.classification = 'unknown'; }],
    ['geographicConvention.crs', manifest => { manifest.geographicConvention.crs = 'unknown'; }],
    ['times.validAt', manifest => { manifest.times.validAt = 'not-a-time'; }],
    ['datasets.0.version', manifest => { manifest.datasets[0].version = ''; }],
    ['layers.surfaceAlbedo.datasetId', manifest => { manifest.layers.surfaceAlbedo.datasetId = 'missing'; }],
    ['layers.surfaceAlbedo.dimensions', manifest => { manifest.layers.surfaceAlbedo.dimensions.width = 0; }],
    ['layers.surfaceAlbedo.units', manifest => { manifest.layers.surfaceAlbedo.units = ''; }],
    ['resources.starCatalog.semantics', manifest => { manifest.resources.starCatalog.semantics = ''; }],
    ['resources.starCatalog.asset.checksum', manifest => { manifest.resources.starCatalog.asset.checksum.value = 'not-sha256'; }],
    ['resources.starCatalog.asset.immutable', manifest => { manifest.resources.starCatalog.asset.immutable = false; }],
  ];

  for (const [expectedPath, mutate] of cases) {
    const manifest = fixtureManifest();
    mutate(manifest);
    let loads = 0;
    const activator = createEarthStateActivator({
      loadDocument: async () => jsonDocumentFixture(manifest),
      loadAsset: async () => { loads += 1; return loaded(undefined); },
    });

    await assert.rejects(
      activator.activate('https://example.test/states/invalid/manifest.json'),
      new RegExp(expectedPath.replaceAll('.', '\\.')),
    );
    assert.equal(loads, 0);
  }
});

test('the bundled manifest activates every asset required by the current scene', async () => {
  const manifestBytes = await readFile(
    new URL('../public/earth-state/bundled-v1.json', import.meta.url),
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ descriptor, url }) => {
      const bytes = await readFile(new URL(`../public${new URL(url).pathname}`, import.meta.url));
      assert.equal(bytes.byteLength, descriptor.asset.byteLength);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.asset.checksum.value);
      return { value: url, bytes };
    },
  });

  const activated = await activator.activate('https://themarble.local/earth-state/bundled-v1.json');

  assert.equal(activated.manifest.classification, 'static-fallback');
  assert.match(activated.layers.surfaceAlbedo, /bmng-2004-01-5400\.jpg$/);
  assert.equal(activated.seasonalLayers.surfaceAlbedo.length, 12);
  assert.match(activated.seasonalLayers.surfaceAlbedo[11].value, /bmng-2004-12-5400\.jpg$/);
  assert.match(activated.layers.nightLights, /earth-lights-3km\.jpg$/);
  assert.match(activated.layers.cloudOpacity, /fair-clouds-4k\.png$/);
  assert.match(activated.layers.cloudDensity, /cloud-density-static-neutral\.png$/);
  assert.match(activated.resources.moonAlbedo, /moon-1024\.jpg$/);
  assert.match(activated.resources.milkyWay, /milky-way-gaia-edr3-16k\.jpg$/);
  assert.match(activated.resources.starCatalog, /hipparcos-bright\.json$/);
});

test('a late checksum failure cannot expose or replace a partial Earth state', async () => {
  const manifest = fixtureManifest();
  let corruptStarCatalog = false;
  const loadedAssets = [];
  const activator = createEarthStateActivator({
    loadDocument: async () => jsonDocumentFixture(manifest),
    loadAsset: async ({ name, url }) => {
      loadedAssets.push(name);
      return {
        value: `loaded:${url}`,
        bytes: corruptStarCatalog && name === 'starCatalog'
          ? new TextEncoder().encode('corrupt asset')
          : fixtureBytes,
      };
    },
  });
  const active = await activator.activate('https://example.test/states/current/manifest.json');
  loadedAssets.length = 0;

  corruptStarCatalog = true;

  await assert.rejects(
    activator.activate('https://example.test/states/replacement/manifest.json'),
    /checksum/,
  );
  assert.equal(loadedAssets.length, 7);
  assert.equal(activator.current, active);
});

test('a verified latest pointer replaces the active Earth state as one complete bundle', async () => {
  const bundled = fixtureManifest();
  const replacement = fixtureManifest();
  replacement.bundleId = 'fixture-2026-08-25T13:00:00Z';
  replacement.times.validAt = '2026-08-25T13:00:00Z';
  const { latest, manifestBytes: replacementBytes } = latestPointerFixture(replacement, './bundles/13/manifest.json');
  const documents = new Map([
    ['https://example.test/bundled.json', bundled],
    ['https://example.test/earth-state/latest.json', latest],
    ['https://example.test/earth-state/bundles/13/manifest.json', replacement],
  ]);
  const activator = createEarthStateActivator({
    loadDocument: async url => {
      const value = documents.get(url);
      const bytes = url.endsWith('/manifest.json') ? replacementBytes : new TextEncoder().encode(JSON.stringify(value));
      return { value, bytes, mediaType: 'application/json' };
    },
    loadAsset: async ({ url }) => loaded(`loaded:${url}`),
  });
  const active = await activator.activate('https://example.test/bundled.json');

  const updated = await activator.activateLatest('https://example.test/earth-state/latest.json');

  assert.notEqual(updated, active);
  assert.equal(updated.manifest.bundleId, replacement.bundleId);
  assert.equal(activator.current, updated);
});

test('a replacement timeout leaves the previous coherent Earth state active', async () => {
  const bundled = fixtureManifest();
  const replacement = fixtureManifest();
  replacement.bundleId = 'fixture-timeout';
  const { latest, manifestBytes: replacementBytes } = latestPointerFixture(replacement, './bundles/timeout/manifest.json');
  const activator = createEarthStateActivator({
    timeoutMs: 10,
    loadDocument: async url => ({
      value: url.endsWith('bundled.json') ? bundled : url.endsWith('latest.json') ? latest : replacement,
      bytes: url.endsWith('bundled.json')
        ? new TextEncoder().encode(JSON.stringify(bundled))
        : url.endsWith('latest.json') ? new TextEncoder().encode(JSON.stringify(latest)) : replacementBytes,
      mediaType: 'application/json',
    }),
    loadAsset: async ({ name, url }) => {
      if (url.includes('/bundles/timeout/') && name === 'cloudOpacity') return new Promise(() => undefined);
      return loaded(`loaded:${url}`);
    },
  });
  const active = await activator.activate('https://example.test/bundled.json');

  await assert.rejects(
    Promise.race([
      activator.activateLatest('https://example.test/earth-state/latest.json'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('test safety timeout')), 100)),
    ]),
    /Earth-state activation timed out/,
  );
  assert.equal(activator.current, active);
});

test('a corrupt published manifest cannot replace the current Earth state', async () => {
  const bundled = fixtureManifest();
  const replacement = fixtureManifest();
  replacement.bundleId = 'fixture-corrupt-manifest';
  const { latest, manifestBytes: replacementBytes } = latestPointerFixture(replacement, './bundles/corrupt/manifest.json');
  const corruptBytes = Uint8Array.from(replacementBytes);
  corruptBytes[0] ^= 1;
  let assetLoads = 0;
  const activator = createEarthStateActivator({
    loadDocument: async url => {
      if (url.endsWith('bundled.json')) return jsonDocumentFixture(bundled);
      if (url.endsWith('latest.json')) return jsonDocumentFixture(latest);
      return { value: replacement, bytes: corruptBytes, mediaType: 'application/json' };
    },
    loadAsset: async ({ url }) => {
      assetLoads += 1;
      return loaded(`loaded:${url}`);
    },
  });
  const active = await activator.activate('https://example.test/bundled.json');
  assetLoads = 0;

  await assert.rejects(
    activator.activateLatest('https://example.test/earth-state/latest.json'),
    /checksum mismatch/,
  );
  assert.equal(assetLoads, 0);
  assert.equal(activator.current, active);
});

test('an incomplete or checksum-corrupt latest asset leaves the current Earth state active', async () => {
  for (const failure of ['incomplete download', 'asset checksum']) {
    const bundled = fixtureManifest();
    const replacement = fixtureManifest();
    replacement.bundleId = `fixture-${failure.replace(' ', '-')}`;
    const href = `./bundles/${failure.replace(' ', '-')}/manifest.json`;
    const { latest, manifestBytes } = latestPointerFixture(replacement, href);
    const activator = createEarthStateActivator({
      loadDocument: async url => {
        if (url.endsWith('bundled.json')) return jsonDocumentFixture(bundled);
        if (url.endsWith('latest.json')) return jsonDocumentFixture(latest);
        return { value: replacement, bytes: manifestBytes, mediaType: 'application/json' };
      },
      loadAsset: async ({ name, url }) => {
        const isReplacement = url.includes('/bundles/');
        if (isReplacement && failure === 'incomplete download' && name === 'cloudOpacity') {
          throw new Error('replacement asset unavailable');
        }
        return {
          value: `loaded:${url}`,
          bytes: isReplacement && failure === 'asset checksum' && name === 'starCatalog'
            ? new TextEncoder().encode('corrupt asset')
            : fixtureBytes,
        };
      },
    });
    const active = await activator.activate('https://example.test/bundled.json');

    await assert.rejects(
      activator.activateLatest('https://example.test/earth-state/latest.json'),
      failure === 'incomplete download' ? /asset unavailable/ : /checksum mismatch/,
    );
    assert.equal(activator.current, active);
  }
});

test('malformed published JSON from the browser document loader leaves the current Earth state active', async () => {
  const bundled = fixtureManifest();
  const malformedManifestBytes = new TextEncoder().encode('{"schemaVersion":');
  const latest = latestPointerForBytes('fixture-malformed-json', './bundles/malformed/manifest.json', malformedManifestBytes);
  const responses = new Map([
    ['https://example.test/bundled.json', JSON.stringify(bundled)],
    ['https://example.test/earth-state/latest.json', JSON.stringify(latest)],
    ['https://example.test/earth-state/bundles/malformed/manifest.json', new TextDecoder().decode(malformedManifestBytes)],
  ]);
  const activator = createEarthStateActivator({
    loadDocument: (url, options) => loadEarthStateJsonDocument(url, options, async requestedUrl => new Response(
      responses.get(requestedUrl),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )),
    loadAsset: async ({ url }) => loaded(`loaded:${url}`),
  });
  const active = await activator.activate('https://example.test/bundled.json');

  await assert.rejects(
    activator.activateLatest('https://example.test/earth-state/latest.json'),
    /malformed JSON/,
  );
  assert.equal(activator.current, active);
});
