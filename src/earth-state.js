export const EARTH_STATE_REQUIRED_LAYERS = ['surfaceAlbedo', 'nightLights', 'cloudOpacity', 'cloudDensity'];
export const EARTH_STATE_REQUIRED_RESOURCES = ['moonAlbedo', 'milkyWay', 'starCatalog'];
const TIMESTAMP_FIELDS = ['observedFrom', 'observedTo', 'validAt', 'producedAt', 'retrievedAt'];
const CLASSIFICATIONS = new Set(['static-fallback', 'observed', 'model-assisted']);

function fail(path) {
  throw new Error(`Invalid Earth-state manifest field: ${path}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') fail(path);
}

function validateAsset(asset, path) {
  if (!isRecord(asset)) fail(path);
  requireString(asset.href, `${path}.href`);
  requireString(asset.mediaType, `${path}.mediaType`);
  if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength <= 0) fail(`${path}.byteLength`);
  if (asset.immutable !== true) fail(`${path}.immutable`);
  if (!isRecord(asset.checksum) || asset.checksum.algorithm !== 'sha256' || !/^[0-9a-f]{64}$/i.test(asset.checksum.value ?? '')) {
    fail(`${path}.checksum`);
  }
}

function validateDatasetBackedDescriptor(descriptor, path, datasetIds) {
  if (!isRecord(descriptor)) fail(path);
  if (!datasetIds.has(descriptor.datasetId)) fail(`${path}.datasetId`);
  validateAsset(descriptor.asset, `${path}.asset`);
}

async function verifyLoadedAsset(loaded, reference, path) {
  if (!isRecord(loaded) || !('value' in loaded) || !(loaded.bytes instanceof Uint8Array)) {
    throw new Error(`Earth-state loader did not return verifiable bytes for ${path}`);
  }
  if (loaded.bytes.byteLength !== reference.byteLength) {
    throw new Error(`Earth-state asset byteLength mismatch for ${path}`);
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', loaded.bytes);
  const actualChecksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actualChecksum !== reference.checksum.value.toLowerCase()) {
    throw new Error(`Earth-state asset checksum mismatch for ${path}`);
  }
  return loaded.value;
}

function validateManifest(manifest) {
  if (!isRecord(manifest)) fail('manifest');
  if (manifest.schemaVersion !== 1) fail('schemaVersion');
  requireString(manifest.bundleId, 'bundleId');
  if (!CLASSIFICATIONS.has(manifest.classification)) fail('classification');

  const geographic = manifest.geographicConvention;
  if (!isRecord(geographic)) fail('geographicConvention');
  if (geographic.crs !== 'EPSG:4326') fail('geographicConvention.crs');
  if (geographic.projection !== 'equirectangular') fail('geographicConvention.projection');
  if (JSON.stringify(geographic.longitudeRange) !== '[-180,180]') fail('geographicConvention.longitudeRange');
  if (JSON.stringify(geographic.latitudeRange) !== '[-90,90]') fail('geographicConvention.latitudeRange');
  if (geographic.northAtTop !== true) fail('geographicConvention.northAtTop');
  if (geographic.seamLongitude !== -180) fail('geographicConvention.seamLongitude');

  if (!isRecord(manifest.times)) fail('times');
  for (const field of TIMESTAMP_FIELDS) {
    const value = manifest.times[field];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`times.${field}`);
  }

  if (!Array.isArray(manifest.datasets) || manifest.datasets.length === 0) fail('datasets');
  const datasetIds = new Set();
  manifest.datasets.forEach((dataset, index) => {
    const path = `datasets.${index}`;
    if (!isRecord(dataset)) fail(path);
    requireString(dataset.id, `${path}.id`);
    requireString(dataset.version, `${path}.version`);
    requireString(dataset.attribution, `${path}.attribution`);
    if (datasetIds.has(dataset.id)) fail(`${path}.id`);
    datasetIds.add(dataset.id);
  });

  requireEntries(manifest, 'layers', EARTH_STATE_REQUIRED_LAYERS);
  requireEntries(manifest, 'resources', EARTH_STATE_REQUIRED_RESOURCES);

  for (const [name, layer] of Object.entries(manifest.layers)) {
    const path = `layers.${name}`;
    validateDatasetBackedDescriptor(layer, path, datasetIds);
    requireString(layer.units, `${path}.units`);
    requireString(layer.colorSpace, `${path}.colorSpace`);
    if (!isRecord(layer.dimensions) || !Number.isSafeInteger(layer.dimensions.width) || layer.dimensions.width <= 0 || !Number.isSafeInteger(layer.dimensions.height) || layer.dimensions.height <= 0) {
      fail(`${path}.dimensions`);
    }
    if (!isRecord(layer.channels) || Object.keys(layer.channels).length === 0) fail(`${path}.channels`);
    if (!isRecord(layer.textureSemantics)) fail(`${path}.textureSemantics`);
    requireString(layer.textureSemantics.mapping, `${path}.textureSemantics.mapping`);
    requireString(layer.textureSemantics.sampling, `${path}.textureSemantics.sampling`);
  }

  for (const [name, resource] of Object.entries(manifest.resources)) {
    const path = `resources.${name}`;
    validateDatasetBackedDescriptor(resource, path, datasetIds);
    requireString(resource.semantics, `${path}.semantics`);
  }
}

function requireEntries(manifest, groupName, names) {
  const entries = manifest?.[groupName];
  for (const name of names) {
    if (!entries || !Object.hasOwn(entries, name)) {
      throw new Error(`Earth-state manifest is missing ${groupName}.${name}`);
    }
  }
  for (const name of Object.keys(entries)) {
    if (!names.includes(name)) throw new Error(`Earth-state manifest has unsupported ${groupName}.${name}`);
  }
}

export function createEarthStateActivator({ loadManifest, loadAsset, onAssetVerified }) {
  let current;

  return {
    get current() {
      return current;
    },

    async activate(manifestUrl) {
      const manifest = await loadManifest(manifestUrl);
      validateManifest(manifest);
      const baseUrl = new URL(manifestUrl);

      const loadEntries = async (entries, role) => Object.fromEntries(await Promise.all(
        Object.entries(entries).map(async ([name, descriptor]) => {
          const url = new URL(descriptor.asset.href, baseUrl).href;
          const request = { name, role, descriptor, url };
          const loaded = await loadAsset(request);
          const asset = await verifyLoadedAsset(loaded, descriptor.asset, `${role}.${name}`);
          onAssetVerified?.(request, asset);
          return [name, asset];
        }),
      ));

      const [layers, resources] = await Promise.all([
        loadEntries(manifest.layers, 'layer'),
        loadEntries(manifest.resources, 'resource'),
      ]);

      const datasetsById = Object.fromEntries(manifest.datasets.map(dataset => [dataset.id, dataset]));
      const layerDatasets = Object.fromEntries(Object.entries(manifest.layers).map(([name, layer]) => [name, datasetsById[layer.datasetId]]));
      const activated = { manifest, layers, resources, layerDatasets };
      current = activated;
      return activated;
    },
  };
}
