import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEarthStatePresentationActivator,
  selectEarthStatePresentationTiers,
} from '../src/earth-state-presentation.js';

const checksum = () => ({ algorithm: 'sha256', value: 'a'.repeat(64) });

function tier(id, width, budgets) {
  return {
    id,
    dimensions: { width, height: width / 2 },
    requirements: {
      maxTextureSize: width,
      textureCompression: 'basis-universal',
    },
    budgets,
    manifest: {
      href: `./${id}/manifest.json`,
      mediaType: 'application/json',
      byteLength: 512,
      immutable: true,
      checksum: checksum(id),
    },
  };
}

const baselineBudgets = {
  timeToFirstCoherentGlobeMs: 4_000,
  transferBytes: 48 * 1024 * 1024,
  decodedGpuBytes: 170 * 1024 * 1024,
  shaderCompilationMs: 700,
  minimumSustainedFps: 30,
  cloudCrossfadeOverheadBytes: 48 * 1024 * 1024,
  cacheBytes: 120 * 1024 * 1024,
};

const highBudgets = {
  timeToFirstCoherentGlobeMs: 7_000,
  transferBytes: 136 * 1024 * 1024,
  decodedGpuBytes: 520 * 1024 * 1024,
  shaderCompilationMs: 900,
  minimumSustainedFps: 45,
  cloudCrossfadeOverheadBytes: 160 * 1024 * 1024,
  cacheBytes: 310 * 1024 * 1024,
};

const index = {
  schemaVersion: 1,
  bundleId: 'earth-2026-08-28T12:00:00Z',
  scientificContentId: `sha256:${'c'.repeat(64)}`,
  tiers: [
    tier('8k', 8192, baselineBudgets),
    tier('16k', 16384, highBudgets),
  ],
};

test('an integrated-GPU profile selects only the coherent 8K presentation tier', () => {
  const candidates = selectEarthStatePresentationTiers(index, {
    maxTextureSize: 8192,
    basisUniversal: true,
    decodedGpuMemoryBudgetBytes: 256 * 1024 * 1024,
    transferBudgetBytes: 80 * 1024 * 1024,
    cacheBudgetBytes: 180 * 1024 * 1024,
    measuredSustainedFps: 35,
  });

  assert.deepEqual(candidates.map(candidate => candidate.id), ['8k']);
  assert.deepEqual(candidates[0].budgets, baselineBudgets);
});

test('a capable desktop tries 16K first and retains 8K as its whole-bundle fallback', () => {
  const candidates = selectEarthStatePresentationTiers(index, {
    maxTextureSize: 16384,
    basisUniversal: true,
    decodedGpuMemoryBudgetBytes: 768 * 1024 * 1024,
    transferBudgetBytes: 192 * 1024 * 1024,
    cacheBudgetBytes: 512 * 1024 * 1024,
    measuredSustainedFps: 60,
  });

  assert.deepEqual(candidates.map(candidate => candidate.id), ['16k', '8k']);
  assert.deepEqual(candidates.map(candidate => ({
    id: candidate.id,
    dimensions: candidate.dimensions,
    timeToFirstCoherentGlobeMs: candidate.budgets.timeToFirstCoherentGlobeMs,
    shaderCompilationMs: candidate.budgets.shaderCompilationMs,
    minimumSustainedFps: candidate.budgets.minimumSustainedFps,
    cloudCrossfadeOverheadBytes: candidate.budgets.cloudCrossfadeOverheadBytes,
  })), [
    { id: '16k', dimensions: { width: 16384, height: 8192 }, timeToFirstCoherentGlobeMs: 7_000, shaderCompilationMs: 900, minimumSustainedFps: 45, cloudCrossfadeOverheadBytes: 160 * 1024 * 1024 },
    { id: '8k', dimensions: { width: 8192, height: 4096 }, timeToFirstCoherentGlobeMs: 4_000, shaderCompilationMs: 700, minimumSustainedFps: 30, cloudCrossfadeOverheadBytes: 48 * 1024 * 1024 },
  ]);
});

test('explicit memory and bandwidth limits reject 16K without inspecting a device name', () => {
  const memoryConstrained = selectEarthStatePresentationTiers(index, {
    maxTextureSize: 16384,
    basisUniversal: true,
    decodedGpuMemoryBudgetBytes: 300 * 1024 * 1024,
    transferBudgetBytes: 192 * 1024 * 1024,
    cacheBudgetBytes: 512 * 1024 * 1024,
    measuredSustainedFps: 60,
  });
  const bandwidthConstrained = selectEarthStatePresentationTiers(index, {
    maxTextureSize: 16384,
    basisUniversal: true,
    decodedGpuMemoryBudgetBytes: 768 * 1024 * 1024,
    transferBudgetBytes: 80 * 1024 * 1024,
    cacheBudgetBytes: 512 * 1024 * 1024,
    measuredSustainedFps: 60,
  });

  assert.deepEqual(memoryConstrained.map(candidate => candidate.id), ['8k']);
  assert.deepEqual(bandwidthConstrained.map(candidate => candidate.id), ['8k']);
});

test('a client without Basis Universal support cannot select a production tier', () => {
  assert.throws(() => selectEarthStatePresentationTiers(index, {
    maxTextureSize: 16384,
    basisUniversal: false,
    decodedGpuMemoryBudgetBytes: 768 * 1024 * 1024,
    transferBudgetBytes: 192 * 1024 * 1024,
    cacheBudgetBytes: 512 * 1024 * 1024,
    measuredSustainedFps: 60,
  }), /No coherent Earth presentation tier fits/);
});

test('a failed 16K preparation falls back to one complete 8K tier without mixed activation', async () => {
  const attempts = [];
  const activator = createEarthStatePresentationActivator({
    async loadIndex() {
      return index;
    },
    async prepareTier({ tier, manifestUrl }) {
      attempts.push([tier.id, manifestUrl]);
      if (tier.id === '16k') throw new Error('GPU allocation failed while preparing 16K cloud textures');
      return {
        surface: `${tier.id}:surface`,
        clouds: `${tier.id}:clouds`,
        snow: `${tier.id}:snow`,
      };
    },
  });

  const active = await activator.activate('https://earth.test/latest-presentations.json', {
    maxTextureSize: 16384,
    basisUniversal: true,
    decodedGpuMemoryBudgetBytes: 768 * 1024 * 1024,
    transferBudgetBytes: 192 * 1024 * 1024,
    cacheBudgetBytes: 512 * 1024 * 1024,
    measuredSustainedFps: 60,
  });

  assert.deepEqual(attempts, [
    ['16k', 'https://earth.test/16k/manifest.json'],
    ['8k', 'https://earth.test/8k/manifest.json'],
  ]);
  assert.equal(active.tier.id, '8k');
  assert.deepEqual(active.value, { surface: '8k:surface', clouds: '8k:clouds', snow: '8k:snow' });
  assert.equal(activator.current, active);
});

test('a measured integrated-GPU frame rate keeps a nominally 16K-capable client on 8K', () => {
  const candidates = selectEarthStatePresentationTiers(index, {
    maxTextureSize: 16384,
    basisUniversal: true,
    decodedGpuMemoryBudgetBytes: 768 * 1024 * 1024,
    transferBudgetBytes: 192 * 1024 * 1024,
    cacheBudgetBytes: 512 * 1024 * 1024,
    measuredSustainedFps: 35,
  });

  assert.deepEqual(candidates.map(candidate => candidate.id), ['8k']);
});
