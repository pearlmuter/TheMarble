import { cloudProviderMaxAgeSeconds } from './cloud-provider-selection.js';
import { adjacentCloudHoursProblem } from './earth-state-feed-orchestration.js';
import { EARTH_STATE_CRYOSPHERE_LAYERS } from './earth-state.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_EARTH_STATE_ACCEPTANCE_POLICY = Object.freeze({
  minimumCloudObservedFraction: 0.5,
  maximumCryosphereAgeDays: 3,
  requireCryosphere: true,
});
const CRYOSPHERE_LAYERS = EARTH_STATE_CRYOSPHERE_LAYERS;
const REQUIRED_PROVENANCE = ['validAt', 'producedAt', 'sourceVersion', 'attribution'];
// 'remote' is accepted because a client that had already activated a bundle keeps it as
// last-known-good; the required `refresh: failed` below is what proves the pointer was refused.
const ACCEPTED_DEGRADED_SOURCES = new Set(['bundled-fallback', 'offline-cache', 'remote']);

function parseInstant(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isNaN(parsed) ? undefined : parsed;
}

function checkClouds(manifest, checkedAtMs, policy, failures) {
  const sequence = manifest.cloudSequence;
  const frames = sequence?.frames ?? [];
  if (frames.length === 0) {
    failures.push('The served Earth state carries no cloud sequence, so it does not show two recent observed frames');
    return undefined;
  }
  const hours = frames.map(frame => frame.validAt);
  const sequenceProblem = adjacentCloudHoursProblem(hours);
  if (sequenceProblem) {
    failures.push(`The served cloud frames ${sequenceProblem}`);
    return undefined;
  }
  const to = parseInstant(hours[1]);

  const maximumAgeSeconds = cloudProviderMaxAgeSeconds(sequence.provider);
  if (!Number.isFinite(maximumAgeSeconds)) {
    failures.push(`The served cloud sequence names provider "${sequence.provider ?? 'none'}", which has no documented freshness policy`);
  }
  const ageMinutes = Math.round((checkedAtMs - to) / 60_000);
  if (Number.isFinite(maximumAgeSeconds) && ageMinutes * 60 > maximumAgeSeconds) {
    failures.push(`The served cloud observations are ${ageMinutes} minutes old, beyond the ${Math.round(maximumAgeSeconds / 60)} minute ${sequence.provider} freshness limit`);
  }
  for (const frame of frames) {
    if (!parseInstant(frame.observedFrom) || !parseInstant(frame.observedTo)) {
      failures.push(`The served cloud frame ${frame.validAt} does not carry a genuine observation window`);
    }
    const observed = frame.coverage?.observedFraction;
    if (!Number.isFinite(observed) || observed < policy.minimumCloudObservedFraction) {
      failures.push(`The served cloud frame ${frame.validAt} has ${Math.round((observed ?? 0) * 100)}% observed coverage, which is not an observation-led state`);
    }
  }

  return {
    provider: sequence.provider,
    hours,
    validAt: hours[1],
    observedFrom: frames[0].observedFrom,
    observedTo: frames[1].observedTo,
    ageMinutes,
    observedFraction: frames[1].coverage?.observedFraction,
    modelAssistedFraction: frames[1].coverage?.modelAssistedFraction,
  };
}

