import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudProviderPromotionIsCurrent, evaluateCloudProviderSoak } from '../src/cloud-provider-soak.js';

const policy = {
  minimumDurationDays: 21,
  minimumSamples: 22,
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

test('the publisher accepts only a fresh report whose qualification is backed by every threshold', () => {
  const promotion = evaluateCloudProviderSoak(samples(), policy);

  assert.equal(cloudProviderPromotionIsCurrent(promotion, { now: '2026-08-22T12:00:00Z', maximumAgeHours: 24 }), true);
  assert.equal(cloudProviderPromotionIsCurrent(promotion, { now: '2026-08-24T00:00:00Z', maximumAgeHours: 24 }), false);
  assert.equal(cloudProviderPromotionIsCurrent({ ...promotion, thresholds: promotion.thresholds.map((item, index) => index === 0 ? { ...item, passed: false } : item) }, {
    now: '2026-08-22T12:00:00Z',
    maximumAgeHours: 24,
  }), false);
});
