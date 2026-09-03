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

function resettingTransport(outcomes) {
  const requested = [];
  const slept = [];
  return {
    requested,
    slept,
    fetch: async url => {
      requested.push(url);
      const outcome = outcomes[requested.length - 1] ?? 200;
      if (typeof outcome === 'string') throw new TypeError(outcome);
      return response(outcome);
    },
    sleep: async ms => { slept.push(ms); },
  };
}

test('a dropped connection is retried, because it is not a fact about the bundle', async () => {
  // A 112 MB activation crossing a reset connection used to refuse the whole
  // Earth state: only HTTP statuses were retried, and a thrown network error
  // went straight out through every layer above.
  const transport = resettingTransport(['Failed to fetch', 'Failed to fetch', 200]);
  const result = await fetchEarthStateAsset('https://origin.test/a.png', transport);
  assert.equal(result.status, 200);
  assert.equal(transport.requested.length, 3);
  assert.ok(transport.slept[1] > transport.slept[0]);
});

test('a connection that keeps dropping gives up and says so without leaking the URL', async () => {
  const transport = resettingTransport(['Failed to fetch', 'Failed to fetch', 'Failed to fetch', 'Failed to fetch']);
  await assert.rejects(
    () => fetchEarthStateAsset('https://origin.test/a.png?token=secret', transport),
    error => {
      assert.match(error.message, /unreachable after 4 attempts/);
      assert.match(error.message, /Failed to fetch/);
      assert.doesNotMatch(error.message, /secret|origin\.test|https:/);
      return true;
    },
  );
  assert.equal(transport.requested.length, 4);
});

test('a reset connection and a throttled answer can be mixed and still recover', async () => {
  const transport = resettingTransport(['Failed to fetch', 503, 200]);
  assert.equal((await fetchEarthStateAsset('https://origin.test/a.png', transport)).status, 200);
  assert.equal(transport.requested.length, 3);
});

test('an abort during a dropped connection stops instead of retrying it', async () => {
  const signal = { aborted: false };
  const transport = {
    fetch: async () => { signal.aborted = true; throw new TypeError('Failed to fetch'); },
    sleep: async () => {},
    signal,
  };
  await assert.rejects(() => fetchEarthStateAsset('https://origin.test/a.png', transport), /Failed to fetch/);
});
