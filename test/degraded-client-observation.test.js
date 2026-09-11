import test from 'node:test';
import assert from 'node:assert/strict';
import { observeDegradedClient } from '../scripts/lib/degraded-client-observation.mjs';
import { evaluateEarthStateFeedAcceptance } from '../src/earth-state-feed-acceptance.js';

function slowClient() {
  const calls = [];
  const page = {
    async addInitScript(...args) { calls.push(['init', ...args]); },
    async route(matches, handler) {
      assert.ok(matches(new URL('https://earth.test/latest.json')));
      await handler({ fulfill: async response => assert.throws(() => JSON.parse(response.body)) });
    },
    async goto() {},
    async waitForSelector(selector, { timeout }) {
      calls.push(['startup', timeout]);
      // The observed failure: packaged Earth needs more than two minutes on
      // SwiftShader, but is still inside the app's own activation deadline.
      if (timeout < 140_000) throw new Error('Timeout 120000ms exceeded during bundled startup');
    },
    async waitForFunction(predicate, unused, { timeout }) { calls.push(['refresh', timeout]); },
    locator() { return { evaluate: async () => ({ bundleId: 'verified-bundle', runtimeSource: 'bundled-fallback', refresh: 'failed' }) }; },
  };
  return { page, calls };
}

test('fallback verification permits slow valid startup before observing the corrupt refresh', async () => {
  const { page, calls } = slowClient();
  const observation = await observeDegradedClient(page, { appUrl: 'http://app.test', latestUrl: 'https://earth.test/latest.json' });
  assert.equal(observation.bundleId, 'verified-bundle');
  assert.equal(observation.refresh, 'failed');
  assert.equal(calls.find(call => call[0] === 'startup')[1], calls.find(call => call[0] === 'refresh')[1]);
  assert.equal(calls[0][0], 'init');
  assert.equal(calls[0][2], 4);
});

test('a failed browser startup retains the error and cannot pass as verified fallback', async () => {
  const { page } = slowClient();
  page.waitForSelector = async () => { throw new Error('Bundled state never became ready'); };
  const degraded = await observeDegradedClient(page, { appUrl: 'http://app.test', latestUrl: 'https://earth.test/latest.json' });
  assert.equal(degraded.error, 'Bundled state never became ready');
  assert.equal(degraded.bundleId, '');
  const acceptance = evaluateEarthStateFeedAcceptance({
    manifest: { bundleId: 'live' }, checkedAt: '2026-09-11T06:00:00Z', degraded,
  });
  assert.equal(acceptance.ok, false);
  assert.ok(acceptance.failures.includes('A degraded latest response left no verified Earth state active'));
});
