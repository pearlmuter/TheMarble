import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEarthProductionHealth } from '../src/production-observability.js';

const policy = {
  providers: {
    satcorps: { maximumDiscoveryLatencyMinutes: 90, maximumMissingObservations: 1, minimumCoverageFraction: .9 },
    gmgsi: { maximumDiscoveryLatencyMinutes: 120, maximumMissingObservations: 1, minimumCoverageFraction: .9 },
  },
  maximumLatestManifestAgeMinutes: 180,
};

function provider(overrides = {}) {
  return {
    latestObservationAt: '2026-08-29T07:00:00Z',
    discoveredAt: '2026-08-29T07:35:00Z',
    missingObservations: 0,
    schemaFingerprint: 'cloud-v3',
    expectedSchemaFingerprint: 'cloud-v3',
    dimensions: { width: 4096, height: 2048 },
    expectedDimensions: { width: 4096, height: 2048 },
    corruptProducts: 0,
    coverageFraction: .97,
    qualityFlags: [],
    processingDurationMs: 42_000,
    ...overrides,
  };
}

function healthySnapshot(overrides = {}) {
  return {
    checkedAt: '2026-08-29T08:00:00Z',
    providers: { satcorps: provider(), gmgsi: provider({ discoveredAt: '2026-08-29T07:42:00Z' }) },
    transformation: { ok: true, durationMs: 18_000 },
    compositor: { ok: true, durationMs: 64_000 },
    publication: { outcome: 'published', durationMs: 12_000, bundleId: 'earth-2026-08-29T07:00Z' },
    delivery: {
      originAvailable: true,
      cdnAvailable: true,
      originBundleId: 'earth-2026-08-29T07:00Z',
      cdnBundleId: 'earth-2026-08-29T07:00Z',
      latestManifestRetrievedAt: '2026-08-29T07:40:00Z',
      latestManifestAdvancedAt: '2026-08-29T07:00:00Z',
    },
    client: {
      bundleId: 'earth-2026-08-29T07:00Z',
      visualSmoke: { ok: true, artifacts: ['day.png', 'terminator.png', 'night.png'] },
    },
    ...overrides,
  };
}

test('a scheduled health record preserves every source-to-client diagnostic and reports a coherent current Earth', () => {
  const report = evaluateEarthProductionHealth(healthySnapshot(), policy);

  assert.equal(report.status, 'healthy');
  assert.deepEqual(report.alerts, []);
  assert.deepEqual(report.metrics.providers.satcorps, {
    discoveryLatencyMinutes: 35,
    temporalInvalid: false,
    missingObservations: 0,
    schemaDrift: false,
    dimensionsChanged: false,
    corruptProducts: 0,
    coverageFraction: .97,
    qualityFlags: [],
    processingDurationMs: 42_000,
  });
  assert.equal(report.metrics.transformation.durationMs, 18_000);
  assert.equal(report.metrics.compositor.durationMs, 64_000);
  assert.equal(report.metrics.publication.outcome, 'published');
  assert.equal(report.metrics.delivery.cdnAvailable, true);
  assert.equal(report.metrics.latestManifestRetrievalAgeMinutes, 20);
  assert.equal(report.metrics.latestBundleAgeMinutes, 60);
  assert.deepEqual(report.metrics.client.visualArtifacts, ['day.png', 'terminator.png', 'night.png']);
});

test('alerts identify the failing production stage instead of collapsing every problem into stale data', () => {
  const report = evaluateEarthProductionHealth(healthySnapshot({
    providers: {
      satcorps: provider({ discoveredAt: '2026-08-29T09:00:00Z', missingObservations: 2 }),
      gmgsi: provider(),
    },
    transformation: { ok: false, durationMs: 19_000, error: 'schema adapter rejected cloud-v4' },
    compositor: { ok: false, durationMs: 70_000, error: 'process exited 137' },
    publication: { outcome: 'interrupted', durationMs: 8_000, bundleId: 'earth-candidate' },
    delivery: {
      originAvailable: true,
      cdnAvailable: false,
      originBundleId: 'earth-current',
      cdnBundleId: 'earth-old',
      latestManifestRetrievedAt: '2026-08-29T03:00:00Z',
      latestManifestAdvancedAt: '2026-08-29T03:00:00Z',
    },
    client: { bundleId: 'earth-old', visualSmoke: { ok: false, artifacts: ['failed.png'], error: 'fallback visible' } },
  }), policy);

  assert.deepEqual(new Set(report.alerts.map(alert => alert.stage)), new Set([
    'upstream-provider-lateness',
    'transformation',
    'compositor',
    'publication',
    'delivery',
    'client-currentness',
  ]));
  assert.equal(report.status, 'failing');
});

test('publication identity, content age, and impossible future telemetry cannot be reported healthy', () => {
  const report = evaluateEarthProductionHealth(healthySnapshot({
    providers: {
      satcorps: provider({ latestObservationAt: '2026-08-29T08:10:00Z', discoveredAt: '2026-08-29T08:20:00Z' }),
      gmgsi: provider(),
    },
    publication: { outcome: 'published', durationMs: 12_000, bundleId: 'earth-new-undelivered' },
    delivery: {
      originAvailable: true,
      cdnAvailable: true,
      originBundleId: 'earth-2026-08-29T07:00Z',
      cdnBundleId: 'earth-2026-08-29T07:00Z',
      latestManifestRetrievedAt: '2026-08-29T08:10:00Z',
      latestManifestAdvancedAt: '2026-08-29T04:00:00Z',
    },
  }), policy);

  assert.equal(report.status, 'failing');
  assert.ok(report.alerts.some(alert => alert.code === 'provider-time-invalid'));
  assert.ok(report.alerts.some(alert => alert.code === 'published-bundle-not-delivered'));
  assert.ok(report.alerts.some(alert => alert.code === 'latest-content-stale'));
  assert.ok(report.alerts.some(alert => alert.code === 'latest-retrieval-time-invalid'));
});

test('schema, dimension, corruption, coverage, and quality regressions remain explicit transformation diagnostics', () => {
  const report = evaluateEarthProductionHealth(healthySnapshot({
    providers: {
      satcorps: provider({
        schemaFingerprint: 'cloud-v4',
        dimensions: { width: 3600, height: 1800 },
        corruptProducts: 1,
        coverageFraction: .82,
        qualityFlags: ['retrieval-quality-below-threshold'],
      }),
      gmgsi: provider(),
    },
  }), policy);

  const satcorps = report.metrics.providers.satcorps;
  assert.equal(satcorps.schemaDrift, true);
  assert.equal(satcorps.dimensionsChanged, true);
  assert.equal(satcorps.corruptProducts, 1);
  assert.equal(satcorps.coverageFraction, .82);
  assert.deepEqual(satcorps.qualityFlags, ['retrieval-quality-below-threshold']);
  assert.ok(report.alerts.some(alert => alert.stage === 'transformation' && alert.provider === 'satcorps'));
});

test('a bundle cannot claim advancement after the pointer was retrieved', () => {
  const report = evaluateEarthProductionHealth(healthySnapshot({
    delivery: {
      originAvailable: true, cdnAvailable: true,
      originBundleId: 'earth-2026-08-29T07:00Z', cdnBundleId: 'earth-2026-08-29T07:00Z',
      latestManifestRetrievedAt: '2026-08-29T01:00:00Z',
      latestManifestAdvancedAt: '2026-08-29T07:59:00Z',
    },
  }), policy);
  assert.equal(report.status, 'failing');
  assert.ok(report.alerts.some(alert => alert.code === 'latest-chronology-invalid'));
});
