import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';

const wrangler = await readFile(new URL('../infrastructure/publisher-scheduler/wrangler.toml', import.meta.url), 'utf8');
const worker = await readFile(new URL('../infrastructure/publisher-scheduler/worker.js', import.meta.url), 'utf8');

function tomlValue(name) {
  return wrangler.match(new RegExp(`^${name} = "([^"]+)"`, 'm'))?.[1];
}

test('the scheduler dispatches workflows that exist and accept being dispatched', async () => {
  for (const name of ['WORKFLOW', 'HEALTH_WORKFLOW']) {
    const file = tomlValue(name);
    assert.ok(file, `${name} is not configured`);
    // A typo here is a silent 404 from GitHub every time the cron fires.
    const workflow = parse(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));
    assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'), `${file} cannot be dispatched`);
  }
});

test('every cron the Worker is triggered on routes to a workflow', () => {
  const crons = [...wrangler.matchAll(/"([^"]*\*[^"]*)"/g)].map(match => match[1]);
  assert.ok(crons.length >= 2, 'expected a publisher cron and a health cron');
  assert.ok(crons.includes(tomlValue('HEALTH_CRON')), 'HEALTH_CRON is not among the configured triggers');
  // The cron that fired must reach the routing function, or both triggers
  // would poke the same workflow.
  assert.match(worker, /dispatch\(env, event\.cron\)/);
  assert.match(worker, /workflowForCron\(cron, \{/);
});

test('the health monitor keeps a GitHub cron as a backstop if the Worker goes away', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/earth-production-health.yml', import.meta.url), 'utf8'));
  assert.ok(workflow.on.schedule.some(item => typeof item.cron === 'string'));
});
