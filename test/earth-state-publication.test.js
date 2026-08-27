import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEarthStateActivator } from '../src/earth-state.js';
import { createFilePublicationStore } from '../src/earth-state-publication-file-store.js';
import { createEarthStatePublisher } from '../src/earth-state-publication.js';

const encoder = new TextEncoder();
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');

function sourceFixture() {
  const assets = new Map();
  const assetReference = (name, mediaType = 'image/png') => {
    const bytes = encoder.encode(`fixture:${name}`);
    const href = `./${name}.${mediaType === 'application/json' ? 'json' : 'png'}`;
    assets.set(new URL(href, 'https://fixtures.test/source/manifest.json').href, { bytes, mediaType });
    return {
      href,
      mediaType,
      byteLength: bytes.byteLength,
      immutable: true,
      checksum: { algorithm: 'sha256', value: checksum(bytes) },
    };
  };
  const layer = name => ({
    datasetId: 'fixture-earth',
    units: 'normalized',
    dimensions: { width: 4, height: 2 },
    colorSpace: 'linear',
    channels: { r: 'value' },
    textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
    asset: assetReference(name),
  });
  const resource = (name, mediaType) => ({
    datasetId: 'fixture-sky',
    semantics: `fixture ${name}`,
    asset: assetReference(name, mediaType),
  });
  const surfaceAlbedo = layer('surface-01');
  surfaceAlbedo.seasonalCycle = {
    interpolation: 'linear',
    frames: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      datasetId: 'fixture-earth',
      asset: index === 0 ? surfaceAlbedo.asset : assetReference(`surface-${String(index + 1).padStart(2, '0')}`),
    })),
  };
  const manifest = {
    schemaVersion: 1,
    bundleId: 'source-fixture',
    classification: 'observed',
    geographicConvention: {
      crs: 'EPSG:4326', projection: 'equirectangular', longitudeRange: [-180, 180], latitudeRange: [-90, 90], northAtTop: true, seamLongitude: -180,
    },
    times: {
      observedFrom: '2026-08-25T11:00:00Z', observedTo: '2026-08-25T11:59:59Z', validAt: '2026-08-25T12:00:00Z', producedAt: '2026-08-25T12:00:00Z', retrievedAt: '2026-08-25T12:00:00Z',
    },
    datasets: [
      { id: 'fixture-earth', version: 'fixture-1', attribution: 'Fixture Earth' },
      { id: 'fixture-sky', version: 'fixture-1', attribution: 'Fixture sky' },
    ],
    layers: {
      surfaceAlbedo,
      nightLights: layer('lights'),
      cloudOpacity: layer('clouds'),
      cloudDensity: layer('density'),
    },
    resources: {
      moonAlbedo: resource('moon', 'image/png'),
      milkyWay: resource('sky', 'image/png'),
      starCatalog: resource('stars', 'application/json'),
    },
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  assets.set('https://fixtures.test/source/manifest.json', { bytes: manifestBytes, mediaType: 'application/json' });
  return assets;
}

function addCloudSequenceToSource(source) {
  const manifestUrl = 'https://fixtures.test/source/manifest.json';
  const manifest = JSON.parse(new TextDecoder().decode(source.get(manifestUrl).bytes));
  const priorAsset = name => {
    const bytes = encoder.encode(`fixture:${name}`);
    const href = `./${name}.png`;
    source.set(new URL(href, manifestUrl).href, { bytes, mediaType: 'image/png' });
    return {
      href,
      mediaType: 'image/png',
      byteLength: bytes.byteLength,
      immutable: true,
      checksum: { algorithm: 'sha256', value: checksum(bytes) },
    };
  };
  const frame = (hour, layers, producedMinute) => ({
    validAt: `2026-08-25T${hour}:00:00Z`,
    observedFrom: `2026-08-25T${hour}:00:00Z`,
    observedTo: `2026-08-25T${hour}:09:59Z`,
    producedAt: `2026-08-25T${hour}:${producedMinute}:00Z`,
    retrievedAt: `2026-08-25T${hour}:48:00Z`,
    coverage: { observedFraction: 0.8, latitudeRange: [-72.7, 72.7] },
    layers,
  });
  const previous = frame('11', {
    cloudOpacity: { datasetId: 'fixture-earth', asset: priorAsset('clouds-11') },
    cloudDensity: { datasetId: 'fixture-earth', asset: priorAsset('density-11') },
  }, '42');
  const current = frame('12', {
    cloudOpacity: { datasetId: 'fixture-earth', asset: structuredClone(manifest.layers.cloudOpacity.asset) },
    cloudDensity: { datasetId: 'fixture-earth', asset: structuredClone(manifest.layers.cloudDensity.asset) },
  }, '43');
  manifest.cloudSequence = { interpolation: 'crossfade', transitionSeconds: 300, frames: [previous, current] };
  manifest.times = {
    observedFrom: previous.observedFrom,
    observedTo: current.observedTo,
    validAt: current.validAt,
    producedAt: current.producedAt,
    retrievedAt: current.retrievedAt,
  };
  source.set(manifestUrl, { bytes: encoder.encode(JSON.stringify(manifest)), mediaType: 'application/json' });
}

