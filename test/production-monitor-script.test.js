import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

function provider(discoveredAt) {
  return {
    latestObservationAt: '2026-08-29T07:00:00Z',
    discoveredAt,
    expectedObservations: 1,
    missingObservations: 0,
    schemaFingerprint: 'cloud-v3',
    expectedSchemaFingerprint: 'cloud-v3',
    dimensions: { width: 4096, height: 2048 },
    expectedDimensions: { width: 4096, height: 2048 },
    corruptProducts: 0,
    coverageFraction: .96,
    qualityFlags: [],
    processingDurationMs: 40_000,
  };
}

const policy = {
  health: {
    providers: {
      satcorps: { maximumDiscoveryLatencyMinutes: 90, maximumMissingObservations: 1, minimumCoverageFraction: .9 },
      gmgsi: { maximumDiscoveryLatencyMinutes: 120, maximumMissingObservations: 1, minimumCoverageFraction: .9 },
    },
    maximumLatestManifestAgeMinutes: 180,
  },
  soak: {
    version: 'themarble-cloud-soak-v1',
    minimumDurationDays: 21,
    minimumSamples: 22,
    maximumSampleGapHours: 2,
    maximumEvaluationWindowDays: 35,
    maximumP95DiscoveryLatencyMinutes: 90,
    maximumMissingFraction: .02,
    minimumMeanCoverageFraction: .9,
    maximumCorruptFraction: 0,
    maximumSchemaChanges: 0,
    maximumDimensionChanges: 0,
    maximumQualityFlagFraction: .01,
    maximumP95InterSourceDisagreementFraction: .15,
  },
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'themarble-monitor-'));
  const paths = Object.fromEntries(['snapshot', 'origin', 'cdn', 'smoke', 'policy'].map(name => [name, join(directory, `${name}.json`)]));
  await writeFile(paths.snapshot, JSON.stringify({
    checkedAt: '2026-08-29T08:00:00Z',
    providers: { satcorps: provider('2026-08-29T07:35:00Z'), gmgsi: provider('2026-08-29T07:42:00Z') },
    transformation: { ok: true, durationMs: 18_000 },
    compositor: { ok: true, durationMs: 64_000 },
    publication: { outcome: 'published', durationMs: 12_000, bundleId: 'earth-current' },
    delivery: { latestManifestRetrievedAt: '2026-08-29T07:40:00Z', latestManifestAdvancedAt: '2026-08-29T07:00:00Z' },
    interSourceDisagreementFraction: .08,
  }));
  await writeFile(paths.origin, JSON.stringify({ schemaVersion: 1, bundleId: 'earth-current' }));
  await writeFile(paths.cdn, JSON.stringify({ schemaVersion: 1, bundleId: 'earth-current' }));
  await writeFile(paths.smoke, JSON.stringify({ ok: true, bundleId: 'earth-current', artifacts: ['day.png', 'terminator.png', 'night.png'], failures: [] }));
  await writeFile(paths.policy, JSON.stringify(policy));
  return { directory, paths };
}

