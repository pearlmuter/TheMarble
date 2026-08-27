import type { EarthStateAssetReference, EarthStateDataset, EarthStateManifest } from './earth-state.js';

export interface RollingSurfaceManifestUpdate {
  dataset: Pick<EarthStateDataset, 'id' | 'version' | 'attribution'>;
  surfaceAsset: EarthStateAssetReference;
  ageAsset: EarthStateAssetReference;
  validAt: string;
  observedFrom: string;
  observedTo: string;
  producedAt: string;
  retrievedAt: string;
  coverage: { rollingFraction: number; updatedFraction: number; baselineFraction: number };
  oldestPixelAgeDays: number | null;
  newestPixelAgeDays: number | null;
  sourceProducts: Array<'mcd43a4-nbar' | 'viirs-surface-reflectance'>;
  observationWindows: Array<{
    index: number;
    product: 'mcd43a4-nbar' | 'viirs-surface-reflectance';
    version: string;
    validAt: string;
    observedFrom: string;
    observedTo: string;
  }>;
  normalization: { method: 'robust-channel-gain-and-delta-limit'; maxDailyChange: number };
}

export function withRollingSurfaceUpdate(manifest: EarthStateManifest, update: RollingSurfaceManifestUpdate): EarthStateManifest;
