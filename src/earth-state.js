import { earthStateSha256 } from './earth-state-codec.js';
import { isRollingSurfaceProduct } from './rolling-surface-products.js';

export const EARTH_STATE_REQUIRED_LAYERS = ['surfaceAlbedo', 'nightLights', 'cloudOpacity', 'cloudDensity'];
export const EARTH_STATE_CRYOSPHERE_LAYERS = ['snowCover', 'seaIce'];
export const EARTH_STATE_PHYSICAL_CLOUD_LAYERS = ['cloudPhysics', 'cloudAge'];
export const EARTH_STATE_CLOUD_AUDIT_LAYERS = ['cloudProvenance'];
export const EARTH_STATE_OPTIONAL_LAYERS = [...EARTH_STATE_CRYOSPHERE_LAYERS, ...EARTH_STATE_PHYSICAL_CLOUD_LAYERS, ...EARTH_STATE_CLOUD_AUDIT_LAYERS, 'surfaceAge'];
export const EARTH_STATE_LAYER_NAMES = [...EARTH_STATE_REQUIRED_LAYERS, ...EARTH_STATE_OPTIONAL_LAYERS];
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

function sameAssetReference(left, right) {
  return left.href === right.href
    && left.mediaType === right.mediaType
    && left.byteLength === right.byteLength
    && left.checksum.value.toLowerCase() === right.checksum.value.toLowerCase();
}

function validateSeasonalCycle(layer, path, datasetIds) {
  const cycle = layer.seasonalCycle;
  if (cycle === undefined) return;
  if (!isRecord(cycle)) fail(`${path}.seasonalCycle`);
  if (cycle.interpolation !== 'linear') fail(`${path}.seasonalCycle.interpolation`);
  if (!Array.isArray(cycle.frames) || cycle.frames.length !== 12) fail(`${path}.seasonalCycle.frames`);

  const months = new Set();
  cycle.frames.forEach((frame, index) => {
    const framePath = `${path}.seasonalCycle.frames.${index}`;
    if (!isRecord(frame)) fail(framePath);
    if (!Number.isSafeInteger(frame.month) || frame.month < 1 || frame.month > 12 || months.has(frame.month)) {
      fail(`${path}.seasonalCycle.frames`);
    }
    months.add(frame.month);
    if (!datasetIds.has(frame.datasetId)) fail(`${framePath}.datasetId`);
    validateAsset(frame.asset, `${framePath}.asset`);
  });
  if (months.size !== 12) fail(`${path}.seasonalCycle.frames`);

  if (layer.rollingComposite === undefined) {
    const january = cycle.frames.find(frame => frame.month === 1);
    if (!sameAssetReference(layer.asset, january.asset)) fail(`${path}.seasonalCycle.frames.0.asset`);
  }
}

function validateFraction(value, path) {
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(path);
}

