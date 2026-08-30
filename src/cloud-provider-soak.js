const PROVIDERS = ['satcorps', 'gmgsi'];
export const CLOUD_PROVIDER_SOAK_POLICY_VERSION = 'themarble-cloud-soak-v1';
const THRESHOLD_IDS = [
  'minimum-duration',
  'minimum-samples',
  'window-continuity',
  'discovery-latency',
  'missing-observations',
  'coverage',
  'corruption',
  'schema-stability',
  'dimension-stability',
  'quality',
  'inter-source-disagreement',
];

function finite(value, path, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid cloud soak field: ${path}`);
  return value;
}

function fraction(value, path) {
  finite(value, path);
  if (value > 1) throw new Error(`Invalid cloud soak field: ${path}`);
  return value;
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

function nonemptyString(value, path) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid cloud soak field: ${path}`);
  return value;
}

function dimensions(value, path) {
  if (!value || typeof value !== 'object') throw new Error(`Invalid cloud soak field: ${path}`);
  return {
    width: finite(value.width, `${path}.width`, 1),
    height: finite(value.height, `${path}.height`, 1),
  };
}

function sameDimensions(left, right) {
  return left.width === right.width && left.height === right.height;
}

function providerMetrics(samples, provider) {
  const observations = samples.map((sample, index) => {
    const value = sample?.[provider];
    if (!value || typeof value !== 'object') throw new Error(`Invalid cloud soak field: samples.${index}.${provider}`);
    if (!Array.isArray(value.qualityFlags) || value.qualityFlags.some(flag => typeof flag !== 'string')) {
      throw new Error(`Invalid cloud soak field: samples.${index}.${provider}.qualityFlags`);
    }
    if (typeof value.available !== 'boolean' || typeof value.schemaDrift !== 'boolean' || typeof value.dimensionsChanged !== 'boolean') {
      throw new Error(`Invalid cloud soak field: samples.${index}.${provider}.shape`);
    }
    return {
      discoveryLatencyMinutes: finite(value.discoveryLatencyMinutes, `samples.${index}.${provider}.discoveryLatencyMinutes`),
      expectedObservations: finite(value.expectedObservations, `samples.${index}.${provider}.expectedObservations`, 1),
      missingObservations: finite(value.missingObservations, `samples.${index}.${provider}.missingObservations`),
      coverageFraction: fraction(value.coverageFraction, `samples.${index}.${provider}.coverageFraction`),
      corruptProducts: finite(value.corruptProducts, `samples.${index}.${provider}.corruptProducts`),
      schemaDrift: value.schemaDrift,
      dimensionsChanged: value.dimensionsChanged,
      available: value.available,
      schemaFingerprint: value.available ? nonemptyString(value.schemaFingerprint, `samples.${index}.${provider}.schemaFingerprint`) : undefined,
      dimensions: value.available ? dimensions(value.dimensions, `samples.${index}.${provider}.dimensions`) : undefined,
      qualityFlags: value.qualityFlags,
    };
  });
  const expected = observations.reduce((sum, item) => sum + item.expectedObservations, 0);
  const schemaTransitions = observations.slice(1).filter((item, index) => (
    item.available && observations[index].available && item.schemaFingerprint !== observations[index].schemaFingerprint
  )).length;
  const dimensionTransitions = observations.slice(1).filter((item, index) => (
    item.available && observations[index].available && !sameDimensions(item.dimensions, observations[index].dimensions)
  )).length;
  return {
    p95DiscoveryLatencyMinutes: rounded(percentile(observations.map(item => item.discoveryLatencyMinutes), .95)),
    missingFraction: rounded(observations.reduce((sum, item) => sum + item.missingObservations, 0) / expected),
    meanCoverageFraction: rounded(observations.reduce((sum, item) => sum + item.coverageFraction, 0) / observations.length),
    corruptFraction: rounded(observations.reduce((sum, item) => sum + item.corruptProducts, 0) / expected),
    schemaChanges: observations.filter(item => item.schemaDrift).length + schemaTransitions,
    dimensionChanges: observations.filter(item => item.dimensionsChanged).length + dimensionTransitions,
    qualityFlagFraction: rounded(observations.filter(item => item.qualityFlags.length > 0).length / observations.length),
  };
}

