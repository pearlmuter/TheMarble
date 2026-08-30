import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readYaml = async path => parse(await read(path));
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
  assert.match(source, /cryosphere_provider_adapter\.py/);
  assert.match(source, /authorization\.env/);
  // A failed delivery must not echo a template that can carry a query-string credential.
  assert.doesNotMatch(source, /answered \$\{response\.status\}.*\$\{url\}/);
  assert.match(source, /Provider delivery answered \$\{response\.status\}/);
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

test('scheduled publication polls for clouds every ten minutes and for the cryosphere daily', async () => {
  const clouds = await readYaml('.github/workflows/earth-state-clouds.yml');
  const cryosphere = await readYaml('.github/workflows/earth-state-cryosphere.yml');
  assert.deepEqual(clouds.on.schedule, [{ cron: '*/10 * * * *' }]);
  assert.ok(cryosphere.on.schedule.every(entry => /^\d+ [\d,]+ \* \* \*$/.test(entry.cron)));
  // One publication group: the hourly and daily producers must never race for latest.json.
  assert.equal(clouds.concurrency.group, 'earth-state-publication');
  assert.equal(cryosphere.concurrency.group, clouds.concurrency.group);
  assert.equal(clouds.concurrency['cancel-in-progress'], false);
  assert.equal(cryosphere.concurrency['cancel-in-progress'], false);
});

test('every scheduled publication inherits the served state, uploads assets before the pointer, and verifies delivery', async () => {
  for (const path of ['.github/workflows/earth-state-clouds.yml', '.github/workflows/earth-state-cryosphere.yml']) {
    const workflow = await readYaml(path);
    const steps = workflow.jobs.publish.steps;
    const names = steps.map(step => step.name);
    const retrieve = names.indexOf('Retrieve the published Earth state');
    const upload = names.indexOf('Upload immutable assets before the latest pointer');
    const verify = names.indexOf('Verify the served feed');
    assert.ok(retrieve >= 0 && upload > retrieve && verify > upload, `${path} must retrieve, publish, upload, then verify`);
    const uploadStep = steps[upload];
    assert.match(uploadStep.run, /--exclude 'latest\*\.json'/);
    assert.match(uploadStep.run, /max-age=31536000, immutable/);
    assert.match(uploadStep.run, /max-age=30, must-revalidate/);
    // The pointer copy must come after the immutable sync, never before.
    assert.ok(uploadStep.run.indexOf('aws s3 sync') < uploadStep.run.indexOf('latest.json'));
    assert.match(steps[verify].run, /verify:earth-state-feed/);
    assert.equal(workflow.permissions.contents, 'read');
  }
});

test('the feed commands are versioned with the app', async () => {
  const packageDocument = await readJson('package.json');
  assert.equal(packageDocument.scripts['publish:earth-state-feed'], 'node scripts/publish-earth-state-feed.mjs');
  assert.equal(packageDocument.scripts['build:cryosphere-catalog'], 'node scripts/build-cryosphere-catalog.mjs');
  assert.equal(packageDocument.scripts['verify:earth-state-feed'], 'node scripts/verify-earth-state-feed.mjs');
  assert.equal(packageDocument.scripts['preview:live'], 'node scripts/preview-live-earth-state.mjs');
});
