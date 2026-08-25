import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { activateEarthStateAtStartup, createEarthStateBundleCache } from '../src/earth-state-cache.js';
import { createEarthStateActivator } from '../src/earth-state.js';

function createMemoryStorage() {
  let values = new Map();
  let interruptNextCommit = false;
  return {
    async get(key) {
      return values.get(key);
    },
    async commit({ writes, deletes }) {
      if (interruptNextCommit) {
        interruptNextCommit = false;
        throw new Error('interrupted desktop transaction');
      }
      const next = structuredClone(values);
      for (const { key, value } of writes) next.set(key, structuredClone(value));
      for (const key of deletes) next.delete(key);
      values = next;
    },
    interrupt() {
      interruptNextCommit = true;
    },
    evictBundle(bundleId) {
      values.delete(`remote-bundle:${bundleId}`);
    },
    corruptBundle(bundleId) {
      const record = values.get(`remote-bundle:${bundleId}`);
      const corrupted = structuredClone(record);
      corrupted.entries.at(-1).bytes = new TextEncoder().encode('nonempty corrupt cached bytes');
      values.set(`remote-bundle:${bundleId}`, corrupted);
    },
  };
}

function bundle(bundleId, validAt) {
  return completeBundle(bundleId, validAt);
}

const sceneAssetBytes = new TextEncoder().encode('the same scientific fixture');
const sceneAssetChecksum = createHash('sha256').update(sceneAssetBytes).digest('hex');