function threshold(id, actual, limit, operator) {
  const passed = operator === 'minimum' ? actual >= limit : actual <= limit;
  return { id, actual, [operator]: limit, passed };
}

function thresholdsFor(window, metrics, policy) {
  const satcorps = metrics.satcorps;
  return [
    threshold('minimum-duration', window.durationDays, finite(policy.minimumDurationDays, 'policy.minimumDurationDays'), 'minimum'),
    threshold('minimum-samples', window.samples, finite(policy.minimumSamples, 'policy.minimumSamples', 1), 'minimum'),
    threshold('window-continuity', window.maximumObservedGapHours, finite(policy.maximumSampleGapHours, 'policy.maximumSampleGapHours'), 'maximum'),
    threshold('discovery-latency', satcorps.p95DiscoveryLatencyMinutes, finite(policy.maximumP95DiscoveryLatencyMinutes, 'policy.maximumP95DiscoveryLatencyMinutes'), 'maximum'),
    threshold('missing-observations', satcorps.missingFraction, fraction(policy.maximumMissingFraction, 'policy.maximumMissingFraction'), 'maximum'),
    threshold('coverage', satcorps.meanCoverageFraction, fraction(policy.minimumMeanCoverageFraction, 'policy.minimumMeanCoverageFraction'), 'minimum'),
    threshold('corruption', satcorps.corruptFraction, fraction(policy.maximumCorruptFraction, 'policy.maximumCorruptFraction'), 'maximum'),
    threshold('schema-stability', satcorps.schemaChanges, finite(policy.maximumSchemaChanges, 'policy.maximumSchemaChanges'), 'maximum'),
    threshold('dimension-stability', satcorps.dimensionChanges, finite(policy.maximumDimensionChanges, 'policy.maximumDimensionChanges'), 'maximum'),
    threshold('quality', satcorps.qualityFlagFraction, fraction(policy.maximumQualityFlagFraction, 'policy.maximumQualityFlagFraction'), 'maximum'),
    threshold('inter-source-disagreement', metrics.p95InterSourceDisagreementFraction, fraction(policy.maximumP95InterSourceDisagreementFraction, 'policy.maximumP95InterSourceDisagreementFraction'), 'maximum'),
  ];
}

function providerAvailable(sample) {
  return PROVIDERS.every(provider => sample[provider]?.available === true);
}

function providerIdentityChanged(previous, current) {
  return PROVIDERS.some(provider => previous[provider].schemaFingerprint !== current[provider].schemaFingerprint
    || !sameDimensions(previous[provider].dimensions, current[provider].dimensions));
}

function candidateWindow(ordered, policy) {
  const maximumEvaluationWindowDays = finite(policy.maximumEvaluationWindowDays, 'policy.maximumEvaluationWindowDays', policy.minimumDurationDays);
  const cutoff = ordered.at(-1).checkedAtMilliseconds - maximumEvaluationWindowDays * 86_400_000;
  const bounded = ordered.filter(sample => sample.checkedAtMilliseconds >= cutoff);
  const maximumGapMilliseconds = finite(policy.maximumSampleGapHours, 'policy.maximumSampleGapHours') * 3_600_000;
  let start = 0;
  let resetReason;
  for (let index = 0; index < bounded.length; index += 1) {
    const sample = bounded[index];
    if (!providerAvailable(sample)) {
      start = index;
      resetReason = 'provider-unavailable';
      continue;
    }
    if (index === 0) continue;
    const previous = bounded[index - 1];
    if (sample.checkedAtMilliseconds - previous.checkedAtMilliseconds > maximumGapMilliseconds) {
      start = index;
      resetReason = 'sample-gap';
    } else if (!providerAvailable(previous)) {
      start = index;
      resetReason = 'provider-recovered';
    } else if (providerIdentityChanged(previous, sample)) {
      start = index;
      resetReason = 'schema-or-dimension-change';
    }
  }
  return { samples: bounded.slice(start), resetReason, auditSamples: bounded.length };
}

