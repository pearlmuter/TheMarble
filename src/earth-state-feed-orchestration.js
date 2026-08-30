import { EARTH_STATE_CRYOSPHERE_LAYERS } from './earth-state.js';

const HOUR_MS = 60 * 60 * 1000;
const CRYOSPHERE_LAYERS = EARTH_STATE_CRYOSPHERE_LAYERS;
const STAGE_STATUSES = new Set(['published', 'unchanged', 'failed']);
const STAGE_LAYERS = { clouds: ['clouds'], cryosphere: CRYOSPHERE_LAYERS };

function requireInstant(value, name) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Invalid Earth-state feed ${name}: ${value}`);
  return parsed;
}

/** The renderer crossfades two adjacent observed hours; anything else is not a cloud sequence. */
export function adjacentCloudHoursProblem(hours) {
  if (hours.length !== 2) {
    return `carry ${hours.length} observed ${hours.length === 1 ? 'hour' : 'hours'} instead of two adjacent observed hours`;
  }
  const [from, to] = hours.map(hour => Date.parse(hour));
  if (Number.isNaN(from) || Number.isNaN(to) || to - from !== HOUR_MS) {
    return `carry ${hours.join(' and ')}, which are not two adjacent observed hours`;
  }
  return undefined;
}

/**
 * Read a producer's publication outcome from its captured stdout.
 * A producer shares its stdout with the compositors it spawns, so the outcome is
 * the last standalone JSON object in the stream, never the first brace in it.
 */
export function readPublicationOutcome(stdout) {
  const lines = stdout.split('\n');
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    if (lines[start] !== '{') continue;
    try {
      const report = JSON.parse(lines.slice(start).join('\n'));
      if (typeof report?.status === 'string') return report;
    } catch {
      // Not a complete object at this offset; keep scanning backwards.
    }
  }
  return undefined;
}

/** One published asset the delivery probe can sample, chosen from the newest cloud frame first. */
export function representativeEarthStateAssetHref(manifest) {
  const frameLayers = Object.values(manifest.cloudSequence?.frames?.at(-1)?.layers ?? {});
  const layers = Object.values(manifest.layers ?? {});
  return [...frameLayers, ...layers].find(layer => layer?.asset?.href)?.asset?.href;
}

export function readEarthStateFeedLayers(manifest) {
  if (!manifest || typeof manifest.bundleId !== 'string') throw new Error('Earth-state feed layers require a published manifest');
  const sequence = manifest.cloudSequence;
  const newest = sequence?.frames?.at(-1);
  return {
    bundleId: manifest.bundleId,
    ...(newest ? {
      clouds: {
        provider: sequence.provider,
        validAt: newest.validAt,
        observedFrom: sequence.frames[0].validAt,
        observedTo: newest.observedTo,
        hours: sequence.frames.map(frame => frame.validAt),
      },
    } : {}),
    ...Object.fromEntries(CRYOSPHERE_LAYERS
      .map(layer => [layer, manifest.layers?.[layer]?.provenance])
      .filter(([, provenance]) => provenance !== undefined)
      .map(([layer, provenance]) => [layer, { validAt: provenance.validAt }])),
  };
}

export function evaluateEarthStateFeedRun({ before, after, stages, checkedAt }) {
  if (!before || !after) throw new Error('An Earth-state feed run compares the published state before and after publication');
  if (!Array.isArray(stages)) throw new Error('An Earth-state feed run requires its producer stages');
  for (const stage of stages) {
    if (!STAGE_LAYERS[stage?.name]) throw new Error(`Unknown Earth-state feed stage: ${stage?.name}`);
    if (!STAGE_STATUSES.has(stage.status)) throw new Error(`Unknown Earth-state feed stage status: ${stage.status}`);
  }

  const problems = [];
  const advanced = [];
  const retained = [];
  const damaged = new Set();
  const fail = problem => {
    problems.push(problem);
    if (problem.layer !== undefined) damaged.add(problem.layer);
  };
  for (const layer of ['clouds', ...CRYOSPHERE_LAYERS]) {
    const previous = before[layer];
    const current = after[layer];
    if (!previous) {
      if (current) advanced.push(layer);
      continue;
    }
    if (!current) {
      fail({ layer, reason: `${layer} disappeared from the combined Earth state` });
      continue;
    }
    const previousValidAt = requireInstant(previous.validAt, 'valid time');
    const currentValidAt = requireInstant(current.validAt, 'valid time');
    if (currentValidAt < previousValidAt) {
      fail({
        layer,
        reason: `${layer} would regress from ${previous.validAt} to ${current.validAt}`,
      });
    } else if (currentValidAt > previousValidAt) advanced.push(layer);
    else retained.push(layer);
  }

  const sequenceProblem = after.clouds && adjacentCloudHoursProblem(after.clouds.hours);
  if (sequenceProblem) fail({ layer: 'clouds', reason: `clouds ${sequenceProblem}` });

  let broken = false;
  for (const stage of stages) {
    if (stage.status === 'failed') {
      problems.push({ stage: stage.name, reason: stage.reason ?? `The ${stage.name} producer failed without a recorded reason` });
      continue;
    }
    if (stage.status !== 'published') continue;
    const unmoved = STAGE_LAYERS[stage.name].filter(layer => !advanced.includes(layer) && !damaged.has(layer));
    if (unmoved.length > 0) {
      broken = true;
      problems.push({
        stage: stage.name,
        reason: `The ${stage.name} producer published ${stage.validAt ?? 'a new state'} but ${unmoved.join(' and ')} did not advance in the combined Earth state`,
      });
    }
  }

  const coherent = !broken && damaged.size === 0;
  return {
    checkedAt: checkedAt ?? new Date().toISOString().replace('.000Z', 'Z'),
    coherent,
    severity: !coherent ? 'broken' : problems.length > 0 ? 'degraded' : 'ok',
    advanced,
    retained,
    stages,
    problems,
  };
}
