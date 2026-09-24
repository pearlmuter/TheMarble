import type { ActivatedEarthState, SeasonalSurfaceFrame } from './earth-state.js';

export function selectEarthSurfaceForRendering<LoadedAsset>(active: ActivatedEarthState<LoadedAsset>): {
  mode: 'rolling' | 'seasonal' | 'static';
  frames: Array<SeasonalSurfaceFrame<LoadedAsset>>;
  fallbackAsset: LoadedAsset | undefined;
};