export function evaluateCloudProviderSoak(samples, policy) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('Cloud provider soak requires at least one sample');
  if (!policy || typeof policy !== 'object' || policy.version !== CLOUD_PROVIDER_SOAK_POLICY_VERSION) throw new Error('Invalid cloud soak policy version');
  const parsed = samples.map((sample, index) => {
    const checkedAt = Date.parse(sample?.checkedAt);
    if (Number.isNaN(checkedAt)) throw new Error(`Invalid cloud soak field: samples.${index}.checkedAt`);
    return { ...sample, checkedAtMilliseconds: checkedAt };
  }).sort((left, right) => left.checkedAtMilliseconds - right.checkedAtMilliseconds);
  const unique = [...new Map(parsed.map(sample => [sample.checkedAtMilliseconds, sample])).values()];
  const candidate = candidateWindow(unique, policy);
  const ordered = candidate.samples;
  const durationDays = rounded((ordered.at(-1).checkedAtMilliseconds - ordered[0].checkedAtMilliseconds) / 86_400_000);
  const maximumObservedGapHours = rounded(ordered.slice(1).reduce((maximum, sample, index) => (
    Math.max(maximum, (sample.checkedAtMilliseconds - ordered[index].checkedAtMilliseconds) / 3_600_000)
  ), 0));
  const metrics = Object.fromEntries(PROVIDERS.map(provider => [provider, providerMetrics(ordered, provider)]));
  metrics.p95InterSourceDisagreementFraction = rounded(percentile(ordered.map((sample, index) => (
    fraction(sample.interSourceDisagreementFraction, `samples.${index}.interSourceDisagreementFraction`)
  )), .95));

  const window = {
    from: new Date(ordered[0].checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'),
    to: new Date(ordered.at(-1).checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'),
    durationDays,
    samples: ordered.length,
    maximumObservedGapHours,
    auditSamples: candidate.auditSamples,
    ...(candidate.resetReason ? { resetReason: candidate.resetReason } : {}),
  };
  const thresholds = thresholdsFor(window, metrics, policy);

  return {
    schemaVersion: 1,
    policyVersion: CLOUD_PROVIDER_SOAK_POLICY_VERSION,
    evaluatedAt: new Date(ordered.at(-1).checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'),
    qualified: thresholds.every(item => item.passed),
    window,
    metrics,
    thresholds,
  };
}

export function cloudProviderPromotionIsCurrent(report, { now, maximumAgeHours, policy, samples }) {
  if (policy?.version !== CLOUD_PROVIDER_SOAK_POLICY_VERSION || !Array.isArray(samples) || samples.length === 0) return false;
  let recomputed;
  try {
    recomputed = evaluateCloudProviderSoak(samples, policy);
  } catch {
    return false;
  }
  if (JSON.stringify(report) !== JSON.stringify(recomputed)) return false;
  if (!report || report.schemaVersion !== 1 || report.policyVersion !== CLOUD_PROVIDER_SOAK_POLICY_VERSION
    || report.qualified !== true || !Array.isArray(report.thresholds) || report.thresholds.length !== THRESHOLD_IDS.length) return false;
  const ids = new Set(report.thresholds.map(item => item?.id));
  if (ids.size !== THRESHOLD_IDS.length || THRESHOLD_IDS.some(id => !ids.has(id))) return false;
  let expectedThresholds;
  try {
    expectedThresholds = thresholdsFor(report.window, report.metrics, policy);
  } catch {
    return false;
  }
  const reportedById = new Map(report.thresholds.map(item => [item.id, item]));
  if (expectedThresholds.some(expected => {
    const reported = reportedById.get(expected.id);
    const operator = 'minimum' in expected ? 'minimum' : 'maximum';
    return reported?.actual !== expected.actual || reported?.[operator] !== expected[operator]
      || reported?.passed !== expected.passed || expected.passed !== true;
  })) return false;
  const evaluatedAt = Date.parse(report.evaluatedAt);
  const windowFrom = Date.parse(report.window.from);
  const windowTo = Date.parse(report.window.to);
  const nowMilliseconds = Date.parse(now);
  if (Number.isNaN(evaluatedAt) || Number.isNaN(windowFrom) || Number.isNaN(windowTo) || windowFrom > windowTo
    || rounded((windowTo - windowFrom) / 86_400_000) !== report.window.durationDays || evaluatedAt !== windowTo
    || Number.isNaN(nowMilliseconds) || !Number.isFinite(maximumAgeHours) || maximumAgeHours <= 0) return false;
  const age = nowMilliseconds - evaluatedAt;
  return age >= 0 && age <= maximumAgeHours * 60 * 60 * 1000;
}