function validateRollingComposite(layer, path, datasetIds) {
  const rolling = layer.rollingComposite;
  if (rolling === undefined) return;
  if (!isRecord(rolling)) fail(`${path}.rollingComposite`);
  for (const field of TIMESTAMP_FIELDS) {
    if (typeof rolling[field] !== 'string' || Number.isNaN(Date.parse(rolling[field]))) fail(`${path}.rollingComposite.${field}`);
  }
  if (Date.parse(rolling.observedFrom) > Date.parse(rolling.observedTo)) fail(`${path}.rollingComposite.observedFrom`);
  if (!isRecord(rolling.coverage)) fail(`${path}.rollingComposite.coverage`);
  for (const field of ['rollingFraction', 'updatedFraction', 'baselineFraction']) {
    validateFraction(rolling.coverage[field], `${path}.rollingComposite.coverage.${field}`);
  }
  if (Math.abs(rolling.coverage.rollingFraction + rolling.coverage.baselineFraction - 1) > 1e-6) {
    fail(`${path}.rollingComposite.coverage`);
  }
  if (rolling.coverage.updatedFraction > rolling.coverage.rollingFraction) fail(`${path}.rollingComposite.coverage.updatedFraction`);
  for (const field of ['oldestPixelAgeDays', 'newestPixelAgeDays']) {
    const value = rolling[field];
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value >= 65535)) fail(`${path}.rollingComposite.${field}`);
  }
  if (rolling.coverage.rollingFraction === 0 && (rolling.oldestPixelAgeDays !== null || rolling.newestPixelAgeDays !== null)) {
    fail(`${path}.rollingComposite.oldestPixelAgeDays`);
  }
  if (!Array.isArray(rolling.sourceProducts) || rolling.sourceProducts.some(product => !isRollingSurfaceProduct(product))) {
    fail(`${path}.rollingComposite.sourceProducts`);
  }
  if (!Array.isArray(rolling.observationWindows)) fail(`${path}.rollingComposite.observationWindows`);
  const windowIndices = new Set();
  rolling.observationWindows.forEach((window, index) => {
    const windowPath = `${path}.rollingComposite.observationWindows.${index}`;
    if (!isRecord(window) || !Number.isSafeInteger(window.index) || window.index < 1 || window.index > 65534 || windowIndices.has(window.index)) fail(`${windowPath}.index`);
    windowIndices.add(window.index);
    if (!isRollingSurfaceProduct(window.product)) fail(`${windowPath}.product`);
    requireString(window.version, `${windowPath}.version`);
    for (const field of ['validAt', 'observedFrom', 'observedTo']) {
      if (typeof window[field] !== 'string' || Number.isNaN(Date.parse(window[field]))) fail(`${windowPath}.${field}`);
    }
    if (Date.parse(window.observedFrom) > Date.parse(window.observedTo)) fail(`${windowPath}.observedFrom`);
  });
  const windowProducts = new Set(rolling.observationWindows.map(window => window.product));
  if (new Set(rolling.sourceProducts).size !== rolling.sourceProducts.length || windowProducts.size !== rolling.sourceProducts.length || rolling.sourceProducts.some(product => !windowProducts.has(product))) {
    fail(`${path}.rollingComposite.sourceProducts`);
  }
  if (rolling.coverage.rollingFraction > 0 && rolling.observationWindows.length === 0) fail(`${path}.rollingComposite.observationWindows`);
  if (rolling.coverage.rollingFraction === 0 && rolling.observationWindows.length !== 0) fail(`${path}.rollingComposite.observationWindows`);
  if (rolling.oldestPixelAgeDays !== null && rolling.newestPixelAgeDays !== null && rolling.oldestPixelAgeDays < rolling.newestPixelAgeDays) {
    fail(`${path}.rollingComposite.oldestPixelAgeDays`);
  }
  if (!isRecord(rolling.normalization) || rolling.normalization.method !== 'robust-channel-gain-delta-limit-and-inward-feather' || !Number.isFinite(rolling.normalization.maxDailyChange) || rolling.normalization.maxDailyChange < 0
    || !Number.isSafeInteger(rolling.normalization.seamFeatherPixels) || rolling.normalization.seamFeatherPixels < 0
    || !Array.isArray(rolling.normalization.gainRange) || rolling.normalization.gainRange.length !== 2
    || rolling.normalization.gainRange[0] !== 0.75 || rolling.normalization.gainRange[1] !== 1.25) {
    fail(`${path}.rollingComposite.normalization`);
  }
  if (!datasetIds.has(layer.datasetId)) fail(`${path}.datasetId`);
}

function validateCoverage(coverage, path) {
  if (!isRecord(coverage)
    || !Number.isFinite(coverage.observedFraction)
    || coverage.observedFraction < 0
    || coverage.observedFraction > 1
    || !Array.isArray(coverage.latitudeRange)
    || coverage.latitudeRange.length !== 2
    || !coverage.latitudeRange.every(Number.isFinite)
    || coverage.latitudeRange[0] < -90
    || coverage.latitudeRange[1] > 90
    || coverage.latitudeRange[0] >= coverage.latitudeRange[1]) {
    fail(path);
  }
}

