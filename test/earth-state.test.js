import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createEarthStateActivator } from '../src/earth-state.js';

const fixtureBytes = new TextEncoder().encode('fixture asset');
const checksum = 'dc9905c9a7e70f6485604c96e9a3ff0f5fc0b8ae936ef644a6ae31afbc10acd4';
const loaded = value => ({ value, bytes: fixtureBytes });
const document = value => ({ value, bytes: new TextEncoder().encode(JSON.stringify(value)), mediaType: 'application/json' });

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

test('a complete Earth-state manifest activates one coherent scene asset set', async () => {
  const manifest = fixtureManifest();
  const loadedUrls = [];
  const activator = createEarthStateActivator({
    loadDocument: async () => document(manifest),
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

test('an incomplete manifest is rejected without replacing the active Earth state', async () => {
  const complete = fixtureManifest();
  const incomplete = fixtureManifest();
  delete incomplete.layers.cloudOpacity;
  let nextManifest = complete;
  const activator = createEarthStateActivator({
    loadDocument: async () => document(nextManifest),
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
    loadDocument: async () => document(manifest),
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
      loadDocument: async () => document(manifest),
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
  const latest = JSON.parse(await readFile(
    new URL('../public/earth-state/latest.json', import.meta.url),
    'utf8',
  ));
  assert.equal(latest.bundleId, manifest.bundleId);
  assert.equal(latest.manifest.byteLength, manifestBytes.byteLength);
  assert.equal(latest.manifest.checksum.value, createHash('sha256').update(manifestBytes).digest('hex'));
  const activator = createEarthStateActivator({
    loadDocument: async () => document(manifest),
    loadAsset: async ({ descriptor, url }) => {
      const bytes = await readFile(new URL(`../public${new URL(url).pathname}`, import.meta.url));
      assert.equal(bytes.byteLength, descriptor.asset.byteLength);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.asset.checksum.value);
      return { value: url, bytes };
    },
  });

  const activated = await activator.activate('https://themarble.local/earth-state/bundled-v1.json');

  assert.equal(activated.manifest.classification, 'static-fallback');
  assert.match(activated.layers.surfaceAlbedo, /earth-surface-5400\.png$/);
  assert.match(activated.layers.nightLights, /earth-lights-3km\.jpg$/);
  assert.match(activated.layers.cloudOpacity, /fair-clouds-4k\.png$/);
  assert.match(activated.layers.cloudDensity, /cloud-density-modis-terra-2026-08-25\.png$/);
  assert.match(activated.resources.moonAlbedo, /moon-1024\.jpg$/);
  assert.match(activated.resources.milkyWay, /milky-way-gaia-edr3-16k\.jpg$/);
  assert.match(activated.resources.starCatalog, /hipparcos-bright\.json$/);
});

test('a late checksum failure cannot expose or replace a partial Earth state', async () => {
  const manifest = fixtureManifest();
  let corruptStarCatalog = false;
  const loadedAssets = [];
  const activator = createEarthStateActivator({
    loadDocument: async () => document(manifest),
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
  const replacementBytes = new TextEncoder().encode(JSON.stringify(replacement));
  const latest = {
    schemaVersion: 1,
    bundleId: replacement.bundleId,
    manifest: {
      href: './bundles/13/manifest.json',
      mediaType: 'application/json',
      byteLength: replacementBytes.byteLength,
      immutable: true,
      checksum: { algorithm: 'sha256', value: createHash('sha256').update(replacementBytes).digest('hex') },
    },
  };
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
  const replacementBytes = new TextEncoder().encode(JSON.stringify(replacement));
  const latest = {
    schemaVersion: 1,
    bundleId: replacement.bundleId,
    manifest: {
      href: './bundles/timeout/manifest.json',
      mediaType: 'application/json',
      byteLength: replacementBytes.byteLength,
      immutable: true,
      checksum: { algorithm: 'sha256', value: createHash('sha256').update(replacementBytes).digest('hex') },
    },
  };
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
  const replacementBytes = new TextEncoder().encode(JSON.stringify(replacement));
  const corruptBytes = Uint8Array.from(replacementBytes);
  corruptBytes[0] ^= 1;
  const latest = {
    schemaVersion: 1,
    bundleId: replacement.bundleId,
    manifest: {
      href: './bundles/corrupt/manifest.json',
      mediaType: 'application/json',
      byteLength: replacementBytes.byteLength,
      immutable: true,
      checksum: { algorithm: 'sha256', value: createHash('sha256').update(replacementBytes).digest('hex') },
    },
  };
  let assetLoads = 0;
  const activator = createEarthStateActivator({
    loadDocument: async url => {
      if (url.endsWith('bundled.json')) return document(bundled);
      if (url.endsWith('latest.json')) return document(latest);
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
