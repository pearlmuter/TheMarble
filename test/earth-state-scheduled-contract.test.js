import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readYaml = async path => parse(await read(path));
const readJson = async path => JSON.parse(await read(path));

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
    assert.match(steps[verify].run, /--policy config\/earth-production-policy\.json/);
    // Both mutable pointers reach the origin, or the adaptive tier index silently disappears.
    assert.match(uploadStep.run, /for pointer in latest\.json latest-presentations\.json/);
    assert.equal(workflow.permissions.contents, 'read');
  }
});

test('the feed commands and acceptance thresholds are versioned with the app', async () => {
  const packageDocument = await readJson('package.json');
  const policy = await readJson('config/earth-production-policy.json');
  assert.equal(policy.acceptance.minimumCloudObservedFraction, 0.5);
  assert.equal(policy.acceptance.maximumCryosphereAgeDays, 3);
  assert.equal(packageDocument.scripts['publish:earth-state-feed'], 'node scripts/publish-earth-state-feed.mjs');
  assert.equal(packageDocument.scripts['build:cryosphere-catalog'], 'node scripts/build-cryosphere-catalog.mjs');
  assert.equal(packageDocument.scripts['verify:earth-state-feed'], 'node scripts/verify-earth-state-feed.mjs');
  assert.equal(packageDocument.scripts['preview:live'], 'node scripts/preview-live-earth-state.mjs');
  assert.equal(packageDocument.scripts['feed:serve'], 'node scripts/serve-earth-state-feed.mjs');
});

test('the corrupt-pointer half of the smoke check runs where a served app already exists', async () => {
  const workflow = await readYaml('.github/workflows/earth-production-health.yml');
  const steps = workflow.jobs.monitor.steps;
  const names = steps.map(step => step.name);
  const verify = names.indexOf('Verify the served feed and its degraded behaviour');
  assert.ok(verify > names.indexOf('Start monitored client'));
  assert.match(steps[verify].run, /--app-url http:\/\/127\.0\.0\.1:4173\//);
  assert.equal(steps[verify].id, 'feed');
  assert.match(steps[names.indexOf('Enforce production health')].run, /steps\.feed\.outcome/);
});
