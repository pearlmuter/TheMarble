import type { EarthStateAssetReference } from './earth-state.js';

export type EarthStatePresentationTierId = '8k' | '16k';

export interface EarthStatePresentationBudgets {
  timeToFirstCoherentGlobeMs: number;
  transferBytes: number;
  decodedGpuBytes: number;
  shaderCompilationMs: number;
  minimumSustainedFps: number;
  cloudCrossfadeOverheadBytes: number;
  cacheBytes: number;
}

export interface EarthStatePresentationTier {
  id: EarthStatePresentationTierId;
  dimensions: { width: number; height: number };
  requirements: { maxTextureSize: number; textureCompression: 'basis-universal' };
  budgets: EarthStatePresentationBudgets;
  manifest: EarthStateAssetReference;
}

export interface EarthStatePresentationIndex {
  schemaVersion: 1;
  bundleId: string;
  scientificContentId: string;
  tiers: EarthStatePresentationTier[];
}

export interface EarthStatePresentationCapabilities {
  maxTextureSize: number;
  basisUniversal: boolean;
  decodedGpuMemoryBudgetBytes: number;
  transferBudgetBytes: number;
  cacheBudgetBytes: number;
}

export function validateEarthStatePresentationIndex(index: unknown): asserts index is EarthStatePresentationIndex;
export function selectEarthStatePresentationTiers(
  index: EarthStatePresentationIndex,
  capabilities: EarthStatePresentationCapabilities,
): EarthStatePresentationTier[];

export interface ActivatedEarthStatePresentation<Value> {
  index: EarthStatePresentationIndex;
  tier: EarthStatePresentationTier;
  value: Value;
}

export function createEarthStatePresentationActivator<Value>(adapters: {
  loadIndex(url: string, options: { signal: AbortSignal }): Promise<unknown>;
  prepareTier(
    request: { index: EarthStatePresentationIndex; tier: EarthStatePresentationTier; manifestUrl: string },
    options: { signal: AbortSignal },
  ): Promise<Value>;
}): {
  readonly current: ActivatedEarthStatePresentation<Value> | undefined;
  activate(
    indexUrl: string,
    capabilities: EarthStatePresentationCapabilities,
  ): Promise<ActivatedEarthStatePresentation<Value>>;
};
