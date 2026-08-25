const REQUIRED_LAYERS = ['surfaceAlbedo', 'nightLights', 'cloudOpacity'];
const REQUIRED_RESOURCES = ['moonAlbedo', 'milkyWay', 'starCatalog'];
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

  requireEntries(manifest, 'layers', REQUIRED_LAYERS);
  requireEntries(manifest, 'resources', REQUIRED_RESOURCES);

  for (const [name, layer] of Object.entries(manifest.layers)) {
    const path = `layers.${name}`;
    if (!isRecord(layer)) fail(path);
    if (!datasetIds.has(layer.datasetId)) fail(`${path}.datasetId`);
    requireString(layer.units, `${path}.units`);
    requireString(layer.colorSpace, `${path}.colorSpace`);
    if (!isRecord(layer.dimensions) || !Number.isSafeInteger(layer.dimensions.width) || layer.dimensions.width <= 0 || !Number.isSafeInteger(layer.dimensions.height) || layer.dimensions.height <= 0) {
      fail(`${path}.dimensions`);
    }
    if (!isRecord(layer.channels) || Object.keys(layer.channels).length === 0) fail(`${path}.channels`);
    if (!isRecord(layer.textureSemantics)) fail(`${path}.textureSemantics`);
    requireString(layer.textureSemantics.mapping, `${path}.textureSemantics.mapping`);
    requireString(layer.textureSemantics.sampling, `${path}.textureSemantics.sampling`);
    validateAsset(layer.asset, `${path}.asset`);
  }

  for (const [name, resource] of Object.entries(manifest.resources)) {
    const path = `resources.${name}`;
    if (!isRecord(resource)) fail(path);
    if (!datasetIds.has(resource.datasetId)) fail(`${path}.datasetId`);
    requireString(resource.semantics, `${path}.semantics`);
    validateAsset(resource.asset, `${path}.asset`);
  }
}

function requireEntries(manifest, groupName, names) {
  const entries = manifest?.[groupName];
  for (const name of names) {
    if (!entries || !Object.hasOwn(entries, name)) {
      throw new Error(`Earth-state manifest is missing ${groupName}.${name}`);
    }
  }
}

export function createEarthStateActivator({ loadManifest, loadAsset }) {
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
          const asset = await loadAsset({ name, role, descriptor, url });
          return [name, asset];
        }),
      ));

      const [layers, resources] = await Promise.all([
        loadEntries(manifest.layers, 'layer'),
        loadEntries(manifest.resources, 'resource'),
      ]);

      const activated = { manifest, layers, resources };
      current = activated;
      return activated;
    },
  };
}
