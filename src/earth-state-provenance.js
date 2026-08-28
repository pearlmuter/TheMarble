import { cloudProviderMaxAgeSeconds } from './cloud-provider-selection.js';

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
  return 'Cloud source not recorded';
}

function resolveProvider(declaredProvider, dataset) {
  if (declaredProvider === 'satcorps' || declaredProvider === 'gmgsi') return declaredProvider;
  const signature = `${dataset?.id ?? ''} ${dataset?.attribution ?? ''}`.toLowerCase();
  if (signature.includes('satcorps')) return 'satcorps';
  if (signature.includes('gmgsi')) return 'gmgsi';
  return undefined;
}

function cryospherePresentation(label, layer) {
  if (!layer?.provenance) return {
    detail: `${label} · contemporary product not present in this bundle`,
    summary: `${label} contemporary product is not present.`,
  };
  const provenance = layer.provenance;
  return {
    detail: `${label} · valid ${utcDate(provenance.validAt)} · ${percent(provenance.coverage.observedFraction)}% observed · ${percent(provenance.coverage.fallbackFraction)}% seasonal fallback · source ${provenance.sourceVersion} · ${provenance.attribution}`,
    summary: `${label} is valid ${utcDate(provenance.validAt)}, ${percent(provenance.coverage.observedFraction)}% observed and ${percent(provenance.coverage.fallbackFraction)}% seasonal fallback.`,
  };
}

function surfacePresentation(surface) {
  const rolling = surface.rollingComposite;
  if (!rolling) return {
    detail: 'Seasonal surface fallback · no rolling contemporary surface composite in this bundle',
    summary: 'The surface uses a seasonal fallback with no rolling contemporary composite.',
  };
  return {
    detail: `Rolling surface · observations ${utcDate(rolling.observedFrom)} → ${utcDate(rolling.observedTo)} · ${percent(rolling.coverage.rollingFraction)}% rolling · ${percent(rolling.coverage.updatedFraction)}% refreshed · ${percent(rolling.coverage.baselineFraction)}% seasonal fallback · pixel ages ${rolling.newestPixelAgeDays ?? 'unknown'}–${rolling.oldestPixelAgeDays ?? 'unknown'} days`,
    summary: `The rolling surface covers ${utcDate(rolling.observedFrom)} through ${utcDate(rolling.observedTo)}, ${percent(rolling.coverage.rollingFraction)}% rolling and ${percent(rolling.coverage.baselineFraction)}% seasonal fallback.`,
  };
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
  let stale;
  let observed = 0;
  let modelAssisted = 0;

  if (manifest.cloudSequence) {
    const [from, to] = manifest.cloudSequence.frames;
    const provider = resolveProvider(manifest.cloudSequence.provider, cloudDataset);
    const thresholdSeconds = provider ? cloudProviderMaxAgeSeconds(provider) : undefined;
    age = ageParts(now.valueOf() - Date.parse(to.observedTo));
    stale = thresholdSeconds === undefined ? undefined : (now.valueOf() - Date.parse(to.validAt)) / 1000 > thresholdSeconds;
    observed = percent(to.coverage.observedFraction);
    modelAssisted = percent(to.coverage.modelAssistedFraction);
    cloudItems.push(`${providerName(provider)} · ${cloudDataset?.version ?? 'version not recorded'}`);
    cloudItems.push(`Observation window · ${utcWindow(to.observedFrom, to.observedTo)}`);
    cloudItems.push(thresholdSeconds === undefined
      ? `Observation age · ${age.short} old · staleness unknown (provider freshness policy unavailable)`
      : `Observation age · ${age.short} old · ${stale ? 'stale' : 'current'} (${provider === 'satcorps' ? 'SatCORPS' : 'GMGSI'} provider freshness limit ${Math.round(thresholdSeconds / 60)} min from valid time)`);
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
  const surface = surfacePresentation(manifest.layers.surfaceAlbedo);
  const snow = cryospherePresentation('Snow', manifest.layers.snowCover);
  const seaIce = cryospherePresentation('Sea ice', manifest.layers.seaIce);
  const sections = [
    { id: 'state', title: 'Active state', items: [runtimeState.detail, `Bundle · ${manifest.bundleId} · ${manifest.classification}`] },
    { id: 'clouds', title: 'Clouds', items: cloudItems },
    { id: 'surface', title: 'Surface & cryosphere', items: [surface.detail, snow.detail, seaIce.detail] },
    { id: 'datasets', title: 'Dataset versions', items: dataItems },
    { id: 'attribution', title: 'Attribution', items: attributionItems },
  ];
  const freshnessSummary = stale === undefined ? 'freshness is unknown' : stale ? 'stale' : 'current';
  const cloudSummary = manifest.cloudSequence
    ? `Cloud observations are ${age.spoken} old and ${freshnessSummary}, with ${observed}% observed and ${modelAssisted}% model-assisted coverage.`
    : 'Static bundled clouds are displayed with no interpolation or model assistance.';
  return {
    stateLabel: runtimeState.label,
    sections,
    accessibleSummary: `${runtimeState.label}. ${cloudSummary} ${surface.summary} ${snow.summary} ${seaIce.summary} ${manifest.datasets.length} dataset versions and attributions are listed in Earth data details.`,
  };
}
