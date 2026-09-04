import { ASSUMED_THICK_CLOUD_OPTICAL_DEPTH } from './cloud-render-model.js';
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

/**
 * Only SatCORPS retrieves optical depth; the manifest already says so, because a
 * bundle carries the cloudPhysics layer exactly when its provider is satcorps.
 * Everything else -- GMGSI, and the bundled static texture -- is rendered at an
 * assumed thickness, and the corner has to say that as plainly as it says which
 * cloud is model-assisted and which cryosphere is a seasonal fallback.
 */
function thicknessItem(provider) {
  if (provider === 'satcorps') {
    return 'Cloud thickness · retrieved optical depth from the cloud product; the renderer uses the retrieval, not an assumption';
  }
  const source = provider === 'gmgsi' ? 'GMGSI' : 'This cloud source';
  return `Cloud thickness · assumed · ${source} carries no retrieved optical depth, so observed opacity is mapped to an assumed deck reaching optical depth ${ASSUMED_THICK_CLOUD_OPTICAL_DEPTH} at full opacity; thin cloud stays thin`;
}

function cryospherePresentation(label, layer) {
  if (!layer?.provenance) return {
    detail: `${label} · contemporary product not present in this bundle`,
    summary: `${label} contemporary product is not present.`,
  };
  const provenance = layer.provenance;
  const observed = percent(provenance.coverage.observedFraction);
  const fallback = percent(provenance.coverage.fallbackFraction);
  // IMS is a Northern Hemisphere analysis, so half the globe is simply not seen.
  // Observed plus fallback is the whole story only when they reach 100.
  const unobserved = Math.max(0, 100 - observed - fallback);
  const [south, north] = provenance.coverage.latitudeRange ?? [];
  const band = unobserved > 0 && Number.isFinite(south) && Number.isFinite(north)
    ? ` · observed ${Math.abs(south).toFixed(1)}°${south < 0 ? 'S' : 'N'}–${north.toFixed(1)}°N`
    : '';
  const gap = unobserved > 0 ? ` · ${unobserved}% not observed` : '';
  return {
    detail: `${label} · valid ${utcDate(provenance.validAt)} · ${observed}% observed · ${fallback}% seasonal fallback${gap}${band} · source ${provenance.sourceVersion} · ${provenance.attribution}`,
    summary: `${label} is valid ${utcDate(provenance.validAt)}, ${observed}% observed and ${fallback}% seasonal fallback${unobserved > 0 ? `, with ${unobserved}% not observed` : ''}.`,
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

const MAXIMUM_REFRESH_REASON_LENGTH = 160;

/**
 * Turn whatever activation threw into one short line the panel and the smoke
 * client can carry. Discarding it made a 404, a checksum mismatch, a timeout and
 * a CORS block indistinguishable -- every one of them reached the corner as
 * `failed` and nothing else, which is why the scheduled health run could report
 * three views on a bundled fallback with no error to name.
 *
 * URLs are removed rather than shortened: a provider template can carry a
 * query-string credential, and this line is published in CI reports.
 */
export function summarizeEarthStateRefreshFailure(error) {
  const raw = typeof error === 'string' ? error : error?.message;
  const reason = String(raw ?? '')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '')
    .replace(/\s+/g, ' ')
    // A removed URL leaves the separator that introduced it dangling.
    .replace(/[\s:;,-]+$/, '')
    .trim();
  if (reason === '') return error instanceof Error && error.name ? error.name : 'unknown error';
  return reason.length > MAXIMUM_REFRESH_REASON_LENGTH
    ? `${reason.slice(0, MAXIMUM_REFRESH_REASON_LENGTH - 1).trimEnd()}…`
    : reason;
}

function failureReason(runtime) {
  return runtime.refresh === 'failed' && runtime.reason ? ` · ${runtime.reason}` : '';
}

function runtimePresentation(runtime) {
  const because = failureReason(runtime);
  if (runtime.source === 'bundled-fallback') {
    return {
      label: 'Bundled fallback · contemporary updates unavailable',
      detail: runtime.refresh === 'failed' ? `Latest refresh failed; the packaged, verified fallback remains active${because}` : 'Packaged, verified fallback is active while a contemporary bundle is sought',
    };
  }
  if (runtime.source === 'offline-cache') {
    return {
      label: 'Offline cache · verified last-known-good Earth state',
      detail: runtime.refresh === 'failed' ? `Latest refresh failed; the offline cache remains active${because}` : 'Verified offline cache is active while a newer bundle is sought',
    };
  }
  if (runtime.refresh === 'failed') {
    return { label: 'Verified last-known-good remote Earth state', detail: `Latest refresh failed; the previously verified remote bundle remains active${because}` };
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
  let unobserved = 0;

  if (manifest.cloudSequence) {
    const [from, to] = manifest.cloudSequence.frames;
    const provider = manifest.cloudSequence.provider;
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
    // Whatever the provider did not deliver is drawn as nothing at all, which
    // on a lit night side is indistinguishable from a clear sky unless the
    // corner says so. The poles are always part of it: a geostationary arc
    // cannot see them.
    const fallback = percent(to.coverage.fallbackFraction);
    unobserved = Math.max(0, 100 - observed - modelAssisted - fallback);
    const coverage = [`${observed}% observed`];
    if (fallback > 0) coverage.push(`${fallback}% static fallback`);
    if (unobserved > 0) coverage.push(`${unobserved}% not observed and left undrawn`);
    cloudItems.push(`Coverage · ${coverage.join(' · ')}`);
    const [south, north] = to.coverage.latitudeRange ?? [];
    if (Number.isFinite(south) && Number.isFinite(north)) {
      cloudItems.push(`Observed band · ${Math.abs(south).toFixed(1)}°S–${north.toFixed(1)}°N · beyond it no geostationary satellite sees the surface`);
    }
    const model = to.assistance?.model;
    cloudItems.push(model && modelAssisted > 0
      ? `Model assistance · ${modelAssisted}% model-assisted · GFS ${model.version} run ${utcTime(model.runAt)} UTC · f${String(model.forecastHour).padStart(3, '0')}`
      : 'No model assistance in the active cloud frame');
    cloudItems.push(`Crossfade interpolation · ${utcTime(from.validAt)} → ${utcTime(to.validAt)} UTC · ${manifest.cloudSequence.transitionSeconds / 60} min visual transition; observation times are not invented`);
    cloudItems.push(thicknessItem(provider));
    if (to.assistance?.polarObservation) {
      cloudItems.push(`Polar completion · ${to.assistance.polarObservation.product.toUpperCase()} ${to.assistance.polarObservation.version} · ${utcWindow(to.assistance.polarObservation.observedFrom, to.assistance.polarObservation.observedTo)}`);
    }
  } else {
    cloudItems.push(`Static cloud fallback · ${cloudDataset?.version ?? 'version not recorded'} · ${cloudDataset?.attribution ?? 'attribution not recorded'}`);
    cloudItems.push('No cloud interpolation; one static texture is displayed');
    cloudItems.push('No model assistance in this bundle');
    cloudItems.push(thicknessItem(undefined));
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
  const assumedThickness = manifest.cloudSequence?.provider === 'satcorps'
    ? ''
    : ' Cloud thickness is assumed rather than retrieved.';
  const cloudSummary = `${manifest.cloudSequence
    ? `Cloud observations are ${age.spoken} old and ${freshnessSummary}, with ${observed}% observed and ${modelAssisted}% model-assisted coverage${unobserved > 0 ? `, and ${unobserved}% not observed` : ''}.`
    : 'Static bundled clouds are displayed with no interpolation or model assistance.'}${assumedThickness}`;
  return {
    stateLabel: runtimeState.label,
    sections,
    accessibleSummary: `${runtimeState.label}. ${cloudSummary} ${surface.summary} ${snow.summary} ${seaIce.summary} ${manifest.datasets.length} dataset versions and attributions are listed in Earth data details.`,
  };
}
