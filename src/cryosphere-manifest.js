function requireEqual(left, right, field) {
  if (left !== right) throw new Error(`Cryosphere compositor ${field} disagrees with daily selection`);
}

function layerDescriptor({ datasetId, units, dimensions, asset, provenance }) {
  return {
    datasetId,
    units,
    dimensions,
    colorSpace: 'linear',
    channels: {
      r: units,
      g: 'analysis confidence',
      b: 'source code: global analysis, IMS, or VIIRS refinement',
    },
    textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
    asset,
    provenance: structuredClone(provenance),
  };
}

export function addCryosphereAnalysis(manifest, { selection, metadata, snowAsset, seaIceAsset }) {
  requireEqual(metadata.validAt, selection.validAt, 'validAt');
  requireEqual(metadata.retrievedAt, selection.retrievedAt, 'retrievedAt');
  const datasetId = `daily-cryosphere-${selection.validAt.slice(0, 10)}`;
  const replacedIds = new Set([
    manifest.layers.snowCover?.datasetId,
    manifest.layers.seaIce?.datasetId,
  ].filter(Boolean));
  manifest.datasets = manifest.datasets.filter(dataset => !replacedIds.has(dataset.id));
  manifest.datasets.push({
    id: datasetId,
    version: metadata.sourceVersion,
    attribution: metadata.attribution,
    observedFrom: metadata.validAt,
    observedTo: metadata.validAt,
  });
  const provenance = {
    validAt: metadata.validAt,
    producedAt: metadata.producedAt,
    retrievedAt: metadata.retrievedAt,
    sourceVersion: metadata.sourceVersion,
    coverage: structuredClone(metadata.coverage),
    fallback: metadata.fallback,
    attribution: metadata.attribution,
  };
  manifest.layers.snowCover = layerDescriptor({
    datasetId,
    units: 'snow-covered land fraction',
    dimensions: metadata.dimensions,
    asset: snowAsset,
    provenance,
  });
  manifest.layers.seaIce = layerDescriptor({
    datasetId,
    units: 'sea-ice concentration fraction',
    dimensions: metadata.dimensions,
    asset: seaIceAsset,
    provenance,
  });
  return manifest;
}
