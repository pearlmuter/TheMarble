const COMPLETED_VISUAL_LAYERS = ['cloudOpacity', 'cloudDensity'];

function latestIso(values) {
  return values.filter(Boolean).reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

function earliestIso(values) {
  return values.filter(Boolean).reduce((earliest, value) => Date.parse(value) < Date.parse(earliest) ? value : earliest);
}

function provenanceDescriptor(template, datasetId, asset) {
  return {
    datasetId,
    units: 'categorical cloud-source provenance, normalized age, quality, and native contribution',
    dimensions: template.dimensions,
    colorSpace: 'linear',
    channels: {
      r: 'source class: static, GFS model, primary observation, or polar observation',
      g: 'observed age / configured freshness threshold',
      b: 'dominant source quality',
      a: 'native dominant-source contribution after one-sided seam feathering',
    },
    textureSemantics: { ...template.textureSemantics, sampling: 'nearest' },
    asset,
  };
}

function assistance(selection, staticFallback, coverage) {
  return {
    ...(selection.polarObservation && coverage.polarObservedFraction > 0 ? { polarObservation: {
      product: selection.polarObservation.product,
      version: selection.polarObservation.version,
      observedFrom: selection.polarObservation.observedFrom,
      observedTo: selection.polarObservation.observedTo,
    } } : {}),
    ...(selection.model && coverage.modelAssistedFraction > 0 ? { model: {
      product: 'gfs-total-cloud',
      version: selection.model.version,
      runAt: selection.model.runAt,
      forecastHour: selection.model.forecastHour,
    } } : {}),
    ...(staticFallback && coverage.fallbackFraction > 0 ? { staticFallback } : {}),
  };
}

export function addCloudGapCompletion(baseManifest, { thresholds, completedFrames }) {
  if (!baseManifest?.cloudSequence || !Array.isArray(baseManifest.cloudSequence.frames)
    || baseManifest.cloudSequence.frames.length !== 2) {
    throw new Error('Cloud-gap completion requires an existing two-frame cloud sequence');
  }
  if (!Array.isArray(completedFrames) || completedFrames.length !== 2) {
    throw new Error('Cloud-gap completion requires two completed frames');
  }
  const baseFrames = baseManifest.cloudSequence.frames;
  for (const [index, completed] of completedFrames.entries()) {
    if (completed.validAt !== baseFrames[index].validAt) throw new Error('Cloud-gap completion validAt disagrees with the base cloud frame');
    for (const name of [...COMPLETED_VISUAL_LAYERS, 'cloudProvenance']) {
      if (!completed.assets?.[name]) throw new Error(`Cloud-gap completion is missing ${name}`);
    }
  }

  const manifest = structuredClone(baseManifest);
  const datasetId = `cloud-gap-${completedFrames[1].validAt}`.replace(/[^a-zA-Z0-9._-]/g, '-');
  const baseDataset = manifest.datasets.find(dataset => dataset.id === manifest.layers.cloudOpacity.datasetId);
  const usedPolarFrames = completedFrames.filter(frame => frame.metadata.coverage.polarObservedFraction > 0);
  const polarProducts = [...new Set(usedPolarFrames.map(frame => frame.selection.polarObservation?.product).filter(Boolean))];
  const hasModel = completedFrames.some(frame => frame.metadata.coverage.modelAssistedFraction > 0);
  const sourceNames = [
    baseDataset?.attribution ?? 'Primary cloud observation',
    ...(polarProducts.length ? ['NASA VIIRS/MODIS polar cloud observations'] : []),
    ...(hasModel ? ['NOAA GFS total cloud cover'] : []),
    ...(completedFrames.some(frame => frame.metadata.coverage.fallbackFraction > 0) ? ['TheMarble static cloud fallback'] : []),
  ];

  manifest.datasets = manifest.datasets.filter(dataset => dataset.id !== datasetId);
  manifest.datasets.push({
    id: datasetId,
    version: completedFrames.map(frame => [
      frame.metadata.coverage.polarObservedFraction > 0 ? frame.selection.polarObservation?.version : undefined,
      frame.metadata.coverage.modelAssistedFraction > 0 ? frame.selection.model?.version : undefined,
    ].filter(Boolean).join('+')).filter(Boolean).join(' / ') || 'observation-only',
    attribution: `${sourceNames.join('; ')}, blended by TheMarble`,
    observedFrom: earliestIso(baseFrames.map((frame, index) => completedFrames[index].metadata.coverage.polarObservedFraction > 0
      ? completedFrames[index].selection.polarObservation.observedFrom : frame.observedFrom)),
    observedTo: latestIso(baseFrames.map((frame, index) => completedFrames[index].metadata.coverage.polarObservedFraction > 0
      ? completedFrames[index].selection.polarObservation.observedTo : frame.observedTo)),
  });

  const frames = baseFrames.map((base, index) => {
    const completed = completedFrames[index];
    const layers = structuredClone(base.layers);
    for (const name of COMPLETED_VISUAL_LAYERS) layers[name] = { datasetId, asset: structuredClone(completed.assets[name]) };
    layers.cloudProvenance = { datasetId, asset: structuredClone(completed.assets.cloudProvenance) };
    return {
      ...base,
      observedFrom: earliestIso([base.observedFrom, completed.metadata.coverage.polarObservedFraction > 0
        ? completed.selection.polarObservation.observedFrom : undefined]),
      observedTo: latestIso([base.observedTo, completed.metadata.coverage.polarObservedFraction > 0
        ? completed.selection.polarObservation.observedTo : undefined]),
      producedAt: completed.selection.retrievedAt,
      retrievedAt: completed.selection.retrievedAt,
      coverage: { ...structuredClone(base.coverage), ...structuredClone(completed.metadata.coverage) },
      assistance: assistance(completed.selection, completed.metadata.staticFallback, completed.metadata.coverage),
      layers,
    };
  });

  manifest.cloudSequence = {
    ...manifest.cloudSequence,
    gapCompletion: structuredClone(thresholds),
    frames,
  };
  for (const name of COMPLETED_VISUAL_LAYERS) {
    manifest.layers[name] = { ...manifest.layers[name], datasetId, asset: structuredClone(completedFrames[1].assets[name]) };
  }
  manifest.layers.cloudProvenance = provenanceDescriptor(
    manifest.layers.cloudDensity,
    datasetId,
    structuredClone(completedFrames[1].assets.cloudProvenance),
  );
  manifest.bundleId = `source-cloud-gap-${frames[1].validAt}`;
  manifest.classification = hasModel
    ? 'model-assisted'
    : frames.some(frame => frame.coverage.observedFraction > 0) ? 'observed' : 'static-fallback';
  manifest.times = {
    observedFrom: frames[0].observedFrom,
    observedTo: frames[1].observedTo,
    validAt: frames[1].validAt,
    producedAt: frames[1].producedAt,
    retrievedAt: frames[1].retrievedAt,
  };
  return manifest;
}