function makeCloudSequencePhysical(source) {
  const manifestUrl = 'https://fixtures.test/source/manifest.json';
  const manifest = JSON.parse(new TextDecoder().decode(source.get(manifestUrl).bytes));
  const physicalLayer = (name, suffix) => {
    const bytes = encoder.encode(`fixture:${name}-${suffix}`);
    const href = `./${name}-${suffix}.png`;
    source.set(new URL(href, manifestUrl).href, { bytes, mediaType: 'image/png' });
    return {
      datasetId: 'fixture-earth',
      units: 'normalized physical retrieval',
      dimensions: { width: 4, height: 2 },
      colorSpace: 'linear',
      channels: { r: 'physical field' },
      textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
      asset: { href, mediaType: 'image/png', byteLength: bytes.byteLength, immutable: true, checksum: { algorithm: 'sha256', value: checksum(bytes) } },
    };
  };
  manifest.layers.cloudPhysics = physicalLayer('cloudPhysics', '1300');
  manifest.layers.cloudAge = physicalLayer('cloudAge', '1300');
  const times = [
    ['2026-08-25T12:00:00Z', '2026-08-25T12:09:59Z', '2026-08-25T13:00:00Z'],
    ['2026-08-25T13:00:00Z', '2026-08-25T13:09:59Z', '2026-08-25T13:30:00Z'],
  ];
  manifest.cloudSequence.provider = 'satcorps';
  manifest.cloudSequence.frames.forEach((frame, index) => {
    [frame.validAt, frame.observedTo, frame.producedAt] = times[index];
    frame.observedFrom = frame.validAt;
    frame.retrievedAt = '2026-08-25T13:45:00Z';
    frame.coverage = { observedFraction: .97, latitudeRange: [-90, 90], usableFraction: .94 };
    for (const name of ['cloudPhysics', 'cloudAge']) {
      const layer = index === 1 ? manifest.layers[name] : physicalLayer(name, '1200');
      frame.layers[name] = { datasetId: layer.datasetId, asset: structuredClone(layer.asset) };
    }
  });
  const [previous, current] = manifest.cloudSequence.frames;
  manifest.times = {
    observedFrom: previous.observedFrom, observedTo: current.observedTo, validAt: current.validAt,
    producedAt: current.producedAt, retrievedAt: current.retrievedAt,
  };
  source.set(manifestUrl, { bytes: encoder.encode(JSON.stringify(manifest)), mediaType: 'application/json' });
}

function makeCloudSequenceGapCompleted(source) {
  const manifestUrl = 'https://fixtures.test/source/manifest.json';
  const manifest = JSON.parse(new TextDecoder().decode(source.get(manifestUrl).bytes));
  const provenanceAsset = suffix => {
    const bytes = encoder.encode(`fixture:cloud-provenance-${suffix}`);
    const href = `./cloud-provenance-${suffix}.png`;
    source.set(new URL(href, manifestUrl).href, { bytes, mediaType: 'image/png' });
    return {
      href, mediaType: 'image/png', byteLength: bytes.byteLength, immutable: true,
      checksum: { algorithm: 'sha256', value: checksum(bytes) },
    };
  };
  manifest.cloudSequence.provider = 'gmgsi';
  manifest.cloudSequence.gapCompletion = {
    maxObservationAgeSeconds: 10_800,
    minObservationQuality: .72,
    seamBlendPixels: 3,
  };
  manifest.layers.cloudProvenance = {
    ...manifest.layers.cloudDensity,
    channels: { r: 'source class', g: 'age', b: 'quality', a: 'native contribution' },
    asset: provenanceAsset('12'),
  };
  manifest.cloudSequence.frames.forEach((frame, index) => {
    frame.coverage = {
      observedFraction: .75,
      primaryObservedFraction: .65,
      polarObservedFraction: .1,
      modelAssistedFraction: .2,
      fallbackFraction: .05,
      latitudeRange: [-90, 90],
    };
    frame.assistance = {
      model: {
        product: 'gfs-total-cloud', version: 'gfs-v16', runAt: '2026-08-25T06:00:00Z', forecastHour: index + 5,
      },
      staticFallback: 'Bundled static cloud texture',
    };
    frame.layers.cloudProvenance = {
      datasetId: 'fixture-earth',
      asset: index === 1 ? structuredClone(manifest.layers.cloudProvenance.asset) : provenanceAsset('11'),
    };
  });
  manifest.classification = 'model-assisted';
  source.set(manifestUrl, { bytes: encoder.encode(JSON.stringify(manifest)), mediaType: 'application/json' });
}

