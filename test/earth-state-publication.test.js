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
      surfaceAlbedo: layer('surface'),
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
  for (const descriptor of [
    ...Object.values(first.publication.manifest.layers),
    ...Object.values(first.publication.manifest.resources),
  ]) {
    assert.match(descriptor.asset.href, /^\.\/assets\/(layer|resource)-[A-Za-z]+-[a-f0-9]{16}\.(png|json)$/);
    assert.equal(descriptor.asset.immutable, true);
    assert.equal(first.files.has(new URL(descriptor.asset.href, `https://published.test/${first.publication.manifestPath}`).pathname.slice(1)), true);
  }
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
