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
    version: [...new Set(Object.values(metadata.layers).map(layer => layer.sourceVersion))].join(' | '),
    attribution: [...new Set(Object.values(metadata.layers).map(layer => layer.attribution))].join(' | '),
    observedFrom: metadata.validAt,
    observedTo: metadata.validAt,
  });
  const provenance = name => ({
    validAt: metadata.validAt,
    producedAt: metadata.producedAt,
    retrievedAt: metadata.retrievedAt,
    ...structuredClone(metadata.layers[name]),
  });
  manifest.layers.snowCover = layerDescriptor({
    datasetId,
    units: 'snow-covered land fraction',
    dimensions: metadata.dimensions,
    asset: snowAsset,
    provenance: provenance('snowCover'),
  });
  manifest.layers.seaIce = layerDescriptor({
    datasetId,
    units: 'sea-ice concentration fraction',
    dimensions: metadata.dimensions,
    asset: seaIceAsset,
    provenance: provenance('seaIce'),
  });
  return manifest;
}