function completeBundle(bundleId, validAt, corruptAssets = false) {
  const latestUrl = `https://example.test/earth-state/${bundleId}/latest.json`;
  const manifestUrl = new URL('./manifest.json', latestUrl).href;
  const descriptor = (href, datasetId = 'earth') => ({
    datasetId,
    units: 'display-referred reflectance',
    dimensions: { width: 4, height: 2 },
    colorSpace: 'srgb',
    channels: { rgb: 'color' },
    textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
    asset: {
      href,
      mediaType: 'application/octet-stream',
      byteLength: sceneAssetBytes.byteLength,
      immutable: true,
      checksum: { algorithm: 'sha256', value: sceneAssetChecksum },
    },
  });
  const manifest = {
    schemaVersion: 1,
    bundleId,
    classification: 'observed',
    geographicConvention: {
      crs: 'EPSG:4326', projection: 'equirectangular', longitudeRange: [-180, 180],
      latitudeRange: [-90, 90], northAtTop: true, seamLongitude: -180,
    },
    times: {
      observedFrom: validAt, observedTo: validAt, validAt, producedAt: validAt, retrievedAt: validAt,
    },
    datasets: [
      { id: 'earth', version: bundleId, attribution: 'Fixture Earth data' },
      { id: 'sky', version: 'fixture-sky', attribution: 'Fixture sky data' },
    ],
    layers: {
      surfaceAlbedo: descriptor('./surface.bin'),
      nightLights: descriptor('./lights.bin'),
      cloudOpacity: descriptor('./clouds.bin'),
      cloudDensity: descriptor('./cloud-density.bin'),
    },
    resources: {
      moonAlbedo: { ...descriptor('./moon.bin', 'sky'), semantics: 'lunar albedo' },
      milkyWay: { ...descriptor('./milky-way.bin', 'sky'), semantics: 'all-sky panorama' },
      starCatalog: { ...descriptor('./stars.bin', 'sky'), semantics: 'star catalogue' },
    },
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const latest = {
    schemaVersion: 1,
    bundleId,
    manifest: {
      href: './manifest.json', mediaType: 'application/json', byteLength: manifestBytes.byteLength,
      immutable: true,
      checksum: { algorithm: 'sha256', value: createHash('sha256').update(manifestBytes).digest('hex') },
    },
  };
  const entries = [
    { url: latestUrl, mediaType: 'application/json', bytes: new TextEncoder().encode(JSON.stringify(latest)) },
    { url: manifestUrl, mediaType: 'application/json', bytes: manifestBytes },
    ...[...Object.values(manifest.layers), ...Object.values(manifest.resources)].map((item, index) => ({
      url: new URL(item.asset.href, manifestUrl).href,
      mediaType: item.asset.mediaType,
      bytes: corruptAssets && index === 6 ? new TextEncoder().encode('corrupt fixture bytes') : sceneAssetBytes,
    })),
  ];
  return { bundleId, validAt, latestUrl, entries };
}

async function activateRawBundle(source) {
  const activator = createEarthStateActivator({
    async loadDocument(url) {
      const entry = source.read(url);
      return { ...entry, value: JSON.parse(new TextDecoder().decode(entry.bytes)) };
    },
    async loadAsset({ name, url }) {
      const entry = source.read(url);
      return { value: `decoded:${name}`, bytes: entry.bytes };
    },
  });
  return activator.activateLatest(source.latestUrl);
}

test('desktop startup restores the newest of the two most recent remote Earth bundles', async () => {
  const cache = createEarthStateBundleCache({ storage: createMemoryStorage() });
  await cache.remember(bundle('earth-2026-08-23', '2026-08-23T12:00:00Z'));
  await cache.remember(bundle('earth-2026-08-24', '2026-08-24T12:00:00Z'));
  await cache.remember(bundle('earth-2026-08-25', '2026-08-25T12:00:00Z'));
  const attempted = [];

  const restored = await cache.restoreNewest(async candidate => {
    attempted.push(candidate.bundleId);
    return candidate.bundleId;
  });

  assert.equal(restored, 'earth-2026-08-25');
  assert.deepEqual(attempted, ['earth-2026-08-25']);
  assert.deepEqual(await cache.bundleIds(), ['earth-2026-08-25', 'earth-2026-08-24']);
});

test('cache recency follows successful activation order rather than scientific observation time', async () => {
  const cache = createEarthStateBundleCache({ storage: createMemoryStorage() });
  await cache.remember(bundle('earth-original', '2026-08-25T12:00:00Z'));
  await cache.remember(bundle('earth-next', '2026-08-25T13:00:00Z'));
  await cache.remember(bundle('earth-corrected-later', '2026-08-24T12:00:00Z'));

  assert.deepEqual(await cache.bundleIds(), ['earth-corrected-later', 'earth-next']);
});

test('an interrupted cache replacement leaves both previously retained bundles intact', async () => {
  const storage = createMemoryStorage();
  const cache = createEarthStateBundleCache({ storage });
  await cache.remember(bundle('earth-one', '2026-08-24T12:00:00Z'));
  await cache.remember(bundle('earth-two', '2026-08-25T12:00:00Z'));
  storage.interrupt();

  await assert.rejects(
    cache.remember(bundle('earth-interrupted', '2026-08-26T12:00:00Z')),
    /interrupted desktop transaction/,
  );

  assert.deepEqual(await cache.bundleIds(), ['earth-two', 'earth-one']);
});

test('a new bundle retains the newest readable predecessor after partial cache eviction', async () => {
  const storage = createMemoryStorage();
  const cache = createEarthStateBundleCache({ storage });
  await cache.remember(bundle('earth-older-valid', '2026-08-24T12:00:00Z'));
  await cache.remember(bundle('earth-newer-evicted', '2026-08-25T12:00:00Z'));
  storage.evictBundle('earth-newer-evicted');

  await cache.remember(bundle('earth-newest', '2026-08-26T12:00:00Z'));

  assert.deepEqual(await cache.bundleIds(), ['earth-newest', 'earth-older-valid']);
});

test('a new bundle retains the older verified predecessor when newer cached bytes are corrupt', async () => {
  const storage = createMemoryStorage();
  const cache = createEarthStateBundleCache({ storage });
  await cache.remember(bundle('earth-older-verified', '2026-08-24T12:00:00Z'));
  await cache.remember(bundle('earth-newer-corrupt', '2026-08-25T12:00:00Z'));
  storage.corruptBundle('earth-newer-corrupt');

  await cache.remember(bundle('earth-newest-verified', '2026-08-26T12:00:00Z'));

  assert.deepEqual(await cache.bundleIds(), ['earth-newest-verified', 'earth-older-verified']);
});

test('desktop startup skips a corrupt newest cache bundle and restores the next complete bundle', async () => {
  const cache = createEarthStateBundleCache({ storage: createMemoryStorage() });
  await cache.remember(bundle('earth-complete', '2026-08-24T12:00:00Z'));
  await cache.remember(bundle('earth-corrupt', '2026-08-25T12:00:00Z'));
  const attempted = [];

  const restored = await activateEarthStateAtStartup({
    cache,
    async activateCached(candidate) {
      attempted.push(candidate.bundleId);
      if (candidate.bundleId === 'earth-corrupt') throw new Error('checksum mismatch');
      return candidate.bundleId;
    },
    async activateBundled() {
      return 'bundled-seasonal-earth';
    },
  });

  assert.equal(restored, 'earth-complete');
  assert.deepEqual(attempted, ['earth-corrupt', 'earth-complete']);
});

test('desktop startup falls back to the bundled seasonal Earth when persistent storage is unavailable', async () => {
  const restored = await activateEarthStateAtStartup({
    cache: {
      async restoreNewest() {
        throw new Error('desktop cache was evicted');
      },
    },
    async activateCached() {
      throw new Error('no cache candidate should be activated');
    },
    async activateBundled() {
      return 'bundled-seasonal-earth';
    },
  });

  assert.equal(restored, 'bundled-seasonal-earth');
});

test('the same scientific bundle activates equivalently from the web source and the desktop cache', async () => {
  const snapshot = completeBundle('earth-equivalent', '2026-08-25T15:00:00Z');
  const sourceEntries = new Map(snapshot.entries.map(entry => [entry.url, entry]));
  const webState = await activateRawBundle({
    latestUrl: snapshot.latestUrl,
    read(url) {
      return sourceEntries.get(url);
    },
  });
  const cache = createEarthStateBundleCache({ storage: createMemoryStorage() });
  await cache.remember(snapshot);

  const desktopState = await cache.restoreNewest(activateRawBundle);

  assert.deepEqual(desktopState, webState);
});

test('a checksum-corrupt cached bundle cannot replace the bundled seasonal Earth', async () => {
  const cache = createEarthStateBundleCache({ storage: createMemoryStorage() });
  await cache.remember(completeBundle('earth-corrupt-bytes', '2026-08-25T16:00:00Z', true));

  const restored = await activateEarthStateAtStartup({
    cache,
    activateCached: activateRawBundle,
    async activateBundled() {
      return 'bundled-seasonal-earth';
    },
  });

  assert.equal(restored, 'bundled-seasonal-earth');
});
