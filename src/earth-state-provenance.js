const percent = value => Math.round((value ?? 0) * 100);

function utcDate(value) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}

function utcTime(value) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(value));
}

function utcWindow(from, to) {
  return `${utcDate(from)}, ${utcTime(from)} → ${utcTime(to)} UTC`;
}

function ageParts(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    totalMinutes,
    short: hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`,
    spoken: hours > 0 ? `${hours} hours ${minutes} minutes` : `${minutes} minutes`,
  };
}

function datasetFor(manifest, datasetId) {
  return manifest.datasets.find(dataset => dataset.id === datasetId);
}

function providerName(provider) {
  if (provider === 'satcorps') return 'NASA SatCORPS';
  if (provider === 'gmgsi') return 'NOAA GMGSI';
  return 'Cloud dataset';
}

function cryosphereLine(label, layer) {
  if (!layer?.provenance) return `${label} · contemporary product not present in this bundle`;
  const provenance = layer.provenance;
  return `${label} · valid ${utcDate(provenance.validAt)} · ${percent(provenance.coverage.observedFraction)}% observed · ${percent(provenance.coverage.fallbackFraction)}% seasonal fallback · source ${provenance.sourceVersion} · ${provenance.attribution}`;
}

function surfaceLine(surface) {
  const rolling = surface.rollingComposite;
  if (!rolling) return 'Seasonal surface fallback · no rolling contemporary surface composite in this bundle';
  return `Rolling surface · observations ${utcDate(rolling.observedFrom)} → ${utcDate(rolling.observedTo)} · ${percent(rolling.coverage.rollingFraction)}% rolling · ${percent(rolling.coverage.updatedFraction)}% refreshed · ${percent(rolling.coverage.baselineFraction)}% seasonal fallback · pixel ages ${rolling.newestPixelAgeDays ?? 'unknown'}–${rolling.oldestPixelAgeDays ?? 'unknown'} days`;
}

function runtimePresentation(runtime) {
  if (runtime.source === 'bundled-fallback') {
    return {
      label: 'Bundled fallback · contemporary updates unavailable',
      detail: runtime.refresh === 'failed' ? 'Latest refresh failed; the packaged, verified fallback remains active' : 'Packaged, verified fallback is active while a contemporary bundle is sought',
    };
  }
  if (runtime.source === 'offline-cache') {
    return {
      label: 'Offline cache · verified last-known-good Earth state',
      detail: runtime.refresh === 'failed' ? 'Latest refresh failed; the offline cache remains active' : 'Verified offline cache is active while a newer bundle is sought',
    };
  }
  if (runtime.refresh === 'failed') {
    return { label: 'Verified last-known-good remote Earth state', detail: 'Latest refresh failed; the previously verified remote bundle remains active' };
  }
  return { label: 'Verified remote Earth state', detail: runtime.refresh === 'checking' ? 'Checking for a newer verified bundle' : 'Latest refresh completed successfully' };
}

export function buildEarthStateProvenancePresentation({ manifest, now, runtime }) {
  const runtimeState = runtimePresentation(runtime);
  const cloudDatasetId = manifest.cloudSequence?.frames[1].layers.cloudOpacity.datasetId ?? manifest.layers.cloudOpacity.datasetId;
  const cloudDataset = datasetFor(manifest, cloudDatasetId);
  const cloudItems = [];
  let age;
  let stale = false;
  let observed = 0;
  let modelAssisted = 0;

  if (manifest.cloudSequence) {
    const [from, to] = manifest.cloudSequence.frames;
    const thresholdSeconds = manifest.cloudSequence.gapCompletion?.maxObservationAgeSeconds ?? 21_600;
    age = ageParts(now.valueOf() - Date.parse(to.observedTo));
    stale = age.totalMinutes * 60 > thresholdSeconds;
    observed = percent(to.coverage.observedFraction);
    modelAssisted = percent(to.coverage.modelAssistedFraction);
    cloudItems.push(`${providerName(manifest.cloudSequence.provider)} · ${cloudDataset?.version ?? 'version not recorded'}`);
    cloudItems.push(`Observation window · ${utcWindow(to.observedFrom, to.observedTo)}`);
    cloudItems.push(`Observation age · ${age.short} old · ${stale ? 'stale' : 'current'} (acceptance limit ${Math.round(thresholdSeconds / 60)} min)`);
    cloudItems.push(`Coverage · ${observed}% observed · ${percent(to.coverage.fallbackFraction)}% static fallback`);
    const model = to.assistance?.model;
    cloudItems.push(model && modelAssisted > 0
      ? `Model assistance · ${modelAssisted}% model-assisted · GFS ${model.version} run ${utcTime(model.runAt)} UTC · f${String(model.forecastHour).padStart(3, '0')}`
      : 'No model assistance in the active cloud frame');
    cloudItems.push(`Crossfade interpolation · ${utcTime(from.validAt)} → ${utcTime(to.validAt)} UTC · ${manifest.cloudSequence.transitionSeconds / 60} min visual transition; observation times are not invented`);
    if (to.assistance?.polarObservation) {
      cloudItems.push(`Polar completion · ${to.assistance.polarObservation.product.toUpperCase()} ${to.assistance.polarObservation.version} · ${utcWindow(to.assistance.polarObservation.observedFrom, to.assistance.polarObservation.observedTo)}`);
    }
  } else {
    cloudItems.push(`Static cloud fallback · ${cloudDataset?.version ?? 'version not recorded'} · ${cloudDataset?.attribution ?? 'attribution not recorded'}`);
    cloudItems.push('No cloud interpolation; one static texture is displayed');
    cloudItems.push('No model assistance in this bundle');
  }

  const dataItems = manifest.datasets.map(dataset => `${dataset.id} @ ${dataset.version}`);
  const attributionItems = [...new Set(manifest.datasets.map(dataset => dataset.attribution))];
  const sections = [
    { id: 'state', title: 'Active state', items: [runtimeState.detail, `Bundle · ${manifest.bundleId} · ${manifest.classification}`] },
    { id: 'clouds', title: 'Clouds', items: cloudItems },
    { id: 'surface', title: 'Surface & cryosphere', items: [surfaceLine(manifest.layers.surfaceAlbedo), cryosphereLine('Snow', manifest.layers.snowCover), cryosphereLine('Sea ice', manifest.layers.seaIce)] },
    { id: 'datasets', title: 'Dataset versions', items: dataItems },
    { id: 'attribution', title: 'Attribution', items: attributionItems },
  ];
  const cloudSummary = manifest.cloudSequence
    ? `Cloud observations are ${age.spoken} old and ${stale ? 'stale' : 'current'}, with ${observed}% observed and ${modelAssisted}% model-assisted coverage.`
    : 'Static bundled clouds are displayed with no interpolation or model assistance.';
  return {
    stateLabel: runtimeState.label,
    sections,
    accessibleSummary: `${runtimeState.label}. ${cloudSummary}`,
  };
}
