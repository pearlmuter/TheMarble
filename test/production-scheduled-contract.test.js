import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

test('the app exposes its current verified bundle to a non-visual production smoke client', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(source, /earthStateSummary\.dataset\.bundleId/);
  assert.match(source, /earthStateSummary\.dataset\.runtimeSource/);
  assert.match(source, /earthStateSummary\.dataset\.refresh/);
  // A failed refresh that cannot say why is why the scheduled health run could
  // report three bundled-fallback views with nothing to diagnose.
  assert.match(source, /earthStateSummary\.dataset\.refreshReason/);
  assert.match(source, /summarizeEarthStateRefreshFailure\(error\)/);
  assert.doesNotMatch(source, /\}\s*catch\s*\{\s*\n\s*\/\/ Missing or invalid production state/);
});

test('the production smoke adapter uses a real browser and retains its report', async () => {
  const source = await readFile(new URL('../scripts/smoke-earth-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /from 'playwright'/);
  assert.match(source, /runEarthProductionVisualSmoke/);
  assert.match(source, /page\.screenshot/);
  assert.ok(source.indexOf('catch (error)') < source.indexOf('page.screenshot'));
  assert.match(source, /smoke-report\.json/);
  assert.match(source, /data-refresh-reason/);
  // The smoke must outwait the app's own activation deadline, or it reports a
  // harness timeout instead of whatever the app was about to say.
  assert.match(source, /EARTH_STATE_ACTIVATION_TIMEOUT_MS/);
  const { EARTH_STATE_ACTIVATION_TIMEOUT_MS } = await import('../src/earth-state.js');
  const [, readyTimeout] = source.match(/const READY_TIMEOUT_MS = EARTH_STATE_ACTIVATION_TIMEOUT_MS \+ ([0-9_]+)/);
  assert.ok(Number(readyTimeout.replaceAll('_', '')) > 0);
  assert.ok(EARTH_STATE_ACTIVATION_TIMEOUT_MS >= 300_000);
  // Defining the budget is not spending it. Both readiness waits observe the same
  // activation, so each must draw on one shared deadline built from READY_TIMEOUT_MS.
  // A literal timeout on either -- an overlay wait capped below the app's deadline
  // was reporting healthy production as a stale client -- is the regression here.
  assert.match(source, /const readyBy = Date\.now\(\) \+ READY_TIMEOUT_MS/);
  assert.match(source, /waitForSelector\('#loading\[aria-hidden="true"\]', \{ timeout: remaining\(\) \}\)/);
  assert.match(source, /\}, undefined, \{ timeout: remaining\(\) \}\)/);
  assert.doesNotMatch(source, /timeout: [0-9_]+ \}\);\s*await page\.waitForFunction/);
});

test('scheduled production health retains diagnostics and the cross-run soak history even on failure', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/earth-production-health.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.concurrency, { group: 'earth-production-health', 'cancel-in-progress': false });
  assert.ok(workflow.on.schedule.some(item => typeof item.cron === 'string'));
  const steps = workflow.jobs.monitor.steps;
  const named = Object.fromEntries(steps.filter(step => step.name).map(step => [step.name, step]));
  const restore = steps.find(step => step.uses === 'actions/cache/restore@v4');
  const persist = named['Persist provider soak history'];
  const retain = named['Retain diagnostics and visual evidence'];
  const enforce = named['Enforce production health'];
  assert.equal(restore.with.path, 'artifacts/production-health/soak.ndjson');
  assert.match(restore.with.key, /github\.run_attempt/);
  assert.equal(persist.uses, 'actions/cache/save@v4');
  assert.equal(persist.if, 'always()');
  assert.equal(persist.with.path, restore.with.path);
  assert.equal(retain.if, 'always()');
  assert.equal(retain.with['retention-days'], 90);
  assert.equal(enforce.if, 'always()');
  assert.ok(steps.indexOf(named['Evaluate production health and provider soak']) < steps.indexOf(persist));
  assert.ok(steps.indexOf(persist) < steps.indexOf(retain));
  assert.ok(steps.indexOf(retain) < steps.indexOf(enforce));
  assert.match(named['Capture fixed production views'].run, /smoke:production/);
  assert.match(named['Evaluate production health and provider soak'].run, /monitor:production/);
});

test('production package commands and explicit health policy are versioned with the app', async () => {
  const packageDocument = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const policy = JSON.parse(await readFile(new URL('../config/earth-production-policy.json', import.meta.url), 'utf8'));
  assert.equal(packageDocument.scripts['smoke:production'], 'node scripts/smoke-earth-production.mjs');
  assert.equal(packageDocument.scripts['monitor:production'], 'node scripts/monitor-earth-production.mjs');
  assert.ok(packageDocument.devDependencies.playwright);
  assert.ok(packageDocument.devDependencies.yaml);
  assert.equal(policy.soak.minimumDurationDays, 21);
  assert.equal(policy.health.maximumLatestManifestAgeMinutes, 180);
});
