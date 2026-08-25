import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createEarthStateActivator } from '../src/earth-state.js';

const fixtureBytes = new TextEncoder().encode('fixture asset');
const checksum = 'dc9905c9a7e70f6485604c96e9a3ff0f5fc0b8ae936ef644a6ae31afbc10acd4';
const loaded = value => ({ value, bytes: fixtureBytes });

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
    loadManifest: async () => manifest,
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
    loadManifest: async () => nextManifest,
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
    loadManifest: async () => manifest,
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
      loadManifest: async () => manifest,
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
  const manifest = JSON.parse(await readFile(
    new URL('../public/earth-state/bundled-v1.json', import.meta.url),
    'utf8',
  ));
  const activator = createEarthStateActivator({
    loadManifest: async () => manifest,
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

test('bytes that disagree with the declared checksum cannot replace the active Earth state', async () => {
  const manifest = fixtureManifest();
  let corrupt = false;
  let verifiedAssets = 0;
  const activator = createEarthStateActivator({
    loadManifest: async () => manifest,
    loadAsset: async ({ url }) => ({
      value: `loaded:${url}`,
      bytes: corrupt ? new TextEncoder().encode('corrupt asset') : fixtureBytes,
    }),
    onAssetVerified: () => { verifiedAssets += 1; },
  });
  const active = await activator.activate('https://example.test/states/current/manifest.json');
  const verifiedFromActiveState = verifiedAssets;
  assert.equal(verifiedFromActiveState, 7);

  corrupt = true;

  await assert.rejects(
    activator.activate('https://example.test/states/replacement/manifest.json'),
    /checksum/,
  );
  assert.equal(activator.current, active);
  assert.equal(verifiedAssets, verifiedFromActiveState);
});
