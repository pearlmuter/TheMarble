import type { EarthStateAssetReference, EarthStateDataset, EarthStateManifest, RollingSurfaceComposite, RollingSurfaceCoverage, RollingSurfaceObservationWindow } from './earth-state.js';
import type { RollingSurfaceProduct } from './rolling-surface-products.js';

export interface RollingSurfaceManifestUpdate {
  dataset: Pick<EarthStateDataset, 'id' | 'version' | 'attribution'>;
  surfaceAsset: EarthStateAssetReference;
  ageAsset: EarthStateAssetReference;
  validAt: string;
  observedFrom: string;
  observedTo: string;
  producedAt: string;
  retrievedAt: string;
  coverage: RollingSurfaceCoverage;
  oldestPixelAgeDays: number | null;
  newestPixelAgeDays: number | null;
  sourceProducts: RollingSurfaceProduct[];
  observationWindows: RollingSurfaceObservationWindow[];
  normalization: RollingSurfaceComposite['normalization'];
}

export function withRollingSurfaceUpdate(manifest: EarthStateManifest, update: RollingSurfaceManifestUpdate): EarthStateManifest;
