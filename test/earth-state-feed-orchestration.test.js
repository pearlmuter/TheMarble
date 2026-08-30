import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateEarthStateFeedRun, readEarthStateFeedLayers, readEarthStateFeedRunReport, readPublicationOutcome, representativeEarthStateAssetHref } from '../src/earth-state-feed-orchestration.js';

const cloudFrame = validAt => ({
  validAt,
  observedFrom: validAt,
  observedTo: `${validAt.slice(0, 14)}59:59Z`,
  coverage: { observedFraction: 0.96, modelAssistedFraction: 0.03, fallbackFraction: 0.01 },
  layers: { cloudOpacity: { datasetId: 'gmgsi' }, cloudDensity: { datasetId: 'gmgsi' } },
});

const manifest = (options = {}) => ({
  bundleId: options.bundleId ?? 'source-gmgsi-2026-08-30T11:00:00Z',
  classification: 'observed',
  datasets: [],
  times: { validAt: options.cloudValidAt ?? '2026-08-30T11:00:00Z' },
  layers: {
    surfaceAlbedo: {},
    ...(options.snowValidAt === null ? {} : {
      snowCover: { provenance: { validAt: options.snowValidAt ?? '2026-08-30T00:00:00Z' } },
      seaIce: { provenance: { validAt: options.seaIceValidAt ?? options.snowValidAt ?? '2026-08-30T00:00:00Z' } },
    }),
  },
  ...(options.cloudValidAt === null ? {} : {
    cloudSequence: {
      provider: options.provider ?? 'gmgsi',
      transitionSeconds: 300,
      frames: options.frames ?? [
        cloudFrame(options.previousCloudValidAt ?? '2026-08-30T10:00:00Z'),
        cloudFrame(options.cloudValidAt ?? '2026-08-30T11:00:00Z'),
      ],
    },
  }),
});

const layers = options => readEarthStateFeedLayers(manifest(options));

const stage = (name, status, options = {}) => ({ name, status, ...options });

test('the feed layers of a published bundle expose each independently scheduled valid time', () => {
  const state = layers({});
  assert.equal(state.bundleId, 'source-gmgsi-2026-08-30T11:00:00Z');
  assert.deepEqual(state.clouds, {
    provider: 'gmgsi',
    validAt: '2026-08-30T11:00:00Z',
    observedFrom: '2026-08-30T10:00:00Z',
    observedTo: '2026-08-30T11:59:59Z',
    hours: ['2026-08-30T10:00:00Z', '2026-08-30T11:00:00Z'],
  });
  assert.deepEqual(state.snowCover, { validAt: '2026-08-30T00:00:00Z' });
  assert.deepEqual(state.seaIce, { validAt: '2026-08-30T00:00:00Z' });
});

test('a bundle without contemporary layers reports their absence rather than inventing a valid time', () => {
  const state = layers({ cloudValidAt: null, snowValidAt: null });
  assert.equal(state.clouds, undefined);
  assert.equal(state.snowCover, undefined);
  assert.equal(state.seaIce, undefined);
});

test('an hourly cloud advance preserves the daily cryosphere layers it inherited', () => {
  const result = evaluateEarthStateFeedRun({
    before: layers({ cloudValidAt: '2026-08-30T11:00:00Z' }),
    after: layers({ cloudValidAt: '2026-08-30T12:00:00Z', previousCloudValidAt: '2026-08-30T11:00:00Z' }),
    stages: [
      stage('clouds', 'published', { validAt: '2026-08-30T12:00:00Z' }),
      stage('cryosphere', 'unchanged', { validAt: '2026-08-30T00:00:00Z' }),
    ],
  });
  assert.equal(result.severity, 'ok');
  assert.equal(result.coherent, true);
  assert.deepEqual(result.advanced, ['clouds']);
  assert.deepEqual(result.retained, ['snowCover', 'seaIce']);
  assert.deepEqual(result.problems, []);
});

test('a daily cryosphere advance preserves the hourly cloud sequence it inherited', () => {
  const result = evaluateEarthStateFeedRun({
    before: layers({ snowValidAt: '2026-08-29T00:00:00Z' }),
    after: layers({ snowValidAt: '2026-08-30T00:00:00Z' }),
    stages: [
      stage('clouds', 'unchanged', { validAt: '2026-08-30T11:00:00Z' }),
      stage('cryosphere', 'published', { validAt: '2026-08-30T00:00:00Z' }),
    ],
  });
  assert.equal(result.severity, 'ok');
  assert.deepEqual(result.advanced, ['snowCover', 'seaIce']);
  assert.deepEqual(result.retained, ['clouds']);
});

test('an older cloud source may never regress the published cloud valid time', () => {
  const result = evaluateEarthStateFeedRun({
    before: layers({ cloudValidAt: '2026-08-30T12:00:00Z', previousCloudValidAt: '2026-08-30T11:00:00Z' }),
    after: layers({ cloudValidAt: '2026-08-30T11:00:00Z', previousCloudValidAt: '2026-08-30T10:00:00Z' }),
    stages: [stage('clouds', 'published', { validAt: '2026-08-30T11:00:00Z' })],
  });
  assert.equal(result.coherent, false);
  assert.equal(result.severity, 'broken');
  assert.deepEqual(result.problems.map(problem => problem.layer), ['clouds']);
  assert.match(result.problems[0].reason, /regress/i);
});