test('the scheduled monitor records health, appends soak history, and emits a promotion decision plus immutable diagnostics', async t => {
  const { directory, paths } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'diagnostics');
  const history = join(directory, 'soak.ndjson');

  await execFileAsync(process.execPath, [
    fileURLToPath(new URL('../scripts/monitor-earth-production.mjs', import.meta.url)),
    '--snapshot', paths.snapshot,
    '--origin-latest', paths.origin,
    '--cdn-latest', paths.cdn,
    '--smoke-report', paths.smoke,
    '--policy', paths.policy,
    '--history', history,
    '--output', output,
    '--now', '2026-08-29T08:00:00Z',
  ]);

  const health = JSON.parse(await readFile(join(output, 'health.json'), 'utf8'));
  const promotion = JSON.parse(await readFile(join(output, 'satcorps-promotion.json'), 'utf8'));
  const immutable = JSON.parse(await readFile(join(output, 'health-2026-08-29T08-00-00Z.json'), 'utf8'));
  const historyLines = (await readFile(history, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(health.status, 'healthy');
  assert.equal(immutable.checkedAt, health.checkedAt);
  assert.equal(promotion.qualified, false);
  assert.equal(historyLines.length, 1);
  assert.equal(historyLines[0].satcorps.discoveryLatencyMinutes, 35);
  assert.equal(historyLines[0].satcorps.schemaFingerprint, 'cloud-v3');
  assert.equal(historyLines[0].interSourceDisagreementFraction, .08);
});

test('repeating a scheduled instant deduplicates its atomically persisted soak sample', async t => {
  const { directory, paths } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const args = [
    fileURLToPath(new URL('../scripts/monitor-earth-production.mjs', import.meta.url)),
    '--snapshot', paths.snapshot, '--origin-latest', paths.origin, '--cdn-latest', paths.cdn,
    '--smoke-report', paths.smoke, '--policy', paths.policy,
    '--history', join(directory, 'soak.ndjson'), '--output', join(directory, 'diagnostics'),
    '--now', '2026-08-29T08:00:00Z',
  ];
  await execFileAsync(process.execPath, args);
  await execFileAsync(process.execPath, args);
  const history = (await readFile(join(directory, 'soak.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(history.length, 1);
});

test('missing external snapshot and smoke evidence still retain a failing diagnosis and explicit missing soak sample', async t => {
  const { directory, paths } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'diagnostics');
  await assert.rejects(execFileAsync(process.execPath, [
    fileURLToPath(new URL('../scripts/monitor-earth-production.mjs', import.meta.url)),
    '--snapshot', join(directory, 'missing-snapshot.json'),
    '--origin-latest', paths.origin, '--cdn-latest', paths.cdn,
    '--smoke-report', join(directory, 'missing-smoke.json'), '--policy', paths.policy,
    '--history', join(directory, 'soak.ndjson'), '--output', output,
    '--now', '2026-08-29T08:00:00Z',
  ]));
  const health = JSON.parse(await readFile(join(output, 'health.json'), 'utf8'));
  const history = (await readFile(join(directory, 'soak.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(health.status, 'failing');
  assert.equal(history[0].satcorps.missingObservations, 2);
  assert.ok(health.alerts.some(alert => alert.stage === 'client-currentness'));
});

test('delivery mismatch fails the scheduled check after retaining its diagnostic report', async t => {
  const { directory, paths } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(paths.cdn, JSON.stringify({ schemaVersion: 1, bundleId: 'earth-stale' }));
  const output = join(directory, 'diagnostics');

  await assert.rejects(execFileAsync(process.execPath, [
    fileURLToPath(new URL('../scripts/monitor-earth-production.mjs', import.meta.url)),
    '--snapshot', paths.snapshot,
    '--origin-latest', paths.origin,
    '--cdn-latest', paths.cdn,
    '--smoke-report', paths.smoke,
    '--policy', paths.policy,
    '--history', join(directory, 'soak.ndjson'),
    '--output', output,
    '--now', '2026-08-29T08:00:00Z',
  ]));

  const health = JSON.parse(await readFile(join(output, 'health.json'), 'utf8'));
  assert.ok(health.alerts.some(alert => alert.stage === 'delivery'));
});

test('legacy soak rows are migrated without suppressing the current health diagnosis', async t => {
  const { directory, paths } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const historyPath = join(directory, 'soak.ndjson');
  await writeFile(historyPath, `${JSON.stringify({
    checkedAt: '2026-08-28T08:00:00Z',
    satcorps: { discoveryLatencyMinutes: 35, expectedObservations: 1, missingObservations: 0, coverageFraction: .95, corruptProducts: 0, schemaDrift: false, dimensionsChanged: false, qualityFlags: [] },
    gmgsi: { discoveryLatencyMinutes: 42, expectedObservations: 1, missingObservations: 0, coverageFraction: .95, corruptProducts: 0, schemaDrift: false, dimensionsChanged: false, qualityFlags: [] },
    interSourceDisagreementFraction: .08,
  })}\n`);
  await execFileAsync(process.execPath, [
    fileURLToPath(new URL('../scripts/monitor-earth-production.mjs', import.meta.url)),
    '--snapshot', paths.snapshot, '--origin-latest', paths.origin, '--cdn-latest', paths.cdn,
    '--smoke-report', paths.smoke, '--policy', paths.policy, '--history', historyPath,
    '--output', join(directory, 'diagnostics'), '--now', '2026-08-29T08:00:00Z',
  ]);
  const health = JSON.parse(await readFile(join(directory, 'diagnostics', 'health.json'), 'utf8'));
  const promotion = JSON.parse(await readFile(join(directory, 'diagnostics', 'satcorps-promotion.json'), 'utf8'));
  assert.equal(health.status, 'healthy');
  assert.equal(promotion.qualified, false);
});

test('malformed soak history is quarantined, partially recovered, diagnosed, and fails the run', async t => {
  const { directory, paths } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const historyPath = join(directory, 'soak.ndjson');
  const valid = {
    checkedAt: '2026-08-28T08:00:00Z',
    satcorps: { available: true, discoveryLatencyMinutes: 35, expectedObservations: 1, missingObservations: 0, coverageFraction: .95, corruptProducts: 0, schemaDrift: false, dimensionsChanged: false, schemaFingerprint: 'cloud-v3', dimensions: { width: 4096, height: 2048 }, qualityFlags: [] },
    gmgsi: { available: true, discoveryLatencyMinutes: 42, expectedObservations: 1, missingObservations: 0, coverageFraction: .95, corruptProducts: 0, schemaDrift: false, dimensionsChanged: false, schemaFingerprint: 'cloud-v3', dimensions: { width: 4096, height: 2048 }, qualityFlags: [] },
    interSourceDisagreementFraction: .08,
  };
  await writeFile(historyPath, `${JSON.stringify(valid)}\n{}\n{broken-json\n`);
  const output = join(directory, 'diagnostics');
  await assert.rejects(execFileAsync(process.execPath, [
    fileURLToPath(new URL('../scripts/monitor-earth-production.mjs', import.meta.url)),
    '--snapshot', paths.snapshot, '--origin-latest', paths.origin, '--cdn-latest', paths.cdn,
    '--smoke-report', paths.smoke, '--policy', paths.policy, '--history', historyPath,
    '--output', output, '--now', '2026-08-29T08:00:00Z',
  ]));
  const health = JSON.parse(await readFile(join(output, 'health.json'), 'utf8'));
  const promotion = JSON.parse(await readFile(join(output, 'satcorps-promotion.json'), 'utf8'));
  const quarantine = await readFile(join(output, 'soak-history-corrupt-2026-08-29T08-00-00Z.ndjson'), 'utf8');
  const recovered = (await readFile(historyPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(health.status, 'healthy');
  assert.match(promotion.error, /unreadable|malformed/i);
  assert.match(quarantine, /broken-json/);
  assert.equal(recovered.length, 2);
});