function validateCloudSequence(manifest, datasetIds) {
  const sequence = manifest.cloudSequence;
  if (sequence === undefined) return;
  if (!isRecord(sequence)) fail('cloudSequence');
  const provider = sequence.provider ?? 'gmgsi';
  if (!['gmgsi', 'satcorps'].includes(provider)) fail('cloudSequence.provider');
  const gapCompletion = sequence.gapCompletion;
  if (gapCompletion !== undefined) {
    if (!isRecord(gapCompletion)
      || !Number.isSafeInteger(gapCompletion.maxObservationAgeSeconds) || gapCompletion.maxObservationAgeSeconds <= 0
      || !Number.isFinite(gapCompletion.minObservationQuality) || gapCompletion.minObservationQuality < 0 || gapCompletion.minObservationQuality > 1
      || !Number.isSafeInteger(gapCompletion.seamBlendPixels) || gapCompletion.seamBlendPixels < 0) {
      fail('cloudSequence.gapCompletion');
    }
  }
  const layerNames = provider === 'satcorps'
    ? ['cloudOpacity', 'cloudDensity', ...EARTH_STATE_PHYSICAL_CLOUD_LAYERS]
    : ['cloudOpacity', 'cloudDensity'];
  if (gapCompletion) layerNames.push(...EARTH_STATE_CLOUD_AUDIT_LAYERS);
  if (sequence.interpolation !== 'crossfade') fail('cloudSequence.interpolation');
  if (!Number.isSafeInteger(sequence.transitionSeconds) || sequence.transitionSeconds <= 0) {
    fail('cloudSequence.transitionSeconds');
  }
  if (!Array.isArray(sequence.frames) || sequence.frames.length !== 2) fail('cloudSequence.frames');

  for (const [index, frame] of sequence.frames.entries()) {
    const path = `cloudSequence.frames.${index}`;
    if (!isRecord(frame)) fail(path);
    for (const field of TIMESTAMP_FIELDS) {
      const value = frame[field];
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${path}.${field}`);
    }
    validateCoverage(frame.coverage, `${path}.coverage`);
    for (const field of ['visibleOptimalFraction', 'longwaveOptimalFraction']) {
      const fraction = frame.coverage[field];
      if (fraction !== undefined && (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)) {
        fail(`${path}.coverage.${field}`);
      }
    }
    if (!isRecord(frame.layers)) fail(`${path}.layers`);
    for (const name of Object.keys(frame.layers)) {
      if (!layerNames.includes(name)) fail(`${path}.layers.${name}`);
    }
    for (const name of layerNames) {
      const descriptor = frame.layers[name];
      if (!isRecord(descriptor) || !datasetIds.has(descriptor.datasetId)) fail(`${path}.layers.${name}.datasetId`);
      validateAsset(descriptor.asset, `${path}.layers.${name}.asset`);
    }
    if (provider === 'satcorps' && (!Number.isFinite(frame.coverage.usableFraction)
      || frame.coverage.usableFraction < .7 || frame.coverage.usableFraction > 1)) {
      fail(`${path}.coverage.usableFraction`);
    }
    if (gapCompletion) {
      for (const field of ['primaryObservedFraction', 'polarObservedFraction', 'modelAssistedFraction', 'fallbackFraction']) {
        const fraction = frame.coverage[field];
        if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) fail(`${path}.coverage.${field}`);
      }
      if (Math.abs(frame.coverage.primaryObservedFraction + frame.coverage.polarObservedFraction
        - frame.coverage.observedFraction) > 0.001) fail(`${path}.coverage.observedFraction`);
      const total = frame.coverage.observedFraction + frame.coverage.modelAssistedFraction + frame.coverage.fallbackFraction;
      if (Math.abs(total - 1) > 0.001) fail(`${path}.coverage`);
      if (!isRecord(frame.assistance)) fail(`${path}.assistance`);
      const model = frame.assistance.model;
      if (frame.coverage.modelAssistedFraction > 0) {
        if (!isRecord(model) || model.product !== 'gfs-total-cloud') fail(`${path}.assistance.model`);
        requireString(model.version, `${path}.assistance.model.version`);
        if (typeof model.runAt !== 'string' || Number.isNaN(Date.parse(model.runAt))) fail(`${path}.assistance.model.runAt`);
        if (!Number.isSafeInteger(model.forecastHour) || model.forecastHour < 0
          || Date.parse(frame.validAt) - Date.parse(model.runAt) !== model.forecastHour * 60 * 60 * 1000) {
          fail(`${path}.assistance.model.forecastHour`);
        }
      } else if (model !== undefined) fail(`${path}.assistance.model`);
      const polar = frame.assistance.polarObservation;
      if (polar !== undefined) {
        if (!isRecord(polar) || !['viirs-cloud', 'modis-cloud'].includes(polar.product)) fail(`${path}.assistance.polarObservation`);
        requireString(polar.version, `${path}.assistance.polarObservation.version`);
        for (const field of ['observedFrom', 'observedTo']) {
          if (typeof polar[field] !== 'string' || Number.isNaN(Date.parse(polar[field]))) fail(`${path}.assistance.polarObservation.${field}`);
        }
        if (Date.parse(polar.observedFrom) > Date.parse(polar.observedTo)
          || Date.parse(polar.observedTo) > Date.parse(frame.validAt)
          || Date.parse(frame.validAt) - Date.parse(polar.observedTo) > gapCompletion.maxObservationAgeSeconds * 1000) {
          fail(`${path}.assistance.polarObservation.observedTo`);
        }
      }
      if (frame.coverage.fallbackFraction > 0) requireString(frame.assistance.staticFallback, `${path}.assistance.staticFallback`);
    } else if (frame.assistance !== undefined) fail(`${path}.assistance`);
    const observedFrom = Date.parse(frame.observedFrom);
    const observedTo = Date.parse(frame.observedTo);
    const validAt = Date.parse(frame.validAt);
    const producedAt = Date.parse(frame.producedAt);
    const retrievedAt = Date.parse(frame.retrievedAt);
    if (!(observedFrom <= validAt && validAt <= observedTo && observedTo <= producedAt && producedAt <= retrievedAt)) {
      fail(`${path}.observedFrom`);
    }
    const validDate = new Date(validAt);
    const validMinutes = [0];
    if (!validMinutes.includes(validDate.getUTCMinutes()) || validDate.getUTCSeconds() !== 0 || validDate.getUTCMilliseconds() !== 0) {
      fail(`${path}.validAt`);
    }
  }

  if (gapCompletion) {
    const expectedClassification = sequence.frames.some(frame => frame.coverage.modelAssistedFraction > 0)
      ? 'model-assisted'
      : sequence.frames.some(frame => frame.coverage.observedFraction > 0) ? 'observed' : 'static-fallback';
    if (manifest.classification !== expectedClassification) fail('classification');
  }

  const cadenceMs = 60 * 60 * 1000;
  if (Date.parse(sequence.frames[1].validAt) - Date.parse(sequence.frames[0].validAt) !== cadenceMs) {
    fail('cloudSequence.frames.1.validAt');
  }

  const latest = sequence.frames[1];
  for (const name of layerNames) {
    if (!manifest.layers[name]) fail(`layers.${name}`);
    if (manifest.layers[name].datasetId !== latest.layers[name].datasetId
      || !sameAssetReference(manifest.layers[name].asset, latest.layers[name].asset)) {
      fail(`cloudSequence.frames.1.layers.${name}.asset`);
    }
  }
  const expectedManifestTimes = {
    observedFrom: sequence.frames[0].observedFrom,
    observedTo: latest.observedTo,
    validAt: latest.validAt,
    producedAt: latest.producedAt,
    retrievedAt: latest.retrievedAt,
  };
  for (const [field, expected] of Object.entries(expectedManifestTimes)) {
    if (manifest.times[field] !== expected) fail(`times.${field}`);
  }
}

function validateCryosphereLayers(manifest) {
  const hasSnow = Object.hasOwn(manifest.layers, 'snowCover');
  const hasSeaIce = Object.hasOwn(manifest.layers, 'seaIce');
  if (hasSnow !== hasSeaIce) fail(hasSnow ? 'layers.seaIce' : 'layers.snowCover');
  if (!hasSnow) return;
  for (const name of EARTH_STATE_CRYOSPHERE_LAYERS) {
    const provenance = manifest.layers[name].provenance;
    const path = `layers.${name}.provenance`;
    if (!isRecord(provenance)) fail(path);
    for (const field of ['validAt', 'producedAt', 'retrievedAt']) {
      if (typeof provenance[field] !== 'string' || Number.isNaN(Date.parse(provenance[field]))) fail(`${path}.${field}`);
    }
    if (!(Date.parse(provenance.validAt) <= Date.parse(provenance.producedAt)
      && Date.parse(provenance.producedAt) <= Date.parse(provenance.retrievedAt))) fail(`${path}.validAt`);
    for (const field of ['sourceVersion', 'fallback', 'attribution']) requireString(provenance[field], `${path}.${field}`);
    const coverage = provenance.coverage;
    validateCoverage(coverage, `${path}.coverage`);
    if (!Number.isFinite(coverage.fallbackFraction) || coverage.fallbackFraction < 0 || coverage.fallbackFraction > 1) {
      fail(`${path}.coverage.fallbackFraction`);
    }
  }
}

function validatePhysicalCloudLayers(manifest) {
  const hasPhysics = Object.hasOwn(manifest.layers, 'cloudPhysics');
  const hasAge = Object.hasOwn(manifest.layers, 'cloudAge');
  if (hasPhysics !== hasAge) fail(hasPhysics ? 'layers.cloudAge' : 'layers.cloudPhysics');
  if (manifest.cloudSequence?.provider === 'satcorps' && !hasPhysics) fail('layers.cloudPhysics');
  if (hasPhysics && manifest.cloudSequence?.provider !== 'satcorps') fail('cloudSequence.provider');
}

async function verifyLoadedAsset(loaded, reference, path) {
  if (!isRecord(loaded) || !('value' in loaded) || !(loaded.bytes instanceof Uint8Array)) {
    throw new Error(`Earth-state loader did not return verifiable bytes for ${path}`);
  }
  if (loaded.bytes.byteLength !== reference.byteLength) {
    throw new Error(`Earth-state asset byteLength mismatch for ${path}`);
  }
  const actualChecksum = await earthStateSha256(loaded.bytes);
  if (actualChecksum !== reference.checksum.value.toLowerCase()) {
    throw new Error(`Earth-state asset checksum mismatch for ${path}`);
  }
  return loaded.value;
}

export function validateEarthStateManifest(manifest) {
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

  requireEntries(manifest, 'layers', EARTH_STATE_REQUIRED_LAYERS, EARTH_STATE_LAYER_NAMES);
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
    if (name === 'surfaceAlbedo') {
      validateRollingComposite(layer, path, datasetIds);
      validateSeasonalCycle(layer, path, datasetIds);
    }
    else if (layer.seasonalCycle !== undefined) fail(`${path}.seasonalCycle`);
    if (!EARTH_STATE_CRYOSPHERE_LAYERS.includes(name) && layer.provenance !== undefined) fail(`${path}.provenance`);
  }

  const rollingSurface = manifest.layers.surfaceAlbedo.rollingComposite;
  const surfaceAge = manifest.layers.surfaceAge;
  if (rollingSurface !== undefined && surfaceAge === undefined) fail('layers.surfaceAge');
  if (rollingSurface === undefined && surfaceAge !== undefined) fail('layers.surfaceAge');
  if (surfaceAge !== undefined) {
    if (surfaceAge.datasetId !== manifest.layers.surfaceAlbedo.datasetId) fail('layers.surfaceAge.datasetId');
    if (surfaceAge.dimensions.width !== manifest.layers.surfaceAlbedo.dimensions.width || surfaceAge.dimensions.height !== manifest.layers.surfaceAlbedo.dimensions.height) {
      fail('layers.surfaceAge.dimensions');
    }
  }

  for (const [name, resource] of Object.entries(manifest.resources)) {
    const path = `resources.${name}`;
    validateDatasetBackedDescriptor(resource, path, datasetIds);
    requireString(resource.semantics, `${path}.semantics`);
  }

  validateCloudSequence(manifest, datasetIds);
  validateCryosphereLayers(manifest);
  validatePhysicalCloudLayers(manifest);
}

export function validateEarthStateLatest(latest) {
  if (!isRecord(latest)) fail('latest');
  if (latest.schemaVersion !== 1) fail('latest.schemaVersion');
  requireString(latest.bundleId, 'latest.bundleId');
  validateAsset(latest.manifest, 'latest.manifest');
  if (latest.manifest.mediaType !== 'application/json') fail('latest.manifest.mediaType');
}

function requireEntries(manifest, groupName, names, supportedNames = names) {
  const entries = manifest?.[groupName];
  for (const name of names) {
    if (!entries || !Object.hasOwn(entries, name)) {
      throw new Error(`Earth-state manifest is missing ${groupName}.${name}`);
    }
  }
  for (const name of Object.keys(entries)) {
    if (!supportedNames.includes(name)) throw new Error(`Earth-state manifest has unsupported ${groupName}.${name}`);
  }
}

export function createEarthStateActivator({ loadDocument, loadAsset, timeoutMs = 120_000 }) {
  let current;

  const withinDeadline = async operation => {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Earth-state activation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([operation(controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  };

  const activateManifest = async (manifest, manifestUrl, signal) => {
    validateEarthStateManifest(manifest);
    const baseUrl = new URL(manifestUrl);

    const loadEntries = async (entries, role) => Object.fromEntries(await Promise.all(
      Object.entries(entries).map(async ([name, descriptor]) => {
        const url = new URL(descriptor.asset.href, baseUrl).href;
        const request = { name, role, descriptor, url };
        const loaded = await loadAsset(request, { signal });
        const asset = await verifyLoadedAsset(loaded, descriptor.asset, `${role}.${name}`);
        return [name, asset];
      }),
    ));

    const [layers, resources] = await Promise.all([
      loadEntries(manifest.layers, 'layer'),
      loadEntries(manifest.resources, 'resource'),
    ]);

    const seasonalLayers = {};
    const seasonalSurface = manifest.layers.surfaceAlbedo;
    if (seasonalSurface.seasonalCycle) {
      const frames = [];
      for (const frame of seasonalSurface.seasonalCycle.frames) {
        if (sameAssetReference(seasonalSurface.asset, frame.asset)) {
          frames.push({ month: frame.month, value: layers.surfaceAlbedo });
          continue;
        }
        const descriptor = { ...seasonalSurface, datasetId: frame.datasetId, asset: frame.asset };
        delete descriptor.seasonalCycle;
        const url = new URL(frame.asset.href, baseUrl).href;
        const request = { name: 'surfaceAlbedo', role: 'seasonal-layer-frame', month: frame.month, descriptor, url };
        const loaded = await loadAsset(request, { signal });
        const value = await verifyLoadedAsset(loaded, frame.asset, `seasonalLayers.surfaceAlbedo.${frame.month}`);
        frames.push({ month: frame.month, value });
      }
      seasonalLayers.surfaceAlbedo = frames;
    }

    let cloudSequence;
    if (manifest.cloudSequence) {
      const frames = [];
      for (const [frameIndex, frame] of manifest.cloudSequence.frames.entries()) {
        const frameLayers = {};
        for (const name of Object.keys(frame.layers)) {
          const frameDescriptor = frame.layers[name];
          if (sameAssetReference(manifest.layers[name].asset, frameDescriptor.asset)) {
            frameLayers[name] = layers[name];
            continue;
          }
          const descriptor = { ...manifest.layers[name], datasetId: frameDescriptor.datasetId, asset: frameDescriptor.asset };
          const url = new URL(frameDescriptor.asset.href, baseUrl).href;
          const request = { name, role: 'cloud-observation-frame', frameIndex, descriptor, url };
          const loaded = await loadAsset(request, { signal });
          frameLayers[name] = await verifyLoadedAsset(
            loaded,
            frameDescriptor.asset,
            `cloudSequence.frames.${frameIndex}.layers.${name}`,
          );
        }
        frames.push({ ...frame, layers: frameLayers });
      }
      cloudSequence = { ...manifest.cloudSequence, frames };
    }

    const datasetsById = Object.fromEntries(manifest.datasets.map(dataset => [dataset.id, dataset]));
    const layerDatasets = Object.fromEntries(Object.entries(manifest.layers).map(([name, layer]) => [name, datasetsById[layer.datasetId]]));
    const activated = { manifest, layers, resources, seasonalLayers, cloudSequence, layerDatasets };
    if (signal.aborted) throw new Error('Earth-state activation was aborted');
    current = activated;
    return activated;
  };

  return {
    get current() {
      return current;
    },

    async activate(manifestUrl) {
      return withinDeadline(async signal => {
        const document = await loadDocument(manifestUrl, { signal });
        if (!isRecord(document) || document.mediaType !== 'application/json') {
          throw new Error('Earth-state manifest document media type mismatch');
        }
        return activateManifest(document.value, manifestUrl, signal);
      });
    },

    async activateLatest(latestUrl) {
      return withinDeadline(async signal => {
        const latestDocument = await loadDocument(latestUrl, { signal });
        if (!isRecord(latestDocument) || latestDocument.mediaType !== 'application/json' || !('value' in latestDocument)) {
          throw new Error('Earth-state latest document is invalid');
        }
        validateEarthStateLatest(latestDocument.value);
        const latest = latestDocument.value;
        if (current?.manifest.bundleId === latest.bundleId) return current;

        const manifestUrl = new URL(latest.manifest.href, latestUrl).href;
        const manifestDocument = await loadDocument(manifestUrl, { signal });
        if (!isRecord(manifestDocument) || manifestDocument.mediaType !== latest.manifest.mediaType) {
          throw new Error('Earth-state published manifest media type mismatch');
        }
        const manifest = await verifyLoadedAsset(manifestDocument, latest.manifest, 'latest.manifest');
        validateEarthStateManifest(manifest);
        if (manifest.bundleId !== latest.bundleId) throw new Error('Earth-state latest bundleId mismatch');
        return activateManifest(manifest, manifestUrl, signal);
      });
    },
  };
}
