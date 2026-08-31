import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEarthStateFeedAcceptance } from '../src/earth-state-feed-acceptance.js';

const frame = (validAt, options = {}) => ({
  validAt,
  observedFrom: validAt,
  observedTo: options.observedTo ?? `${validAt.slice(0, 14)}59:59Z`,
  coverage: {
    observedFraction: options.observedFraction ?? 0.94,
    modelAssistedFraction: options.modelAssistedFraction ?? 0.05,
    fallbackFraction: options.fallbackFraction ?? 0.01,
  },
  layers: { cloudOpacity: { datasetId: 'gmgsi-vis' }, cloudDensity: { datasetId: 'gmgsi-lw' } },
});

const cryosphere = (validAt, options = {}) => ({
  provenance: {
    validAt,
    producedAt: options.producedAt ?? `${validAt.slice(0, 10)}T04:00:00Z`,
    sourceVersion: options.sourceVersion ?? 'ims-v1.3 + gmasi-v3',
    attribution: options.attribution ?? 'U.S. National Ice Center IMS; NOAA/NESDIS GMASI, modified by TheMarble',
    coverage: { observedFraction: options.observedFraction ?? 0.98, fallbackFraction: options.fallbackFraction ?? 0.02 },
  },
});

const manifest = (options = {}) => ({
  bundleId: 'themarble-2026-08-30T12-00-00Z-a1b2c3d4e5f60718',
  classification: options.classification ?? 'observed',
  datasets: [{ id: 'gmgsi-vis', version: 'v1', attribution: 'NOAA GMGSI, modified by TheMarble' }],
  times: { validAt: '2026-08-30T12:00:00Z' },
  layers: {
    surfaceAlbedo: {},
    nightLights: {},
    cloudOpacity: {},
    cloudDensity: {},
    ...(options.snowValidAt === null ? {} : { snowCover: cryosphere(options.snowValidAt ?? '2026-08-30T00:00:00Z', options.snow) }),
    ...(options.seaIceValidAt === null ? {} : { seaIce: cryosphere(options.seaIceValidAt ?? '2026-08-30T00:00:00Z', options.seaIce) }),
  },
  ...(options.cloudSequence === null ? {} : {
    cloudSequence: {
      provider: options.provider ?? 'gmgsi',
      transitionSeconds: 300,
      frames: options.frames ?? [frame('2026-08-30T11:00:00Z'), frame('2026-08-30T12:00:00Z', options.newestFrame)],
    },
  }),
});

const accept = (options = {}, checkedAt = '2026-08-30T13:10:00Z') => evaluateEarthStateFeedAcceptance({
  manifest: manifest(options),
  checkedAt,
});

test('a served state with two recent observed hours and a paired daily cryosphere is accepted', () => {
  const report = accept();
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  assert.equal(report.clouds.provider, 'gmgsi');
  assert.equal(report.clouds.ageMinutes, 70);
  assert.deepEqual(report.clouds.hours, ['2026-08-30T11:00:00Z', '2026-08-30T12:00:00Z']);
  assert.equal(report.cryosphere.validAt, '2026-08-30T00:00:00Z');
});

test('a bundle still on its packaged static clouds has not connected to the live feed', () => {
  const report = accept({ cloudSequence: null });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /two recent observed/i);
});

test('a single observed hour cannot support the crossfade the renderer promises', () => {
  const report = accept({ frames: [frame('2026-08-30T12:00:00Z')] });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /two adjacent/i);
});

test('two non-adjacent hours are refused rather than presented as a continuous sequence', () => {
  const report = accept({ frames: [frame('2026-08-30T09:00:00Z'), frame('2026-08-30T12:00:00Z')] });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /adjacent/i);
});

test('cloud observations older than the documented delivery expectation fail the smoke check', () => {
  const report = accept({}, '2026-08-30T20:00:00Z');
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /cloud observations are \d+ minutes old/i);
});

test('a mostly unobserved cloud frame is not a live observation-led state', () => {
  const report = accept({ newestFrame: { observedFraction: 0.2, modelAssistedFraction: 0.79 } });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /observed coverage/i);
});

test('an unrecognised cloud provider is refused rather than trusted by name', () => {
  const report = accept({ provider: 'best-guess' });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /provider/i);
});

test('snow without sea ice is an unpaired daily analysis, not a complete cryosphere', () => {
  const report = accept({ seaIceValidAt: null });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /seaIce/);
});

test('snow and sea ice from different analysis days are refused as an incoherent pair', () => {
  const report = accept({ seaIceValidAt: '2026-08-28T00:00:00Z' });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /same analysis day/i);
});

test('a stale daily analysis is reported with its actual age', () => {
  const report = accept({ snowValidAt: '2026-08-25T00:00:00Z', seaIceValidAt: '2026-08-25T00:00:00Z' });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /5 days/);
});

test('a cryosphere layer without complete provenance cannot be shown as sourced analysis', () => {
  const report = accept({ snow: { sourceVersion: '' } });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /sourceVersion/);
});

test('attribution that presents the result as unaltered provider imagery is refused', () => {
  const report = accept({ snow: { attribution: 'U.S. National Ice Center IMS' } });
  assert.equal(report.ok, false);
  assert.match(report.failures[0], /modified by TheMarble/);
});

test('a waived cryosphere requirement records the absence instead of failing', () => {
  const waivedReport = evaluateEarthStateFeedAcceptance({
    manifest: manifest({ snowValidAt: null, seaIceValidAt: null }),
    checkedAt: '2026-08-30T13:10:00Z',
    policy: { requireCryosphere: false },
  });
  assert.equal(waivedReport.ok, true);
  assert.deepEqual(waivedReport.failures, []);
  assert.match(waivedReport.waived[0], /missing paired daily/);
  // Waiving never invents a layer.
  assert.equal(waivedReport.cryosphere, undefined);

  const required = evaluateEarthStateFeedAcceptance({
    manifest: manifest({ snowValidAt: null, seaIceValidAt: null }),
    checkedAt: '2026-08-30T13:10:00Z',
  });
  assert.equal(required.ok, false);
});

test('an unavailable or corrupt latest response must leave a verified globe visible', () => {
  const degraded = observation => evaluateEarthStateFeedAcceptance({
    manifest: manifest(),
    checkedAt: '2026-08-30T13:10:00Z',
    degraded: observation,
  });
  assert.equal(degraded({ runtimeSource: 'bundled-fallback', refresh: 'failed', bundleId: 'bundled-v1' }).ok, true);
  assert.equal(degraded({ runtimeSource: 'offline-cache', refresh: 'failed', bundleId: 'themarble-2026-08-30T11-00-00Z-aaaa' }).ok, true);
  assert.equal(degraded({ runtimeSource: 'remote', refresh: 'failed', bundleId: 'themarble-2026-08-30T11-00-00Z-aaaa' }).ok, true);

  const blank = degraded({ runtimeSource: 'bundled-fallback', refresh: 'failed', bundleId: '' });
  assert.equal(blank.ok, false);
  assert.match(blank.failures[0], /no verified Earth state/i);

  const pretending = degraded({ runtimeSource: 'remote', refresh: 'current', bundleId: 'themarble-2026-08-30T11-00-00Z-aaaa' });
  assert.equal(pretending.ok, false);
  assert.match(pretending.failures[0], /reported a current remote refresh/i);
});
