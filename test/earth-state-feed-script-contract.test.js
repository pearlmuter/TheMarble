import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readJson = async path => JSON.parse(await read(path));

test('the feed orchestrator runs both producers against one published state and verifies the result', async () => {
  const source = await read('scripts/publish-earth-state-feed.mjs');
  assert.match(source, /readEarthStateFeedLayers/);
  assert.match(source, /evaluateEarthStateFeedRun/);
  // Both producers must read the same output directory so each inherits the newest bundle.
  assert.match(source, /publish-gmgsi-earth-state\.mjs/);
  assert.match(source, /publish-cloud-earth-state\.mjs/);
  assert.match(source, /publish-cryosphere-earth-state\.mjs/);
  assert.ok(source.indexOf("publishedLayers(outputDirectory)") < source.indexOf('const stages'));
  assert.match(source, /if \(!report\.coherent\) process\.exitCode = 1/);
});

test('the catalog builder keeps provider credentials and endpoints out of its output', async () => {
  const source = await read('scripts/build-cryosphere-catalog.mjs');
  assert.match(source, /buildCryosphereCatalog/);
  assert.match(source, /newestObservedCryosphereDays/);
  assert.match(source, /cryosphere_provider_adapter\.py/);
  assert.match(source, /authorization\.env/);
  // A failed delivery must not echo a template that can carry a query-string credential.
  assert.doesNotMatch(source, /answered \$\{response\.status\}.*\$\{url\}/);
  assert.match(source, /Provider delivery answered \$\{response\.status\}/);
});

test('a producer outcome is read from the end of a stream its compositors also write to', async () => {
  const source = await read('scripts/publish-earth-state-feed.mjs');
  assert.match(source, /readPublicationOutcome/);
  assert.doesNotMatch(source, /stdout\.indexOf\('\{'\)/);
});

test('the daily source configuration names its endpoints without embedding a secret', async () => {
  const sources = await readJson('config/cryosphere-sources.json');
  const products = sources.sources.map(source => source.product);
  assert.deepEqual(products, [
    'ims-snow-ice', 'gmasi-snow', 'gmasi-sea-ice', 'amsr2-snow', 'amsr2-sea-ice', 'viirs-snow', 'osisaf-concentration-nh', 'osisaf-concentration-sh',
  ]);
  for (const source of sources.sources) {
    assert.ok(source.urlTemplateEnv, `${source.product} must be overridable without editing the repository`);
    assert.ok(source.version && source.attribution);
  }
  const serialized = JSON.stringify(sources);
  assert.doesNotMatch(serialized, /token=|apikey|api_key|password/i);
  for (const source of sources.sources.filter(entry => entry.urlTemplate === null)) {
    assert.ok(source.reason, `${source.product} must say why it has no public default`);
  }
  const amsr2 = sources.sources.filter(source => source.product.startsWith('amsr2-'));
  assert.ok(amsr2.every(source => source.contingency === true), 'AMSR2 must be declared as a contingency');
  assert.ok(sources.sources.filter(source => source.product.startsWith('gmasi-')).every(source => source.urlTemplate === null),
    'the preferred global analysis endpoint is operations-owned and must not be guessed here');
});

