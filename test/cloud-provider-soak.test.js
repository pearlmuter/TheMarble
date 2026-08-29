import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudProviderPromotionIsCurrent, evaluateCloudProviderSoak } from '../src/cloud-provider-soak.js';

const policy = {
  version: 'themarble-cloud-soak-v1',
  minimumDurationDays: 21,
  minimumSamples: 22,
  maximumSampleGapHours: 25,
  maximumEvaluationWindowDays: 35,
  maximumP95DiscoveryLatencyMinutes: 90,
  maximumMissingFraction: .02,
  minimumMeanCoverageFraction: .9,
  maximumCorruptFraction: 0,
  maximumSchemaChanges: 0,
  maximumDimensionChanges: 0,
  maximumQualityFlagFraction: .01,
  maximumP95InterSourceDisagreementFraction: .15,
};

function samples(overrides = {}) {
  return Array.from({ length: 22 }, (_, day) => ({
    checkedAt: new Date(Date.parse('2026-08-01T00:00:00Z') + day * 24 * 60 * 60 * 1000).toISOString(),
    satcorps: {
      discoveryLatencyMinutes: 54,
      expectedObservations: 24,
      missingObservations: 0,
      coverageFraction: .96,
      corruptProducts: 0,
      schemaDrift: false,
      dimensionsChanged: false,
      schemaFingerprint: 'cloud-v3',
      dimensions: { width: 4096, height: 2048 },
      available: true,
      qualityFlags: [],
      ...overrides.satcorps,
    },
    gmgsi: {
      discoveryLatencyMinutes: 61,
      expectedObservations: 24,
      missingObservations: 0,
      coverageFraction: .95,
      corruptProducts: 0,
      schemaDrift: false,
      dimensionsChanged: false,
      schemaFingerprint: 'cloud-v3',
      dimensions: { width: 4096, height: 2048 },
      available: true,
      qualityFlags: [],
      ...overrides.gmgsi,
    },
    interSourceDisagreementFraction: overrides.interSourceDisagreementFraction ?? .08,
  }));
}

test('a multi-week SatCORPS soak qualifies only when every documented promotion threshold passes', () => {
  const promotion = evaluateCloudProviderSoak(samples(), policy);

  assert.equal(promotion.qualified, true);
  assert.equal(promotion.window.durationDays, 21);
  assert.equal(promotion.window.samples, 22);
  assert.equal(promotion.window.resetReason, undefined);
  assert.equal(promotion.metrics.satcorps.p95DiscoveryLatencyMinutes, 54);
  assert.equal(promotion.metrics.satcorps.missingFraction, 0);
  assert.equal(promotion.metrics.satcorps.meanCoverageFraction, .96);
  assert.equal(promotion.metrics.satcorps.corruptFraction, 0);
  assert.equal(promotion.metrics.satcorps.schemaChanges, 0);
  assert.equal(promotion.metrics.satcorps.dimensionChanges, 0);
  assert.equal(promotion.metrics.p95InterSourceDisagreementFraction, .08);
  assert.ok(promotion.thresholds.every(threshold => threshold.passed));
});

test('schema, dimensions, missing hours, corruption, quality, and disagreement each block SatCORPS promotion', () => {
  const failures = [
    { satcorps: { schemaDrift: true } },
    { satcorps: { dimensionsChanged: true } },
    { satcorps: { missingObservations: 2 } },
    { satcorps: { corruptProducts: 1 } },
    { satcorps: { qualityFlags: ['low-quality'] } },
    { interSourceDisagreementFraction: .2 },
  ];

  for (const override of failures) {
    const promotion = evaluateCloudProviderSoak(samples(override), policy);
    assert.equal(promotion.qualified, false);
    assert.ok(promotion.thresholds.some(threshold => !threshold.passed));
  }
});

test('an otherwise clean short run remains an immature soak rather than promotion evidence', () => {
  const promotion = evaluateCloudProviderSoak(samples().slice(0, 7), policy);

  assert.equal(promotion.qualified, false);
  assert.equal(promotion.thresholds.find(item => item.id === 'minimum-duration').passed, false);
  assert.equal(promotion.thresholds.find(item => item.id === 'minimum-samples').passed, false);
});

test('duplicate endpoints and hidden schema or dimension transitions cannot impersonate a continuous stable soak', () => {
  const endpointOnly = samples().map((sample, index) => ({
    ...sample,
    checkedAt: index < 11 ? '2026-08-01T00:00:00Z' : '2026-08-22T00:00:00Z',
  }));
  const discontinuous = evaluateCloudProviderSoak(endpointOnly, policy);
  assert.equal(discontinuous.qualified, false);
  assert.equal(discontinuous.window.samples, 1);
  assert.equal(discontinuous.window.resetReason, 'sample-gap');

  const changed = samples();
  changed[11].satcorps = {
    ...changed[11].satcorps,
    schemaFingerprint: 'cloud-v4',
    dimensions: { width: 8192, height: 4096 },
    schemaDrift: false,
    dimensionsChanged: false,
  };
  const unstable = evaluateCloudProviderSoak(changed, policy);
  assert.equal(unstable.qualified, false);
  assert.equal(unstable.window.resetReason, 'schema-or-dimension-change');
  assert.ok(unstable.window.durationDays < 21);
});

test('an old outage or transition ages out after a new complete clean candidate window', () => {
  const history = [
    { ...samples()[0], checkedAt: '2026-07-01T00:00:00Z' },
    { ...samples()[0], checkedAt: '2026-07-20T00:00:00Z', satcorps: { ...samples()[0].satcorps, available: false } },
    ...samples(),
  ];
  const promotion = evaluateCloudProviderSoak(history, policy);
  assert.equal(promotion.qualified, true);
  assert.equal(promotion.window.from, '2026-08-01T00:00:00Z');
});

test('the publisher accepts only a fresh report whose qualification is backed by every threshold', () => {
  const evidence = samples();
  const promotion = evaluateCloudProviderSoak(evidence, policy);

  const options = { now: '2026-08-22T12:00:00Z', maximumAgeHours: 24, policy, samples: evidence };
  assert.equal(cloudProviderPromotionIsCurrent(promotion, options), true);
  assert.equal(cloudProviderPromotionIsCurrent(promotion, { ...options, now: '2026-08-24T00:00:00Z' }), false);
  assert.equal(cloudProviderPromotionIsCurrent({ ...promotion, thresholds: promotion.thresholds.map((item, index) => index === 0 ? { ...item, passed: false } : item) }, {
    ...options,
  }), false);
  assert.equal(cloudProviderPromotionIsCurrent({ ...promotion, thresholds: [promotion.thresholds[0]] }, {
    ...options,
  }), false);
  assert.equal(cloudProviderPromotionIsCurrent({ ...promotion, policyVersion: 'obsolete-policy' }, {
    ...options,
  }), false);
  const forged = {
    ...promotion,
    qualified: true,
    thresholds: promotion.thresholds.map(item => ({ ...item, actual: item.id === 'coverage' ? 0 : 999, passed: true })),
  };
  assert.equal(cloudProviderPromotionIsCurrent(forged, options), false);
  assert.equal(cloudProviderPromotionIsCurrent({
    ...promotion,
    window: { ...promotion.window, from: promotion.window.to, durationDays: 21 },
  }, options), false);
  assert.equal(cloudProviderPromotionIsCurrent(promotion, { ...options, policy: { ...policy, version: 'obsolete' } }), false);
});
