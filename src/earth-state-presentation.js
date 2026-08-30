const REQUIRED_BUDGET_FIELDS = [
  'timeToFirstCoherentGlobeMs',
  'transferBytes',
  'decodedGpuBytes',
  'shaderCompilationMs',
  'minimumSustainedFps',
  'cloudCrossfadeOverheadBytes',
  'cacheBytes',
];
export const EARTH_STATE_PRESENTATION_TIER_DIMENSIONS = Object.freeze({
  '8k': Object.freeze({ width: 8192, height: 4096 }),
  '16k': Object.freeze({ width: 16384, height: 8192 }),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requirePositiveNumber(value, path) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid Earth presentation field: ${path}`);
}

export function validateEarthStatePresentationIndex(index) {
  if (!isRecord(index) || index.schemaVersion !== 1) throw new Error('Invalid Earth presentation field: schemaVersion');
  if (typeof index.bundleId !== 'string' || index.bundleId.length === 0) throw new Error('Invalid Earth presentation field: bundleId');
  if (typeof index.scientificContentId !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(index.scientificContentId)) {
    throw new Error('Invalid Earth presentation field: scientificContentId');
  }
  if (!Array.isArray(index.tiers) || index.tiers.length === 0) throw new Error('Invalid Earth presentation field: tiers');
  const ids = new Set();
  for (const [tierIndex, tier] of index.tiers.entries()) {
    const path = `tiers.${tierIndex}`;
    if (!isRecord(tier) || !Object.hasOwn(EARTH_STATE_PRESENTATION_TIER_DIMENSIONS, tier.id) || ids.has(tier.id)) {
      throw new Error(`Invalid Earth presentation field: ${path}.id`);
    }
    ids.add(tier.id);
    requirePositiveNumber(tier.dimensions?.width, `${path}.dimensions.width`);
    requirePositiveNumber(tier.dimensions?.height, `${path}.dimensions.height`);
    if (tier.dimensions.width !== EARTH_STATE_PRESENTATION_TIER_DIMENSIONS[tier.id].width || tier.dimensions.height !== EARTH_STATE_PRESENTATION_TIER_DIMENSIONS[tier.id].height) {
      throw new Error(`Invalid Earth presentation field: ${path}.dimensions`);
    }
    requirePositiveNumber(tier.requirements?.maxTextureSize, `${path}.requirements.maxTextureSize`);
    if (tier.requirements.textureCompression !== 'basis-universal') {
      throw new Error(`Invalid Earth presentation field: ${path}.requirements.textureCompression`);
    }
    for (const field of REQUIRED_BUDGET_FIELDS) requirePositiveNumber(tier.budgets?.[field], `${path}.budgets.${field}`);
    if (!isRecord(tier.manifest) || typeof tier.manifest.href !== 'string' || tier.manifest.href.length === 0
      || tier.manifest.mediaType !== 'application/json' || !Number.isSafeInteger(tier.manifest.byteLength) || tier.manifest.byteLength <= 0
      || tier.manifest.immutable !== true || tier.manifest.checksum?.algorithm !== 'sha256'
      || !/^[0-9a-f]{64}$/i.test(tier.manifest.checksum?.value ?? '')) {
      throw new Error(`Invalid Earth presentation field: ${path}.manifest`);
    }
  }
  if (!ids.has('8k')) throw new Error('Invalid Earth presentation field: tiers.8k');
}

function validateCapabilities(capabilities) {
  if (!isRecord(capabilities) || typeof capabilities.basisUniversal !== 'boolean') {
    throw new Error('Invalid Earth presentation capabilities');
  }
  for (const field of ['maxTextureSize', 'decodedGpuMemoryBudgetBytes', 'transferBudgetBytes', 'cacheBudgetBytes', 'measuredSustainedFps']) {
    requirePositiveNumber(capabilities[field], `capabilities.${field}`);
  }
}

export function selectEarthStatePresentationTiers(index, capabilities) {
  validateEarthStatePresentationIndex(index);
  validateCapabilities(capabilities);
  const candidates = index.tiers
    .filter(tier => capabilities.basisUniversal
      && capabilities.maxTextureSize >= tier.requirements.maxTextureSize
      && capabilities.decodedGpuMemoryBudgetBytes >= tier.budgets.decodedGpuBytes
      && capabilities.transferBudgetBytes >= tier.budgets.transferBytes
      && capabilities.cacheBudgetBytes >= tier.budgets.cacheBytes
      && capabilities.measuredSustainedFps >= tier.budgets.minimumSustainedFps)
    .slice()
    .sort((left, right) => right.dimensions.width - left.dimensions.width);
  if (candidates.length === 0) throw new Error('No coherent Earth presentation tier fits the measured client capabilities');
  return candidates;
}

export function createEarthStatePresentationActivator({
  loadIndex,
  prepareTier,
  qualifyTier,
  disposeTier,
  now = () => performance.now(),
}) {
  if (typeof loadIndex !== 'function' || typeof prepareTier !== 'function') {
    throw new Error('Invalid Earth presentation activator adapters');
  }
  if (qualifyTier !== undefined && typeof qualifyTier !== 'function') throw new Error('Invalid Earth presentation qualifier adapter');
  if (disposeTier !== undefined && typeof disposeTier !== 'function') throw new Error('Invalid Earth presentation disposal adapter');
  if (typeof now !== 'function') throw new Error('Invalid Earth presentation clock adapter');
  let current;
  return {
    get current() {
      return current;
    },
    async activate(indexUrl, capabilities) {
      const activationStartedAt = now();
      const controller = new AbortController();
      const index = await loadIndex(indexUrl, { signal: controller.signal });
      validateEarthStatePresentationIndex(index);
      const candidates = selectEarthStatePresentationTiers(index, capabilities);
      const failures = [];
      for (const tier of candidates) {
        const manifestUrl = new URL(tier.manifest.href, indexUrl).href;
        let value;
        try {
          const request = { index, tier, manifestUrl, activationStartedAt };
          value = await prepareTier(request, { signal: controller.signal });
          await qualifyTier?.(request, value, { signal: controller.signal });
          current = { index, tier, value };
          return current;
        } catch (error) {
          failures.push(error);
          if (value !== undefined && disposeTier) {
            try {
              await disposeTier(value);
            } catch (disposalError) {
              failures.push(disposalError);
            }
          }
        }
      }
      throw new AggregateError(failures, 'Every eligible Earth presentation tier failed to prepare coherently');
    },
  };
}
