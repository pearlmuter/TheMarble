import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyEarthStateDeliveryPath, earthStateDeliveryHeaders, evaluateEarthStateDelivery } from '../src/earth-state-delivery.js';

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const POINTER_CACHE = 'public, max-age=30, must-revalidate';

const probe = (path, options = {}) => ({
  url: options.url ?? `https://earth.themarble.test/earth-state/${path}`,
  status: options.status ?? 200,
  headers: {
    'access-control-allow-origin': '*',
    'content-type': options.contentType ?? (path.endsWith('.json') ? 'application/json' : 'image/ktx2'),
    'cache-control': options.cacheControl
      ?? (classifyEarthStateDeliveryPath(path) === 'pointer' ? POINTER_CACHE : IMMUTABLE_CACHE),
    ...options.headers,
  },
});

const originProbes = (overrides = {}) => [
  overrides.pointer ?? probe('latest.json'),
  overrides.presentations ?? probe('latest-presentations.json'),
  overrides.manifest ?? probe('bundles/2026-08-30T12-00-00Z-a1b2c3d4e5f60718/manifest.json'),
  overrides.asset ?? probe('assets/3f2a9c6d8e1b4a70c5d2e9f80a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d.ktx2'),
];

const evaluate = (overrides, options = {}) => evaluateEarthStateDelivery({
  origin: 'https://earth.themarble.test/earth-state/',
  clientOrigins: options.clientOrigins ?? ['https://themarble.test', 'tauri://localhost'],
  probes: originProbes(overrides),
  checkedAt: '2026-08-30T12:05:00Z',
});

test('published paths are classified by the mutability the publisher actually gives them', () => {
  assert.equal(classifyEarthStateDeliveryPath('latest.json'), 'pointer');
  assert.equal(classifyEarthStateDeliveryPath('latest-presentations.json'), 'pointer');
  assert.equal(classifyEarthStateDeliveryPath('bundles/2026-08-30T12-00-00Z-a1b2c3d4e5f60718/manifest.json'), 'immutable');
  assert.equal(classifyEarthStateDeliveryPath('assets/3f2a9c6d.ktx2'), 'immutable');
  assert.equal(classifyEarthStateDeliveryPath('bundles/2026-08-30T12-00-00Z-a1b2c3d4e5f60718/assets/opacity-01.png'), 'immutable');
});

test('an origin that serves immutable assets and a revalidated pointer over HTTPS satisfies both clients', () => {
  const report = evaluate();
  assert.equal(report.ok, true);
  assert.deepEqual(report.problems, []);
  assert.equal(report.checkedAt, '2026-08-30T12:05:00Z');
  assert.equal(report.probes.length, 4);
});

test('a pointer cached like an immutable asset would strand every client on a stale Earth', () => {
  const report = evaluate({ pointer: probe('latest.json', { cacheControl: IMMUTABLE_CACHE }) });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /latest\.json/);
  assert.match(report.problems[0].reason, /revalidat/i);
});

test('a pointer must not be cached longer than one refresh interval', () => {
  const report = evaluate({ pointer: probe('latest.json', { cacheControl: 'public, max-age=3600, must-revalidate' }) });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /max-age/);
});

test('an immutable asset served without long-lived immutable caching wastes the content-addressed store', () => {
  const report = evaluate({ asset: probe('assets/3f2a9c6d.ktx2', { cacheControl: 'no-store' }) });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /immutable/);
});

test('a missing cross-origin header blocks the website even when the bytes are correct', () => {
  const report = evaluate({
    manifest: probe('bundles/2026-08-30T12-00-00Z-a1b2c3d4e5f60718/manifest.json', {
      headers: { 'access-control-allow-origin': undefined },
    }),
  });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /access-control-allow-origin/);
});

test('an origin restricted to the website alone locks out the Tauri webview origin', () => {
  const report = evaluate({
    pointer: probe('latest.json', { headers: { 'access-control-allow-origin': 'https://themarble.test' } }),
  });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /tauri:\/\/localhost/);
});

test('credentialed cross-origin delivery is refused because the feed is public read-only data', () => {
  const report = evaluate({
    pointer: probe('latest.json', { headers: { 'access-control-allow-credentials': 'true' } }),
  });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /credential/i);
});

test('a plaintext origin is refused before any header is considered', () => {
  const report = evaluateEarthStateDelivery({
    origin: 'http://earth.themarble.test/earth-state/',
    clientOrigins: ['https://themarble.test'],
    probes: [probe('latest.json', { url: 'http://earth.themarble.test/earth-state/latest.json' })],
    checkedAt: '2026-08-30T12:05:00Z',
  });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /https/i);
});

test('an unreachable pointer is reported as a delivery failure rather than a cache problem', () => {
  const report = evaluate({ pointer: probe('latest.json', { status: 403 }) });
  assert.equal(report.ok, false);
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0].reason, /403/);
});

test('a JSON pointer served as HTML is refused because clients decode it as an Earth state', () => {
  const report = evaluate({ pointer: probe('latest.json', { contentType: 'text/html; charset=utf-8' }) });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /content-type/i);
});

test('every published path class must be probed before an origin is called production ready', () => {
  const report = evaluateEarthStateDelivery({
    origin: 'https://earth.themarble.test/earth-state/',
    clientOrigins: ['https://themarble.test'],
    probes: [probe('latest.json')],
    checkedAt: '2026-08-30T12:05:00Z',
  });
  assert.equal(report.ok, false);
  assert.match(report.problems[0].reason, /immutable/);
});

test('an origin built from the emitted headers passes the check the same module defines', () => {
  const served = [
    ['latest.json', 'application/json'],
    ['latest-presentations.json', 'application/json'],
    ['bundles/2026-08-30T12-00-00Z-a1b2c3d4e5f60718/manifest.json', 'application/json'],
    ['assets/3f2a9c6d.png', 'image/png'],
  ];
  const report = evaluateEarthStateDelivery({
    origin: 'https://earth.themarble.test/earth-state/',
    clientOrigins: ['https://themarble.test', 'tauri://localhost'],
    probes: served.map(([path, mediaType]) => ({
      url: `https://earth.themarble.test/earth-state/${path}`,
      status: 200,
      headers: earthStateDeliveryHeaders(path, mediaType),
    })),
    checkedAt: '2026-08-30T12:05:00Z',
  });
  assert.equal(report.ok, true, JSON.stringify(report.problems));
});

test('the emitted pointer headers keep a client from caching a superseded Earth', () => {
  const pointer = earthStateDeliveryHeaders('latest.json', 'application/json');
  assert.match(pointer['cache-control'], /must-revalidate/);
  assert.equal(pointer['access-control-allow-origin'], '*');
  const asset = earthStateDeliveryHeaders('assets/abc.ktx2', 'image/ktx2');
  assert.match(asset['cache-control'], /immutable/);
});