function addCryosphereToSource(source) {
  const manifestUrl = 'https://fixtures.test/source/manifest.json';
  const manifest = JSON.parse(new TextDecoder().decode(source.get(manifestUrl).bytes));
  const addLayer = (name, filename) => {
    const bytes = encoder.encode(`fixture:${filename}`);
    const href = `./${filename}.png`;
    source.set(new URL(href, manifestUrl).href, { bytes, mediaType: 'image/png' });
    manifest.layers[name] = {
      datasetId: 'fixture-cryosphere',
      units: 'fraction',
      dimensions: { width: 4, height: 2 },
      colorSpace: 'linear',
      channels: { r: 'fraction', g: 'confidence', b: 'source code' },
      textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
      asset: { href, mediaType: 'image/png', byteLength: bytes.byteLength, immutable: true, checksum: { algorithm: 'sha256', value: checksum(bytes) } },
      provenance: {
        validAt: '2026-08-25T00:00:00Z', producedAt: '2026-08-25T18:00:00Z', retrievedAt: '2026-08-26T03:00:00Z',
        sourceVersion: 'IMS v3 + AMSR2 L3 + VNP10_NRT V2',
        coverage: { observedFraction: 0.96, latitudeRange: [-90, 90], fallbackFraction: 0.5 },
        fallback: 'AMSR2 global fallback',
        attribution: 'USNIC IMS; NASA/JAXA AMSR2; NASA VIIRS',
      },
    };
  };
  manifest.datasets.push({ id: 'fixture-cryosphere', version: '2026-08-25', attribution: 'USNIC IMS; NASA/JAXA AMSR2; NASA VIIRS' });
  addLayer('snowCover', 'snow-cover');
  addLayer('seaIce', 'sea-ice');
  source.set(manifestUrl, { bytes: encoder.encode(JSON.stringify(manifest)), mediaType: 'application/json' });
}

function memoryStore() {
  const files = new Map();
  return {
    files,
    adapter: {
      async writeImmutable(path, bytes) {
        const existing = files.get(path);
        if (existing && !Buffer.from(existing).equals(bytes)) throw new Error(`immutable conflict: ${path}`);
        files.set(path, Uint8Array.from(bytes));
      },
      async read(path) {
        const bytes = files.get(path);
        if (!bytes) throw new Error(`missing publication: ${path}`);
        return Uint8Array.from(bytes);
      },
      async replaceLatest(path, bytes) {
        files.set(path, Uint8Array.from(bytes));
      },
    },
  };
}

const loadSourceFixture = source => async url => {
  const loaded = source.get(url);
  if (!loaded) throw new Error(`missing fixture: ${url}`);
  return { ...loaded, bytes: Uint8Array.from(loaded.bytes) };
};

test('an explicit fixture source publishes the same complete immutable Earth state repeatedly', async () => {
  const source = sourceFixture();
  const publishOnce = async () => {
    const store = memoryStore();
    const publisher = createEarthStatePublisher({
      loadSource: loadSourceFixture(source),
      store: store.adapter,
    });
    const publication = await publisher.publish({
      targetTime: '2026-08-25T12:00:00Z',
      sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
    });
    return { publication, files: store.files };
  };

  const first = await publishOnce();
  const second = await publishOnce();

  assert.deepEqual(first.publication, second.publication);
  assert.deepEqual([...first.files], [...second.files]);
  assert.equal(first.files.has('latest.json'), true);
  assert.match(first.publication.manifestPath, /^bundles\/2026-08-25T12-00-00Z-[a-f0-9]{16}\/manifest\.json$/);
  assert.equal(first.publication.manifest.bundleId, first.publication.latest.bundleId);
  assert.equal(first.publication.manifest.layers.surfaceAlbedo.seasonalCycle.frames.length, 12);
  for (const frame of first.publication.manifest.layers.surfaceAlbedo.seasonalCycle.frames) {
    if (frame.month === 1) assert.match(frame.asset.href, /^\.\/assets\/layer-surfaceAlbedo-[a-f0-9]{16}\.png$/);
    else assert.match(frame.asset.href, /^\.\/assets\/seasonal-layer-frame-surfaceAlbedo-[0-9]{2}-[a-f0-9]{16}\.png$/);
    assert.equal(first.files.has(new URL(frame.asset.href, `https://published.test/${first.publication.manifestPath}`).pathname.slice(1)), true);
  }
  for (const descriptor of [
    ...Object.values(first.publication.manifest.layers),
    ...Object.values(first.publication.manifest.resources),
  ]) {
    assert.match(descriptor.asset.href, /^\.\/assets\/(layer|resource)-[A-Za-z]+-[a-f0-9]{16}\.(png|json)$/);
    assert.equal(descriptor.asset.immutable, true);
    assert.equal(first.files.has(new URL(descriptor.asset.href, `https://published.test/${first.publication.manifestPath}`).pathname.slice(1)), true);
  }
});

