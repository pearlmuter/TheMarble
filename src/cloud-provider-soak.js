const PROVIDERS = ['satcorps', 'gmgsi'];

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

function providerMetrics(samples, provider) {
  const observations = samples.map((sample, index) => {
    const value = sample?.[provider];
    if (!value || typeof value !== 'object') throw new Error(`Invalid cloud soak field: samples.${index}.${provider}`);
    if (!Array.isArray(value.qualityFlags) || value.qualityFlags.some(flag => typeof flag !== 'string')) {
      throw new Error(`Invalid cloud soak field: samples.${index}.${provider}.qualityFlags`);
    }
    if (typeof value.schemaDrift !== 'boolean' || typeof value.dimensionsChanged !== 'boolean') {
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
      qualityFlags: value.qualityFlags,
    };
  });
  const expected = observations.reduce((sum, item) => sum + item.expectedObservations, 0);
  return {
    p95DiscoveryLatencyMinutes: rounded(percentile(observations.map(item => item.discoveryLatencyMinutes), .95)),
    missingFraction: rounded(observations.reduce((sum, item) => sum + item.missingObservations, 0) / expected),
    meanCoverageFraction: rounded(observations.reduce((sum, item) => sum + item.coverageFraction, 0) / observations.length),
    corruptFraction: rounded(observations.reduce((sum, item) => sum + item.corruptProducts, 0) / expected),
    schemaChanges: observations.filter(item => item.schemaDrift).length,
    dimensionChanges: observations.filter(item => item.dimensionsChanged).length,
    qualityFlagFraction: rounded(observations.filter(item => item.qualityFlags.length > 0).length / observations.length),
  };
}

function threshold(id, actual, limit, operator) {
  const passed = operator === 'minimum' ? actual >= limit : actual <= limit;
  return { id, actual, [operator]: limit, passed };
}

export function evaluateCloudProviderSoak(samples, policy) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('Cloud provider soak requires at least one sample');
  if (!policy || typeof policy !== 'object') throw new Error('Invalid cloud soak policy');
  const ordered = samples.map((sample, index) => {
    const checkedAt = Date.parse(sample?.checkedAt);
    if (Number.isNaN(checkedAt)) throw new Error(`Invalid cloud soak field: samples.${index}.checkedAt`);
    return { ...sample, checkedAtMilliseconds: checkedAt };
  }).sort((left, right) => left.checkedAtMilliseconds - right.checkedAtMilliseconds);
  const durationDays = rounded((ordered.at(-1).checkedAtMilliseconds - ordered[0].checkedAtMilliseconds) / 86_400_000);
  const metrics = Object.fromEntries(PROVIDERS.map(provider => [provider, providerMetrics(ordered, provider)]));
  metrics.p95InterSourceDisagreementFraction = rounded(percentile(ordered.map((sample, index) => (
    fraction(sample.interSourceDisagreementFraction, `samples.${index}.interSourceDisagreementFraction`)
  )), .95));

  const satcorps = metrics.satcorps;
  const thresholds = [
    threshold('minimum-duration', durationDays, finite(policy.minimumDurationDays, 'policy.minimumDurationDays'), 'minimum'),
    threshold('minimum-samples', ordered.length, finite(policy.minimumSamples, 'policy.minimumSamples', 1), 'minimum'),
    threshold('discovery-latency', satcorps.p95DiscoveryLatencyMinutes, finite(policy.maximumP95DiscoveryLatencyMinutes, 'policy.maximumP95DiscoveryLatencyMinutes'), 'maximum'),
    threshold('missing-observations', satcorps.missingFraction, fraction(policy.maximumMissingFraction, 'policy.maximumMissingFraction'), 'maximum'),
    threshold('coverage', satcorps.meanCoverageFraction, fraction(policy.minimumMeanCoverageFraction, 'policy.minimumMeanCoverageFraction'), 'minimum'),
    threshold('corruption', satcorps.corruptFraction, fraction(policy.maximumCorruptFraction, 'policy.maximumCorruptFraction'), 'maximum'),
    threshold('schema-stability', satcorps.schemaChanges, finite(policy.maximumSchemaChanges, 'policy.maximumSchemaChanges'), 'maximum'),
    threshold('dimension-stability', satcorps.dimensionChanges, finite(policy.maximumDimensionChanges, 'policy.maximumDimensionChanges'), 'maximum'),
    threshold('quality', satcorps.qualityFlagFraction, fraction(policy.maximumQualityFlagFraction, 'policy.maximumQualityFlagFraction'), 'maximum'),
    threshold('inter-source-disagreement', metrics.p95InterSourceDisagreementFraction, fraction(policy.maximumP95InterSourceDisagreementFraction, 'policy.maximumP95InterSourceDisagreementFraction'), 'maximum'),
  ];

  return {
    schemaVersion: 1,
    evaluatedAt: new Date(ordered.at(-1).checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'),
    qualified: thresholds.every(item => item.passed),
    window: {
      from: new Date(ordered[0].checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'),
      to: new Date(ordered.at(-1).checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'),
      durationDays,
      samples: ordered.length,
    },
    metrics,
    thresholds,
  };
}

export function cloudProviderPromotionIsCurrent(report, { now, maximumAgeHours }) {
  if (!report || report.schemaVersion !== 1 || report.qualified !== true || !Array.isArray(report.thresholds)
    || report.thresholds.length === 0 || report.thresholds.some(item => item?.passed !== true)) return false;
  const evaluatedAt = Date.parse(report.evaluatedAt);
  const nowMilliseconds = Date.parse(now);
  if (Number.isNaN(evaluatedAt) || Number.isNaN(nowMilliseconds) || !Number.isFinite(maximumAgeHours) || maximumAgeHours <= 0) return false;
  const age = nowMilliseconds - evaluatedAt;
  return age >= 0 && age <= maximumAgeHours * 60 * 60 * 1000;
}
