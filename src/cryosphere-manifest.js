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
  const contributors = [selection.analysis?.northernPrimary, selection.analysis?.globalFallback?.snow,
    selection.analysis?.globalFallback?.seaIce, selection.refinement,
    ...(selection.analysis?.seaIceConcentration ?? [])].filter(Boolean);
  const starts = [metadata.validAt, ...contributors.map(source => source.observedFrom ?? source.validAt).filter(Boolean)].sort();
  const ends = [metadata.validAt, ...contributors.map(source => source.observedTo ?? source.validAt).filter(Boolean)].sort();
  manifest.datasets.push({
    id: datasetId,
    version: [...new Set(Object.values(metadata.layers).map(layer => layer.sourceVersion))].join(' | '),
    attribution: [...new Set(Object.values(metadata.layers).map(layer => layer.attribution))].join(' | '),
    observedFrom: starts[0],
    observedTo: ends.at(-1),
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
    units: metadata.layers.seaIce.interpretation === 'categorical-extent' ? 'categorical ice presence (not concentration)' : metadata.layers.seaIce.interpretation ? 'sea-ice concentration with categorical extent fallback' : 'sea-ice concentration fraction',
    dimensions: metadata.dimensions,
    asset: seaIceAsset,
    provenance: provenance('seaIce'),
  });
  manifest.layers.seaIce.channels.b = 'source code: 0 unknown, 1/3 global analysis, 2/3 IMS extent, 1 OSI SAF concentration';
  return manifest;
}
