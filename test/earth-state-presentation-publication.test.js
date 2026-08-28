import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createEarthStatePresentationPublisher } from '../src/earth-state-presentation-publication.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function presentationSource() {
  const manifestUrl = 'https://science.test/earth/manifest.json';
  const assets = new Map();
  const asset = (name, mediaType = 'image/png') => {
    const bytes = encoder.encode(`scientific-source:${name}`);
    const href = `./${name}.${mediaType === 'application/json' ? 'json' : 'png'}`;
    assets.set(new URL(href, manifestUrl).href, { bytes, mediaType });
    return { href, mediaType, byteLength: bytes.byteLength, immutable: true, checksum: { algorithm: 'sha256', value: sha256(bytes) } };
  };
  const layer = (name, width) => ({
    datasetId: 'earth-observation',
    units: 'normalized',
    dimensions: { width, height: width / 2 },
    colorSpace: 'linear',
    channels: { r: 'value' },
    textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
    asset: asset(name),
  });
  const manifest = {
    schemaVersion: 1,
    bundleId: 'scientific-earth-2026-08-28T12:00:00Z',
    classification: 'observed',
    geographicConvention: {
      crs: 'EPSG:4326', projection: 'equirectangular', longitudeRange: [-180, 180],
      latitudeRange: [-90, 90], northAtTop: true, seamLongitude: -180,
    },
    times: {
      observedFrom: '2026-08-28T11:00:00Z', observedTo: '2026-08-28T11:59:59Z',
      validAt: '2026-08-28T12:00:00Z', producedAt: '2026-08-28T12:20:00Z', retrievedAt: '2026-08-28T12:30:00Z',
    },
    datasets: [
      { id: 'earth-observation', version: 'science-v1', attribution: 'Scientific Earth fixture' },
      { id: 'sky-observation', version: 'sky-v1', attribution: 'Scientific sky fixture' },
    ],
    layers: {
      surfaceAlbedo: layer('surface', 16384),
      nightLights: layer('lights', 16384),
      cloudOpacity: layer('cloud-opacity', 16384),
      cloudDensity: layer('cloud-density', 4096),
    },
    resources: {
      moonAlbedo: { datasetId: 'sky-observation', semantics: 'lunar albedo', dimensions: { width: 2048, height: 1024 }, colorSpace: 'srgb', asset: asset('moon') },
      milkyWay: { datasetId: 'sky-observation', semantics: 'all-sky panorama', dimensions: { width: 16384, height: 8192 }, colorSpace: 'srgb', asset: asset('milky-way') },
      starCatalog: { datasetId: 'sky-observation', semantics: 'star catalogue', asset: asset('stars', 'application/json') },
    },
  };
  assets.set(manifestUrl, { bytes: encoder.encode(JSON.stringify(manifest)), mediaType: 'application/json' });
  return { assets, manifest, manifestUrl };
}

function memoryStore() {
  const values = new Map();
  return {
    values,
    async writeImmutable(path, bytes) {
      const previous = values.get(path);
      if (previous && !Buffer.from(previous).equals(bytes)) throw new Error(`immutable conflict: ${path}`);
      values.set(path, new Uint8Array(bytes));
    },
    async read(path) {
      return values.get(path);
    },
    async replaceLatest(path, bytes) {
      values.set(path, new Uint8Array(bytes));
    },
  };
}

test('publication creates coherent 8K and 16K GPU-ready tiers from one scientific state', async () => {
  const source = presentationSource();
  const store = memoryStore();
  const publisher = createEarthStatePresentationPublisher({
    async loadSource(url) {
      return source.assets.get(url);
    },
    store,
    async transcodeTexture({ bytes, width, height, tierId }) {
      return { bytes: encoder.encode(`ktx2:${tierId}:${width}x${height}:${decoder.decode(bytes)}`), width, height };
    },
  });

  const publication = await publisher.publish({ sourceManifestUrl: source.manifestUrl });

  assert.deepEqual(publication.index.tiers.map(tier => [tier.id, tier.dimensions.width]), [['8k', 8192], ['16k', 16384]]);
  assert.equal(publication.index.scientificContentId.startsWith('sha256:'), true);
  assert.equal(store.values.has('latest-presentations.json'), true);
  const latestIndex = JSON.parse(decoder.decode(store.values.get('latest-presentations.json')));
  assert.deepEqual(latestIndex.tiers.map(tier => new URL(tier.manifest.href, 'https://earth.test/latest-presentations.json').href), [
    'https://earth.test/presentations/scientific-earth-2026-08-28T12:00:00Z/8k/manifest.json',
    'https://earth.test/presentations/scientific-earth-2026-08-28T12:00:00Z/16k/manifest.json',
  ]);
  for (const tier of publication.index.tiers) {
    const manifest = publication.manifests[tier.id];
    assert.deepEqual(manifest.times, source.manifest.times);
    assert.deepEqual(manifest.datasets, source.manifest.datasets);
    assert.equal(manifest.layers.surfaceAlbedo.dimensions.width, tier.dimensions.width);
    assert.equal(manifest.layers.cloudDensity.dimensions.width, 4096);
    for (const layer of Object.values(manifest.layers)) assert.equal(layer.asset.mediaType, 'image/ktx2');
    assert.equal(manifest.resources.moonAlbedo.asset.mediaType, 'image/ktx2');
    assert.equal(manifest.resources.milkyWay.asset.mediaType, 'image/ktx2');
    assert.equal(manifest.resources.starCatalog.asset.mediaType, 'application/json');
    assert.equal(tier.budgets.transferBytes > 0, true);
    assert.equal(tier.budgets.decodedGpuBytes > 0, true);
    assert.equal(tier.budgets.cloudCrossfadeOverheadBytes > 0, true);
  }
});

test('publication refuses to label an upscaled surface as an 8K presentation tier', async () => {
  const source = presentationSource();
  const manifest = structuredClone(source.manifest);
  manifest.layers.surfaceAlbedo.dimensions = { width: 4096, height: 2048 };
  source.assets.set(source.manifestUrl, { bytes: encoder.encode(JSON.stringify(manifest)), mediaType: 'application/json' });
  const publisher = createEarthStatePresentationPublisher({
    loadSource: async url => source.assets.get(url),
    store: memoryStore(),
    transcodeTexture: async ({ bytes, width, height }) => ({ bytes, width, height }),
  });

  await assert.rejects(publisher.publish({ sourceManifestUrl: source.manifestUrl }), /does not justify an 8K presentation/);
});

test('publication rejects a source whose declared width lacks the exact global 2:1 height', async () => {
  const source = presentationSource();
  const manifest = structuredClone(source.manifest);
  manifest.layers.surfaceAlbedo.dimensions = { width: 16384, height: 4096 };
  source.assets.set(source.manifestUrl, { bytes: encoder.encode(JSON.stringify(manifest)), mediaType: 'application/json' });
  const publisher = createEarthStatePresentationPublisher({
    loadSource: async url => source.assets.get(url),
    store: memoryStore(),
    transcodeTexture: async ({ bytes, width, height }) => ({ bytes, width, height }),
  });

  await assert.rejects(publisher.publish({ sourceManifestUrl: source.manifestUrl }), /2:1 global surface/);
});
