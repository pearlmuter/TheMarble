import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
    'ims-snow-ice', 'gmasi-snow', 'gmasi-sea-ice', 'amsr2-snow', 'amsr2-sea-ice', 'viirs-snow',
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
  assert.match(source, /page\.route/);
  assert.match(source, /if \(!report\.ok\) process\.exitCode = 1/);
});

test('local visual acceptance publishes a real state and opens the app against it', async () => {
  const source = await read('scripts/preview-live-earth-state.mjs');
  assert.match(source, /publish-earth-state-feed\.mjs/);
  assert.match(source, /VITE_EARTH_STATE_LATEST_URL/);
  assert.match(source, /preview_cryosphere_fixture\.py/);
  // The stand-in cryosphere must never be presented as an observation.
  const fixture = await read('scripts/preview_cryosphere_fixture.py');
  assert.match(fixture, /never an observation/);
  assert.match(fixture, /local-preview-fixture/);
  assert.match(fixture, /Local preview fixture \(not an observation\)/);
});