test('the delivery verification probes the origin and the client behaviour a degraded feed produces', async () => {
  const source = await read('scripts/verify-earth-state-feed.mjs');
  assert.match(source, /evaluateEarthStateDelivery/);
  assert.match(source, /evaluateEarthStateFeedAcceptance/);
  assert.match(source, /observeDegradedClient\(page/);
  const observation = await read('scripts/lib/degraded-client-observation.mjs');
  assert.match(observation, /page\.route/);
  // An object store returns cross-origin headers only when asked as a browser asks.
  assert.match(source, /headers: origin \? \{ origin \} : \{\}/);
  assert.match(source, /if \(!report\.ok\) process\.exitCode = 1/);
});

test('a read the edge stalls is retried, and an origin that stays silent is still reported as delivery', async () => {
  const source = await read('scripts/verify-earth-state-feed.mjs');
  // The published feed is megabytes of JSON, and the edge has answered with headers
  // and then sent none of it, timing out a probe against bytes that were served in
  // under a second on the next attempt. One stalled socket is not a delivery verdict.
  assert.match(source, /for \(let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt \+= 1\)/);
  assert.ok(/const PROBE_ATTEMPTS = ([2-9])/.exec(source)?.[1] >= '2', 'a probe must survive one stalled read');
  // The retry must not swallow the failure: an origin that never answers has to
  // reach the delivery rules as a problem, so the retained report names the boundary
  // instead of the run ending on an uncaught timeout with nothing written.
  assert.match(source, /status: 0, headers: \{\}, unreachable/);
  assert.doesNotMatch(source, /signal: AbortSignal\.timeout\(60_000\)/);
});

test('the lightning delivery check abandons a stalled read rather than spending its whole budget on it', async () => {
  const workflow = parse(await read('.github/workflows/lightning.yml'));
  const verify = workflow.jobs.publish.steps.find(step => step.name === 'Verify delivery');
  assert.ok(verify, 'the lightning publication must verify what the CDN serves');
  // A connection that announces the body and then sends nothing used to burn the
  // full --max-time on every attempt; --speed-time ends it in ten seconds instead.
  assert.match(verify.run, /--speed-limit \d+ --speed-time \d+/);
  // The assertion below the fetch requires the served document to be under three
  // minutes old, so the retries have to finish inside that window to mean anything.
  const retryMaxTime = Number(/--retry-max-time (\d+)/.exec(verify.run)?.[1]);
  assert.ok(retryMaxTime > 0 && retryMaxTime < 180, 'the retry window must fit inside the freshness the check asserts');
  assert.match(verify.run, /publishedAt'\]\)<180000/);
});

test('local visual acceptance publishes a real state and opens the app against it', async () => {
  const source = await read('scripts/preview-live-earth-state.mjs');
  assert.match(source, /publish-earth-state-feed\.mjs/);
  assert.match(source, /VITE_EARTH_STATE_LATEST_URL/);
  assert.match(source, /preview_cryosphere_fixture\.py/);
  // Vite copies public/ into every website build, so the preview state must not live there.
  assert.doesNotMatch(source, /PREVIEW_ROOT = 'public/);
  assert.match(source, /PREVIEW_ROOT = 'artifacts/);
  assert.match(source, /serve-earth-state-feed\.mjs/);
  // The invented cryosphere is opt-in: by default snow and ice stay with the seasonal surface.
  assert.match(source, /booleanOption\(options, 'cryosphere-fixture'\)/);
  assert.match(source, /wantsFixture \? await buildFixtureCatalog/);
  // A fixture published by an earlier run must not be inherited once it is switched off.
  assert.match(source, /publishedCarriesFixture/);
  // The stand-in cryosphere must never be presented as an observation.
  const fixture = await read('scripts/preview_cryosphere_fixture.py');
  assert.match(fixture, /never an observation/);
  assert.match(fixture, /local-preview-fixture/);
  assert.match(fixture, /Local preview fixture \(not an observation\)/);
});

test('the local feed daemon serves what the delivery rules require and republishes on a timer', async () => {
  const source = await read('scripts/serve-earth-state-feed.mjs');
  assert.match(source, /earthStateDeliveryHeaders/);
  assert.match(source, /publish-earth-state-feed\.mjs/);
  assert.match(source, /setInterval/);
  assert.match(source, /readEarthStateFeedRunReport/);
  // A request that escapes the served root must never be readable.
  assert.match(source, /startsWith\(`\$\{root\}\$\{sep\}`\)/);
  // A late provider leaves the previous verified state served rather than killing the daemon.
  assert.match(source, /previous verified state stays served/);
});

test('the desktop app is allowed to read the local feed daemon', async () => {
  const configuration = JSON.parse(await read('src-tauri/tauri.conf.json'));
  assert.match(configuration.app.security.csp, /http:\/\/127\.0\.0\.1:8788/);
  assert.match(configuration.app.security.csp, /connect-src[^;]*https:/);
});
