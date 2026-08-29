import assert from 'node:assert/strict';
import test from 'node:test';
import { runEarthProductionVisualSmoke } from '../src/production-visual-smoke.js';

test('visual smoke renders fixed day, terminator, and night views of one current production bundle', async () => {
  const visits = [];
  const artifacts = new Map();
  const report = await runEarthProductionVisualSmoke({
    appUrl: 'https://marble.test/',
    checkedAt: '2026-08-29T08:00:00Z',
    async captureView({ name, url }) {
      visits.push({ name, url });
      return {
        screenshot: new Uint8Array([name.length, 2, 3]),
        bundleId: 'earth-current',
        runtimeSource: 'remote',
        refresh: 'current',
        consoleErrors: [],
        pageErrors: [],
      };
    },
    async retainArtifact(path, bytes) { artifacts.set(path, bytes); },
  });

  assert.deepEqual(visits.map(item => item.name), ['day', 'terminator', 'night']);
  assert.ok(visits.every(item => new URL(item.url).searchParams.get('time') === '2026-08-29T08:00:00Z'));
  assert.deepEqual(visits.map(item => new URL(item.url).searchParams.get('view')), ['day', 'terminator', 'night']);
  assert.equal(report.ok, true);
  assert.equal(report.bundleId, 'earth-current');
  assert.deepEqual(report.artifacts, ['day.png', 'terminator.png', 'night.png']);
  assert.deepEqual([...artifacts.keys()], report.artifacts);
});

test('visual smoke retains every diagnostic image and fails on fallback, stale, mixed, or errored views', async () => {
  const artifacts = [];
  const responses = {
    day: { bundleId: 'earth-current', runtimeSource: 'remote', refresh: 'current', consoleErrors: [], pageErrors: [] },
    terminator: { bundleId: 'earth-old', runtimeSource: 'remote', refresh: 'failed', consoleErrors: ['network failed'], pageErrors: [] },
    night: { bundleId: 'bundled', runtimeSource: 'bundled-fallback', refresh: 'failed', consoleErrors: [], pageErrors: ['shader error'] },
  };
  const report = await runEarthProductionVisualSmoke({
    appUrl: 'https://marble.test/',
    checkedAt: '2026-08-29T08:00:00Z',
    async captureView({ name }) { return { ...responses[name], screenshot: new Uint8Array([1]) }; },
    async retainArtifact(path) { artifacts.push(path); },
  });

  assert.equal(report.ok, false);
  assert.deepEqual(artifacts, ['day.png', 'terminator.png', 'night.png']);
  assert.ok(report.failures.some(failure => /different bundles/i.test(failure)));
  assert.ok(report.failures.some(failure => /not current/i.test(failure)));
  assert.ok(report.failures.some(failure => /console|page/i.test(failure)));
});
