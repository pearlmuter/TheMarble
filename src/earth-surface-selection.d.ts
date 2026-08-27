import type { ActivatedEarthState } from './earth-state.js';

export function selectEarthSurfaceForRendering<LoadedAsset>(active: ActivatedEarthState<LoadedAsset>): {
  mode: 'rolling' | 'seasonal' | 'static';
  frames: Array<{ month: number; value: LoadedAsset }>;
  fallbackAsset: LoadedAsset | undefined;
};
