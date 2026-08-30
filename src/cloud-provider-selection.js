const PROVIDER_RULES = Object.freeze({
  satcorps: Object.freeze({ cadenceMs: 60 * 60 * 1000, maxAgeMs: 2 * 60 * 60 * 1000 }),
  gmgsi: Object.freeze({ cadenceMs: 60 * 60 * 1000, maxAgeMs: 4 * 60 * 60 * 1000 }),
});

export function cloudProviderMaxAgeSeconds(provider) {
  return PROVIDER_RULES[provider]?.maxAgeMs / 1000;
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function validFraction(value, minimum) {
  return Number.isFinite(value) && value >= minimum && value <= 1;
}

function validateFrame(frame, provider, retrievedMs) {
  if (!frame || frame.provider !== provider || typeof frame.version !== 'string' || frame.version.trim() === '') return false;
  const validAt = timestamp(frame.validAt);
  const observedFrom = timestamp(frame.observedFrom);
  const observedTo = timestamp(frame.observedTo);
  const producedAt = timestamp(frame.producedAt);
  if ([validAt, observedFrom, observedTo, producedAt].includes(undefined)
    || observedFrom > validAt || validAt > observedTo || observedTo > producedAt
    || producedAt > retrievedMs) return false;
  if (!validFraction(frame.coverage?.observedFraction, .9)
    || !validFraction(frame.quality?.usableFraction, .7)) return false;
  return typeof frame.assets?.manifest === 'string' && frame.assets.manifest.trim() !== '';
}

function validateSequence(sequence, retrievedMs) {
  const rules = PROVIDER_RULES[sequence?.provider];
  if (!rules || !Array.isArray(sequence.frames) || sequence.frames.length !== 2) return false;
  if (!sequence.frames.every(frame => validateFrame(frame, sequence.provider, retrievedMs))) return false;
  const [from, to] = sequence.frames.map(frame => timestamp(frame.validAt));
  return to - from === rules.cadenceMs && retrievedMs - to <= rules.maxAgeMs;
}

export function selectCloudProviderSequence({ sequences, retrievedAt, lastPublishedValidAt, satcorpsPromoted = false }) {
  const retrievedMs = timestamp(retrievedAt);
  if (retrievedMs === undefined) throw new Error('Invalid cloud retrieval time');
  if (!Array.isArray(sequences)) throw new Error('Cloud provider sequences must be an array');

  const usable = sequences.filter(sequence => validateSequence(sequence, retrievedMs))
    .sort((left, right) => Date.parse(right.frames[1].validAt) - Date.parse(left.frames[1].validAt));
  const selected = satcorpsPromoted
    ? usable.find(sequence => sequence.provider === 'satcorps') ?? usable.find(sequence => sequence.provider === 'gmgsi')
    : usable.find(sequence => sequence.provider === 'gmgsi');
  if (!selected) throw new Error('Cloud selection did not find a usable cloud provider sequence');

  const newestValidAt = selected.frames[1].validAt;
  const publishedMs = lastPublishedValidAt === undefined ? undefined : timestamp(lastPublishedValidAt);
  if (lastPublishedValidAt !== undefined && publishedMs === undefined) throw new Error('Invalid last published cloud time');
  const satcorpsSupplied = sequences.some(sequence => sequence?.provider === 'satcorps');

  return {
    provider: selected.provider,
    frames: selected.frames,
    retrievedAt: new Date(retrievedMs).toISOString().replace('.000Z', 'Z'),
    ...(selected.provider === 'gmgsi' && satcorpsSupplied ? {
      fallback: {
        from: 'satcorps',
        reason: satcorpsPromoted
          ? 'SatCORPS was unavailable or rejected by freshness, coverage, integrity, or quality rules.'
          : 'SatCORPS has not passed the required multi-week production soak and promotion thresholds.',
      },
    } : {}),
    publish: publishedMs === undefined || Date.parse(newestValidAt) > publishedMs,
  };
}
