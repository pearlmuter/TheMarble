export function selectEarthSurfaceForRendering(activeEarthState) {
  const surface = activeEarthState.manifest.layers.surfaceAlbedo;
  if (surface.rollingComposite) {
    return { mode: 'rolling', frames: [], fallbackAsset: activeEarthState.layers.surfaceAlbedo };
  }
  const frames = activeEarthState.seasonalLayers.surfaceAlbedo ?? [];
  return {
    mode: frames.length > 0 ? 'seasonal' : 'static',
    frames,
    fallbackAsset: frames.length === 0 ? activeEarthState.layers.surfaceAlbedo : undefined,
  };
}
