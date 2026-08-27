export function withRollingSurfaceUpdate(baseManifest, update) {
  const manifest = structuredClone(baseManifest);
  const surface = manifest.layers.surfaceAlbedo;
  const rollingFraction = update.coverage.rollingFraction;
  manifest.classification = rollingFraction > 0 ? 'observed' : 'static-fallback';
  manifest.datasets = [
    ...manifest.datasets.filter(dataset => dataset.id !== update.dataset.id),
    {
      ...update.dataset,
      observedFrom: update.observedFrom,
      observedTo: update.observedTo,
    },
  ];
  surface.datasetId = update.dataset.id;
  surface.asset = update.surfaceAsset;
  surface.rollingComposite = {
    validAt: update.validAt,
    observedFrom: update.observedFrom,
    observedTo: update.observedTo,
    producedAt: update.producedAt,
    retrievedAt: update.retrievedAt,
    coverage: { ...update.coverage },
    oldestPixelAgeDays: update.oldestPixelAgeDays,
    newestPixelAgeDays: update.newestPixelAgeDays,
    sourceProducts: [...update.sourceProducts],
    observationWindows: update.observationWindows.map(window => ({ ...window })),
    normalization: { ...update.normalization },
  };
  manifest.layers.surfaceAge = {
    datasetId: update.dataset.id,
    units: 'encoded age, source class, and quality',
    dimensions: { ...surface.dimensions },
    colorSpace: 'linear',
    channels: {
      rg: 'uint16 age in whole days; 65535 means seasonal baseline',
      ba: 'uint16 observation-window index; 0 means seasonal baseline',
    },
    textureSemantics: { mapping: 'equirectangular', sampling: 'nearest' },
    asset: update.ageAsset,
  };
  return manifest;
}
