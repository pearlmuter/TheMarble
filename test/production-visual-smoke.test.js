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

test('a view that is not current production data names the reason in its own failure', async () => {
  const report = await runEarthProductionVisualSmoke({
    appUrl: 'https://marble.test/',
    checkedAt: '2026-08-29T08:00:00Z',
    async captureView({ name }) {
      return {
        screenshot: new Uint8Array([1]),
        bundleId: 'bundled',
        runtimeSource: 'bundled-fallback',
        refresh: 'failed',
        refreshReason: name === 'night' ? 'Earth-state asset unavailable (404) after 4 attempts' : 'Failed to fetch',
        consoleErrors: [],
        pageErrors: [],
      };
    },
    async retainArtifact() {},
  });

  assert.equal(report.ok, false);
  // The whole point: three identical `failed` lines told nobody anything.
  assert.ok(report.failures.some(failure => /night is not current production data: Earth-state asset unavailable \(404\) after 4 attempts/.test(failure)));
  assert.ok(report.failures.some(failure => /day is not current production data: Failed to fetch/.test(failure)));
  assert.deepEqual(report.views.map(view => view.refreshReason), ['Failed to fetch', 'Failed to fetch', 'Earth-state asset unavailable (404) after 4 attempts']);
});

test('a healthy view carries no refresh reason to explain away', async () => {
  const report = await runEarthProductionVisualSmoke({
    appUrl: 'https://marble.test/',
    checkedAt: '2026-08-29T08:00:00Z',
    async captureView() {
      return { screenshot: new Uint8Array([1]), bundleId: 'earth-current', runtimeSource: 'remote', refresh: 'current', consoleErrors: [], pageErrors: [] };
    },
    async retainArtifact() {},
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.views.map(view => view.refreshReason), [undefined, undefined, undefined]);
});
