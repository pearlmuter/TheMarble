const PHYSICAL_LAYER_NAMES = ['cloudOpacity', 'cloudDensity', 'cloudPhysics', 'cloudAge'];

function assertMatchingMetadata(frame, metadata) {
  for (const field of ['observedFrom', 'observedTo', 'producedAt', 'version']) {
    if (frame[field] !== metadata[field]) throw new Error(`SatCORPS compositor ${field} disagrees with provider selection`);
  }
  for (const [name, selected, composed] of [
    ['coverage', frame.coverage?.observedFraction, metadata.coverage?.observedFraction],
    ['quality', frame.quality?.usableFraction, metadata.quality?.usableFraction],
  ]) {
    if (!Number.isFinite(selected) || !Number.isFinite(composed) || Math.abs(selected - composed) > .005) {
      throw new Error(`SatCORPS compositor ${name} disagrees with provider selection`);
    }
  }
}

function layerDescriptors(metadata, assets, datasetId) {
  const common = {
    datasetId,
    dimensions: metadata.dimensions,
    colorSpace: 'linear',
    textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
  };
  return {
    cloudOpacity: {
      ...common,
      units: 'observation-derived reflectance and optical transmission',
      colorSpace: 'srgb',
      channels: { l: '0.63 um reflectance appearance', a: 'optical-depth transmission opacity' },
      asset: assets.cloudOpacity,
    },
    cloudDensity: {
      ...common,
      units: 'normalized optical density, quality, and reflectance',
      channels: { r: 'optical density', g: 'retrieval quality', b: '0.63 um reflectance' },
      asset: assets.cloudDensity,
    },
    cloudPhysics: {
      ...common,
      units: 'normalized physical cloud retrieval',
      channels: { r: 'log optical depth / log(151)', g: 'thermodynamic phase', b: 'effective height / 20 km', a: 'retrieval quality' },
      asset: assets.cloudPhysics,
    },
    cloudAge: {
      ...common,
      units: 'normalized observation age',
      channels: { r: 'absolute relative observation time / 3 hours' },
      asset: assets.cloudAge,
    },
  };
}

export function addSatcorpsCloudSequence(baseManifest, { selection, composedFrames }) {
  if (selection?.provider !== 'satcorps' || !Array.isArray(selection.frames) || selection.frames.length !== 2) {
    throw new Error('SatCORPS manifest construction requires one selected two-frame SatCORPS sequence');
  }
  if (!Array.isArray(composedFrames) || composedFrames.length !== 2) {
    throw new Error('SatCORPS manifest construction requires two composed frames');
  }
  const datasetId = `nasa-satcorps-${selection.frames[1].version}`.replace(/[^a-zA-Z0-9._-]/g, '-');
  const frames = composedFrames.map((composed, index) => {
    const selected = selection.frames[index];
    assertMatchingMetadata(selected, composed.metadata);
    for (const name of PHYSICAL_LAYER_NAMES) {
      if (!composed.assets?.[name]) throw new Error(`SatCORPS compositor is missing ${name}`);
    }
    const descriptors = layerDescriptors(composed.metadata, composed.assets, datasetId);
    return {
      validAt: selected.validAt,
      observedFrom: selected.observedFrom,
      observedTo: selected.observedTo,
      producedAt: selected.producedAt,
      retrievedAt: selection.retrievedAt,
      coverage: {
        ...composed.metadata.coverage,
        usableFraction: composed.metadata.quality.usableFraction,
      },
      layers: Object.fromEntries(PHYSICAL_LAYER_NAMES.map(name => [name, {
        datasetId,
        asset: structuredClone(descriptors[name].asset),
      }])),
    };
  });

  const manifest = structuredClone(baseManifest);
  const replacedDatasetIds = new Set(PHYSICAL_LAYER_NAMES.map(name => manifest.layers?.[name]?.datasetId).filter(Boolean));
  manifest.bundleId = `source-satcorps-${frames[1].validAt}`;
  manifest.classification = 'observed';
  manifest.datasets = (manifest.datasets ?? []).filter(dataset => dataset.id !== datasetId && !replacedDatasetIds.has(dataset.id));
  manifest.datasets.push({
    id: datasetId,
    version: selection.frames[1].version,
    attribution: 'NASA Langley SatCORPS Global Cloud Composite, modified by TheMarble',
    observedFrom: frames[0].observedFrom,
    observedTo: frames[1].observedTo,
  });
  const current = layerDescriptors(composedFrames[1].metadata, composedFrames[1].assets, datasetId);
  manifest.layers = { ...manifest.layers, ...current };
  manifest.cloudSequence = { provider: 'satcorps', interpolation: 'crossfade', transitionSeconds: 300, frames };
  manifest.times = {
    observedFrom: frames[0].observedFrom,
    observedTo: frames[1].observedTo,
    validAt: frames[1].validAt,
    producedAt: frames[1].producedAt,
    retrievedAt: frames[1].retrievedAt,
  };
  return manifest;
}
