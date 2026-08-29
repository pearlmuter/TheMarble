import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the app exposes its current verified bundle to a non-visual production smoke client', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(source, /earthStateSummary\.dataset\.bundleId/);
  assert.match(source, /earthStateSummary\.dataset\.runtimeSource/);
  assert.match(source, /earthStateSummary\.dataset\.refresh/);
});

test('the production smoke adapter uses a real browser and retains its report', async () => {
  const source = await readFile(new URL('../scripts/smoke-earth-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /from 'playwright'/);
  assert.match(source, /runEarthProductionVisualSmoke/);
  assert.match(source, /page\.screenshot/);
  assert.match(source, /smoke-report\.json/);
});

test('scheduled production health retains diagnostics and the cross-run soak history even on failure', async () => {
  const workflow = await readFile(new URL('../.github/workflows/earth-production-health.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron:/);
  assert.match(workflow, /smoke:production/);
  assert.match(workflow, /monitor:production/);
  assert.match(workflow, /actions\/cache\/restore/);
  assert.match(workflow, /actions\/cache\/save/);
  assert.match(workflow, /soak\.ndjson/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /retention-days: 90/);
});

test('production package commands and explicit health policy are versioned with the app', async () => {
  const packageDocument = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const policy = JSON.parse(await readFile(new URL('../config/earth-production-policy.json', import.meta.url), 'utf8'));
  assert.equal(packageDocument.scripts['smoke:production'], 'node scripts/smoke-earth-production.mjs');
  assert.equal(packageDocument.scripts['monitor:production'], 'node scripts/monitor-earth-production.mjs');
  assert.ok(packageDocument.devDependencies.playwright);
  assert.equal(policy.soak.minimumDurationDays, 21);
  assert.equal(policy.health.maximumLatestManifestAgeMinutes, 180);
});
