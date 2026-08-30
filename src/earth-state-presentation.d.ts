import type { EarthStateAssetReference } from './earth-state.js';

export type EarthStatePresentationTierId = '8k' | '16k';
export const EARTH_STATE_PRESENTATION_TIER_DIMENSIONS: Readonly<Record<
  EarthStatePresentationTierId,
  Readonly<{ width: number; height: number }>
>>;

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
  measuredSustainedFps: number;
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

export interface EarthStatePresentationTierRequest {
  index: EarthStatePresentationIndex;
  tier: EarthStatePresentationTier;
  manifestUrl: string;
  activationStartedAt: number;
}

export function createEarthStatePresentationActivator<Value>(adapters: {
  loadIndex(url: string, options: { signal: AbortSignal }): Promise<unknown>;
  prepareTier(
    request: EarthStatePresentationTierRequest,
    options: { signal: AbortSignal },
  ): Promise<Value>;
  qualifyTier?(
    request: EarthStatePresentationTierRequest,
    value: Value,
    options: { signal: AbortSignal },
  ): Promise<void> | void;
  disposeTier?(value: Value): Promise<void> | void;
  now?(): number;
}): {
  readonly current: ActivatedEarthStatePresentation<Value> | undefined;
  activate(
    indexUrl: string,
    capabilities: EarthStatePresentationCapabilities,
  ): Promise<ActivatedEarthStatePresentation<Value>>;
};