test('an older cryosphere analysis may never regress a published snow or sea-ice valid time', () => {
  const result = evaluateEarthStateFeedRun({
    before: layers({ snowValidAt: '2026-08-30T00:00:00Z' }),
    after: layers({ snowValidAt: '2026-08-29T00:00:00Z' }),
    stages: [stage('cryosphere', 'published', { validAt: '2026-08-29T00:00:00Z' })],
  });
  assert.equal(result.coherent, false);
  assert.deepEqual(result.problems.map(problem => problem.layer), ['snowCover', 'seaIce']);
});

test('a layer that disappears from the combined state is a broken run, not a silent simplification', () => {
  const result = evaluateEarthStateFeedRun({
    before: layers({}),
    after: layers({ cloudValidAt: '2026-08-30T12:00:00Z', previousCloudValidAt: '2026-08-30T11:00:00Z', snowValidAt: null }),
    stages: [stage('clouds', 'published', { validAt: '2026-08-30T12:00:00Z' })],
  });
  assert.equal(result.coherent, false);
  assert.deepEqual(result.problems.map(problem => problem.reason), [
    'snowCover disappeared from the combined Earth state',
    'seaIce disappeared from the combined Earth state',
  ]);
});

test('provider lateness leaves the run degraded while the previous coherent Earth stays published', () => {
  const before = layers({});
  const result = evaluateEarthStateFeedRun({
    before,
    after: before,
    stages: [
      stage('clouds', 'failed', { reason: 'GMGSI discovery did not find two adjacent complete GMGSI hours' }),
      stage('cryosphere', 'unchanged', { validAt: '2026-08-30T00:00:00Z' }),
    ],
  });
  assert.equal(result.coherent, true);
  assert.equal(result.severity, 'degraded');
  assert.deepEqual(result.advanced, []);
  assert.deepEqual(result.retained, ['clouds', 'snowCover', 'seaIce']);
  assert.deepEqual(result.problems, [{
    stage: 'clouds',
    reason: 'GMGSI discovery did not find two adjacent complete GMGSI hours',
  }]);
});

test('a publication claim that the combined state does not bear out is broken', () => {
  const before = layers({});
  const result = evaluateEarthStateFeedRun({
    before,
    after: before,
    stages: [stage('clouds', 'published', { validAt: '2026-08-30T12:00:00Z' })],
  });
  assert.equal(result.coherent, false);
  assert.equal(result.severity, 'broken');
  assert.match(result.problems[0].reason, /published 2026-08-30T12:00:00Z/);
});

test('the combined state must still carry two adjacent observed cloud hours', () => {
  const result = evaluateEarthStateFeedRun({
    before: layers({}),
    after: layers({
      cloudValidAt: '2026-08-30T12:00:00Z',
      frames: [cloudFrame('2026-08-30T09:00:00Z'), cloudFrame('2026-08-30T12:00:00Z')],
    }),
    stages: [stage('clouds', 'published', { validAt: '2026-08-30T12:00:00Z' })],
  });
  assert.equal(result.coherent, false);
  assert.match(result.problems[0].reason, /adjacent/i);
});

test('an unknown stage status is refused rather than quietly accepted', () => {
  assert.throws(() => evaluateEarthStateFeedRun({
    before: layers({}),
    after: layers({}),
    stages: [stage('clouds', 'probably-fine')],
  }), /stage status/i);
});

test('a producer outcome survives the compositor output sharing its stream', () => {
  const stdout = [
    'Compositing GMGSI hour 2026-08-30T17:00:00Z',
    '{',
    '  "coverage": { "observedFraction": 0.95 }',
    '}',
    '{',
    '  "status": "published",',
    '  "validAt": "2026-08-30T17:00:00Z"',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(readPublicationOutcome(stdout), { status: 'published', validAt: '2026-08-30T17:00:00Z' });
});

test('a producer outcome is found even when a later object follows it', () => {
  // The orchestrator prints its run report after each producer's outcome.
  const stdout = [
    '{', '  "status": "unchanged",', '  "validAt": "2026-08-30T18:00:00Z"', '}',
    '{', '  "severity": "ok",', '  "advanced": []', '}', '',
  ].join('\n');
  assert.deepEqual(readPublicationOutcome(stdout), { status: 'unchanged', validAt: '2026-08-30T18:00:00Z' });
  assert.deepEqual(readEarthStateFeedRunReport(stdout), { severity: 'ok', advanced: [] });
});

test('a producer that reports no outcome is not mistaken for a successful publication', () => {
  assert.equal(readPublicationOutcome('Compositing…\nDone.\n'), undefined);
  assert.equal(readPublicationOutcome('{\n  "coverage": { "observedFraction": 0.95 }\n}\n'), undefined);
});

test('the delivery probe samples an asset the newest cloud frame actually published', () => {
  const asset = href => ({ asset: { href } });
  assert.equal(representativeEarthStateAssetHref({
    layers: { surfaceAlbedo: asset('../../assets/surface.ktx2') },
    cloudSequence: { frames: [{ layers: { cloudOpacity: asset('../../assets/old.ktx2') } }, { layers: { cloudOpacity: asset('../../assets/new.ktx2') } }] },
  }), '../../assets/new.ktx2');
  assert.equal(representativeEarthStateAssetHref({ layers: { surfaceAlbedo: asset('../../assets/surface.ktx2') } }), '../../assets/surface.ktx2');
  assert.equal(representativeEarthStateAssetHref({ layers: {} }), undefined);
});
