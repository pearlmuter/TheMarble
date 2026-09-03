import assert from 'node:assert/strict';
import test from 'node:test';
import { describeDispatchOutcome, workflowDispatchRequest, workflowForCron } from '../src/publisher-dispatch.js';

const valid = { repository: 'pearlmuter/TheMarble', workflow: 'earth-state-clouds.yml', token: 'secret' };

test('a dispatch targets the workflow GitHub actually runs', () => {
  const { url, init } = workflowDispatchRequest(valid);
  assert.equal(url, 'https://api.github.com/repos/pearlmuter/TheMarble/actions/workflows/earth-state-clouds.yml/dispatches');
  assert.equal(init.method, 'POST');
  assert.equal(JSON.parse(init.body).ref, 'main');
  assert.equal(init.headers['x-github-api-version'], '2022-11-28');
});

test('the token travels in the header and never in the URL', () => {
  const { url, init } = workflowDispatchRequest(valid);
  assert.doesNotMatch(url, /secret/);
  assert.equal(init.headers.authorization, 'Bearer secret');
});

test('a malformed target is refused rather than sent', () => {
  assert.throws(() => workflowDispatchRequest({ ...valid, repository: 'not-a-repo' }), /Invalid repository/);
  assert.throws(() => workflowDispatchRequest({ ...valid, workflow: '../../etc/passwd' }), /Invalid workflow file/);
  assert.throws(() => workflowDispatchRequest({ ...valid, token: undefined }), /requires a GitHub token/);
});

test('a successful dispatch is the empty 204 GitHub returns', () => {
  assert.deepEqual(describeDispatchOutcome(204, ''), { ok: true, status: 204, detail: 'workflow dispatched' });
});

test('a failure keeps the reason instead of discarding it', () => {
  assert.match(describeDispatchOutcome(401, 'Bad credentials').detail, /token rejected: Bad credentials/);
  assert.match(describeDispatchOutcome(404, '').detail, /not found/);
  assert.match(describeDispatchOutcome(500, 'upstream boom').detail, /upstream boom/);
  for (const status of [401, 403, 404, 500]) assert.equal(describeDispatchOutcome(status, '').ok, false);
});

test('the cron that fired picks the workflow, so one Worker can drive both schedules', () => {
  const schedules = {
    publisherCron: '*/10 * * * *', publisherWorkflow: 'earth-state-clouds.yml',
    healthCron: '7,37 * * * *', healthWorkflow: 'earth-production-health.yml',
  };
  assert.equal(workflowForCron('*/10 * * * *', schedules), 'earth-state-clouds.yml');
  assert.equal(workflowForCron('7,37 * * * *', schedules), 'earth-production-health.yml');
});

test('an unrecognised or absent cron pokes the publisher rather than nothing', () => {
  const schedules = {
    publisherCron: '*/10 * * * *', publisherWorkflow: 'earth-state-clouds.yml',
    healthCron: '7,37 * * * *', healthWorkflow: 'earth-production-health.yml',
  };
  // A duplicate publish poke returns `unchanged`; a missed publish goes stale.
  assert.equal(workflowForCron('0 3 * * *', schedules), 'earth-state-clouds.yml');
  assert.equal(workflowForCron(undefined, schedules), 'earth-state-clouds.yml');
});

test('a Worker configured without the health schedule still drives the publisher', () => {
  const schedules = { publisherCron: '*/10 * * * *', publisherWorkflow: 'earth-state-clouds.yml' };
  assert.equal(workflowForCron('*/10 * * * *', schedules), 'earth-state-clouds.yml');
  assert.equal(workflowForCron('7,37 * * * *', schedules), 'earth-state-clouds.yml');
});