test('publication carries both complete hourly cloud observations into the immutable bundle', async () => {
  const source = sourceFixture();
  addCloudSequenceToSource(source);
  const store = memoryStore();
  const publisher = createEarthStatePublisher({ loadSource: loadSourceFixture(source), store: store.adapter });

  const publication = await publisher.publish({
    targetTime: '2026-08-25T12:00:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });

  const [previous, current] = publication.manifest.cloudSequence.frames;
  for (const name of ['cloudOpacity', 'cloudDensity']) {
    assert.match(previous.layers[name].asset.href, /^\.\/assets\/cloud-observation-frame-[A-Za-z]+-00-[a-f0-9]{16}\.png$/);
    assert.deepEqual(current.layers[name].asset, publication.manifest.layers[name].asset);
    const previousPath = new URL(previous.layers[name].asset.href, `https://published.test/${publication.manifestPath}`).pathname.slice(1);
    assert.equal(store.files.has(previousPath), true);
  }
});

test('publication carries every SatCORPS physical field atomically across both hourly frames', async () => {
  const source = sourceFixture();
  addCloudSequenceToSource(source);
  makeCloudSequencePhysical(source);
  const store = memoryStore();
  const publisher = createEarthStatePublisher({ loadSource: loadSourceFixture(source), store: store.adapter });

  const publication = await publisher.publish({
    targetTime: '2026-08-25T13:45:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });

  assert.equal(publication.manifest.cloudSequence.provider, 'satcorps');
  for (const name of ['cloudOpacity', 'cloudDensity', 'cloudPhysics', 'cloudAge']) {
    assert.deepEqual(publication.manifest.cloudSequence.frames[1].layers[name].asset, publication.manifest.layers[name].asset);
    assert.match(publication.manifest.cloudSequence.frames[0].layers[name].asset.href, /cloud-observation-frame/);
  }
});

test('publication carries both gap provenance frames and assistance audit metadata atomically', async () => {
  const source = sourceFixture();
  addCloudSequenceToSource(source);
  makeCloudSequenceGapCompleted(source);
  const store = memoryStore();
  const publisher = createEarthStatePublisher({ loadSource: loadSourceFixture(source), store: store.adapter });

  const publication = await publisher.publish({
    targetTime: '2026-08-25T12:48:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });

  const [previous, current] = publication.manifest.cloudSequence.frames;
  assert.match(previous.layers.cloudProvenance.asset.href, /cloud-observation-frame-cloudProvenance-00/);
  assert.deepEqual(current.layers.cloudProvenance.asset, publication.manifest.layers.cloudProvenance.asset);
  assert.equal(current.coverage.modelAssistedFraction, .2);
  assert.equal(current.assistance.model.forecastHour, 6);
});

test('publication carries snow and sea ice as one immutable daily analysis with provenance', async () => {
  const source = sourceFixture();
  addCryosphereToSource(source);
  const store = memoryStore();
  const publisher = createEarthStatePublisher({ loadSource: loadSourceFixture(source), store: store.adapter });

  const publication = await publisher.publish({
    targetTime: '2026-08-26T03:00:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });

  assert.match(publication.manifest.layers.snowCover.asset.href, /layer-snowCover-/);
  assert.match(publication.manifest.layers.seaIce.asset.href, /layer-seaIce-/);
  assert.equal(publication.manifest.layers.snowCover.provenance.validAt, '2026-08-25T00:00:00Z');
  assert.match(publication.manifest.layers.seaIce.provenance.attribution, /AMSR2/);
});

test('content-addressed publication reuses immutable static assets across hourly bundles', async () => {
  const source = sourceFixture();
  addCloudSequenceToSource(source);
  const store = memoryStore();
  const publisher = createEarthStatePublisher({
    loadSource: loadSourceFixture(source),
    store: store.adapter,
    assetLayout: 'content-addressed',
  });

  const first = await publisher.publish({
    targetTime: '2026-08-25T12:48:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });
  const assetPathsAfterFirst = [...store.files.keys()].filter(path => path.startsWith('assets/'));
  const second = await publisher.publish({
    targetTime: '2026-08-25T13:48:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });
  const assetPathsAfterSecond = [...store.files.keys()].filter(path => path.startsWith('assets/'));

  assert.deepEqual(assetPathsAfterSecond, assetPathsAfterFirst);
  assert.match(first.manifest.layers.surfaceAlbedo.asset.href, /^\.\.\/\.\.\/assets\//);
  assert.match(second.manifest.layers.cloudOpacity.asset.href, /^\.\.\/\.\.\/assets\//);
  assert.notEqual(first.manifestPath, second.manifestPath);
});

test('latest remains unchanged when any immutable publication fails read-back verification', async () => {
  const source = sourceFixture();
  const store = memoryStore();
  const previousLatest = encoder.encode('{"bundleId":"last-known-good"}\n');
  store.files.set('latest.json', previousLatest);
  const corruptingStore = {
    ...store.adapter,
    async read(path) {
      const bytes = await store.adapter.read(path);
      if (!path.includes('layer-cloudOpacity-')) return bytes;
      const corrupt = Uint8Array.from(bytes);
      corrupt[0] ^= 1;
      return corrupt;
    },
  };
  const publisher = createEarthStatePublisher({
    loadSource: loadSourceFixture(source),
    store: corruptingStore,
  });

  await assert.rejects(
    publisher.publish({
      targetTime: '2026-08-25T12:00:00Z',
      sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
    }),
    /checksum mismatch/,
  );
  assert.deepEqual(store.files.get('latest.json'), previousLatest);
});

test('a published fixture is loadable through the same latest-pointer contract used by the renderer', async () => {
  const source = sourceFixture();
  const store = memoryStore();
  const publisher = createEarthStatePublisher({
    loadSource: loadSourceFixture(source),
    store: store.adapter,
  });
  const publication = await publisher.publish({
    targetTime: '2026-08-25T12:00:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });
  const activator = createEarthStateActivator({
    async loadDocument(url) {
      const path = new URL(url).pathname.slice(1);
      const bytes = await store.adapter.read(path);
      return { value: JSON.parse(new TextDecoder().decode(bytes)), bytes, mediaType: 'application/json' };
    },
    async loadAsset({ url }) {
      const bytes = await store.adapter.read(new URL(url).pathname.slice(1));
      return { value: url, bytes };
    },
  });

  const active = await activator.activateLatest('https://published.test/latest.json');

  assert.equal(active.manifest.bundleId, publication.manifest.bundleId);
  assert.equal(activator.current, active);
  assert.match(active.layers.cloudOpacity, /layer-cloudOpacity-[a-f0-9]{16}\.png$/);
});

test('filesystem publication exposes only the old or new complete latest pointer during replacement', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'themarble-publication-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = sourceFixture();
  const store = createFilePublicationStore(directory);
  const publisher = createEarthStatePublisher({ loadSource: loadSourceFixture(source), store });
  const first = await publisher.publish({
    targetTime: '2026-08-25T12:00:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });
  const observedBundleIds = [first.manifest.bundleId];
  let replacementFinished = false;
  const observeLatest = (async () => {
    while (!replacementFinished) {
      const latest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
      observedBundleIds.push(latest.bundleId);
      await new Promise(resolve => setImmediate(resolve));
    }
  })();

  const second = await publisher.publish({
    targetTime: '2026-08-25T13:00:00Z',
    sourceManifestUrl: 'https://fixtures.test/source/manifest.json',
  });
  replacementFinished = true;
  await observeLatest;
  const finalLatest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
  observedBundleIds.push(finalLatest.bundleId);

  assert.notEqual(first.manifest.bundleId, second.manifest.bundleId);
  assert.equal(finalLatest.bundleId, second.manifest.bundleId);
  assert.equal(observedBundleIds.includes(first.manifest.bundleId), true);
  assert.equal(observedBundleIds.includes(second.manifest.bundleId), true);
  assert.equal(observedBundleIds.every(bundleId => [first.manifest.bundleId, second.manifest.bundleId].includes(bundleId)), true);
});