function checkCryosphere(manifest, checkedAtMs, policy, failures, waived) {
  const present = CRYOSPHERE_LAYERS.filter(layer => manifest.layers?.[layer]?.provenance !== undefined);
  const missing = CRYOSPHERE_LAYERS.filter(layer => !present.includes(layer));
  if (missing.length > 0) {
    // Waiving this records that the layer is absent; it never fabricates one.
    const message = `The served Earth state is missing paired daily ${missing.join(' and ')} provenance`;
    if (policy.requireCryosphere) failures.push(message);
    else waived.push(message);
    return undefined;
  }

  for (const layer of CRYOSPHERE_LAYERS) {
    const provenance = manifest.layers[layer].provenance;
    for (const field of REQUIRED_PROVENANCE) {
      if (typeof provenance[field] !== 'string' || provenance[field].trim() === '') {
        failures.push(`The served ${layer} provenance is missing ${field}`);
      }
    }
    if (typeof provenance.attribution === 'string' && provenance.attribution.trim() !== ''
      && !provenance.attribution.includes('modified by TheMarble')) {
      failures.push(`The served ${layer} attribution "${provenance.attribution}" presents a reconstruction as unaltered provider imagery; it must say modified by TheMarble`);
    }
    if (!Number.isFinite(provenance.coverage?.observedFraction) || !Number.isFinite(provenance.coverage?.fallbackFraction)) {
      failures.push(`The served ${layer} provenance is missing coverage fractions`);
    }
  }

  const days = CRYOSPHERE_LAYERS.map(layer => manifest.layers[layer].provenance.validAt);
  if (days[0] !== days[1]) {
    failures.push(`The served snow (${days[0]}) and sea ice (${days[1]}) do not come from the same analysis day`);
    return undefined;
  }
  const validAtMs = parseInstant(days[0]);
  if (validAtMs === undefined) {
    failures.push(`The served cryosphere analysis time ${days[0]} is not a valid instant`);
    return undefined;
  }
  const ageDays = Math.floor((checkedAtMs - validAtMs) / DAY_MS);
  if (ageDays > policy.maximumCryosphereAgeDays) {
    failures.push(`The served daily snow and sea-ice analysis is ${ageDays} days old, beyond the ${policy.maximumCryosphereAgeDays} day expectation`);
  }
  return {
    validAt: days[0],
    ageDays,
    sourceVersion: manifest.layers.snowCover.provenance.sourceVersion,
    observedFraction: manifest.layers.snowCover.provenance.coverage?.observedFraction,
  };
}

function checkDegraded(degraded, failures) {
  if (!ACCEPTED_DEGRADED_SOURCES.has(degraded.runtimeSource)) {
    failures.push(`A degraded latest response left runtime source "${degraded.runtimeSource ?? 'none'}" rather than a verified Earth state`);
  }
  if (typeof degraded.bundleId !== 'string' || degraded.bundleId.trim() === '') {
    failures.push('A degraded latest response left no verified Earth state active');
  }
  if (degraded.refresh !== 'failed') {
    failures.push(`A degraded latest response reported a current remote refresh ("${degraded.refresh ?? 'none'}") instead of a failed one`);
  }
  return { runtimeSource: degraded.runtimeSource, refresh: degraded.refresh, bundleId: degraded.bundleId };
}

export function evaluateEarthStateFeedAcceptance({ manifest, checkedAt, degraded, policy }) {
  const thresholds = { ...DEFAULT_EARTH_STATE_ACCEPTANCE_POLICY, ...policy };
  const checkedAtMs = parseInstant(checkedAt);
  if (checkedAtMs === undefined) throw new Error('Earth-state feed acceptance requires a valid checkedAt');
  if (!manifest || typeof manifest.bundleId !== 'string') throw new Error('Earth-state feed acceptance requires the served manifest');

  const failures = [];
  const waived = [];
  const clouds = checkClouds(manifest, checkedAtMs, thresholds, failures);
  const cryosphere = checkCryosphere(manifest, checkedAtMs, thresholds, failures, waived);
  const fallback = degraded ? checkDegraded(degraded, failures) : undefined;

  return {
    schemaVersion: 1,
    checkedAt,
    policy: thresholds,
    bundleId: manifest.bundleId,
    classification: manifest.classification,
    ok: failures.length === 0,
    clouds,
    cryosphere,
    ...(fallback ? { degraded: fallback } : {}),
    ...(waived.length > 0 ? { waived } : {}),
    failures,
  };
}
