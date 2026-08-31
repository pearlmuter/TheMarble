import assert from 'node:assert/strict';
import test from 'node:test';
import {
  earthStateRetryDelayMs,
  fetchEarthStateAsset,
  isRetryableEarthStateStatus,
} from '../src/earth-state-transport.js';

const response = (status, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => headers[name] },
});

function recordingTransport(statuses) {
  const requested = [];
  const slept = [];
  return {
    requested,
    slept,
    fetch: async url => { requested.push(url); return response(statuses[requested.length - 1] ?? 200); },
    sleep: async ms => { slept.push(ms); },
  };
}

test('a throttled answer is retried rather than failing the whole Earth state', async () => {
  const transport = recordingTransport([429, 429, 200]);
  const result = await fetchEarthStateAsset('https://origin.test/a.png', transport);
  assert.equal(result.status, 200);
  assert.equal(transport.requested.length, 3);
  // Each wait is longer than the last, so a throttled store is given room.
  assert.ok(transport.slept[1] > transport.slept[0]);
});

test('a missing asset is a fact about the bundle and is not retried', async () => {
  const transport = recordingTransport([404]);
  await assert.rejects(
    () => fetchEarthStateAsset('https://origin.test/gone.png', transport),
    /unavailable \(404\)/,
  );
  assert.equal(transport.requested.length, 1);
  assert.deepEqual(transport.slept, []);
});

test('a store that stays throttled gives up and reports what it answered', async () => {
  const transport = recordingTransport([503, 503, 503, 503]);
  await assert.rejects(
    () => fetchEarthStateAsset('https://origin.test/a.png', transport),
    /unavailable \(503\) after 4 attempts/,
  );
  assert.equal(transport.requested.length, 4);
});

test('a server that states Retry-After is obeyed rather than guessed at', () => {
  assert.equal(earthStateRetryDelayMs(1, '2'), 2000);
  assert.equal(earthStateRetryDelayMs(1, undefined) < earthStateRetryDelayMs(3, undefined), true);
  // A server asking for longer than we are willing to wait is capped.
  assert.equal(earthStateRetryDelayMs(1, '600'), 8000);
});

test('only answers that can differ next time are retried', () => {
  for (const status of [429, 503, 502, 504, 500, 408]) assert.equal(isRetryableEarthStateStatus(status), true);
  for (const status of [400, 403, 404, 410]) assert.equal(isRetryableEarthStateStatus(status), false);
});

test('an aborted activation stops immediately instead of retrying', async () => {
  const transport = { ...recordingTransport([429]), };
  await assert.rejects(
    () => fetchEarthStateAsset('https://origin.test/a.png', { ...transport, signal: { aborted: true } }),
    /aborted/,
  );
});
