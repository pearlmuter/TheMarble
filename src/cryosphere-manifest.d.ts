import type { EarthStateAssetReference, EarthStateManifest } from './earth-state.js';
import type { DailyCryosphereSelection } from './cryosphere-selection.js';

export interface CryosphereCompositorMetadata {
  validAt: string;
  producedAt: string;
  retrievedAt: string;
  dimensions: { width: number; height: number };
  layers: Record<'snowCover' | 'seaIce', {
    sourceVersion: string;
    coverage: { observedFraction: number; latitudeRange: [number, number]; fallbackFraction: number };
    fallback: string;
    attribution: string;
  }>;
}

export function addCryosphereAnalysis(manifest: EarthStateManifest, options: {
  selection: DailyCryosphereSelection;
  metadata: CryosphereCompositorMetadata;
  snowAsset: EarthStateAssetReference;
  seaIceAsset: EarthStateAssetReference;
}): EarthStateManifest;
