import assert from 'node:assert/strict';
import test from 'node:test';
import { createEarthProductionRecoveryController } from '../src/production-recovery.js';

const lastKnownGood = {
  bundleId: 'earth-last-known-good',
  latestDocument: { schemaVersion: 1, bundleId: 'earth-last-known-good', manifest: { href: './bundles/good/manifest.json' } },
};

function harness({ current = lastKnownGood.latestDocument, fail = [] } = {}) {
  const events = [];
  let latest = structuredClone(current);
  const maybeFail = name => {
    events.push(name);
    if (fail.includes(name)) throw new Error(`${name} failed`);
  };
  return {
    events,
    read: () => latest,
    controller: createEarthProductionRecoveryController({
      async readLatest() {
        events.push('read-latest');
        return structuredClone(latest);
      },
      async verifyBundle(bundle) {
        events.push(`verify:${bundle.bundleId}`);
        return bundle.bundleId === lastKnownGood.bundleId || bundle.bundleId === 'earth-new-verified';
      },
      async restartCompositor() { maybeFail('restart-compositor'); },
      async retryPublication() { maybeFail('retry-publication'); },
      async quarantineCandidate(bundleId) { maybeFail(`quarantine:${bundleId}`); },
      async restoreDelivery(bundleId) { maybeFail(`restore-delivery:${bundleId}`); },
      async replaceLatest(document) {
        events.push(`replace-latest:${document.bundleId}`);
        latest = structuredClone(document);
      },
    }),
  };
}

test('provider outage retains the verified last-known-good Earth without touching the latest pointer', async () => {
  const testHarness = harness();
  const result = await testHarness.controller.recover({ kind: 'provider-outage' }, lastKnownGood);

  assert.equal(result.activeBundleId, lastKnownGood.bundleId);
  assert.equal(result.outcome, 'retained-last-known-good');
  assert.ok(!testHarness.events.some(event => event.startsWith('replace-latest')));
});

test('stale latest retries publication and rolls back when no verified replacement is produced', async () => {
  const testHarness = harness({ fail: ['retry-publication'] });
  const result = await testHarness.controller.recover({ kind: 'stale-latest' }, lastKnownGood);

  assert.deepEqual(testHarness.read(), lastKnownGood.latestDocument);
  assert.equal(result.activeBundleId, lastKnownGood.bundleId);
  assert.ok(testHarness.events.includes('retry-publication'));
  assert.ok(testHarness.events.includes(`replace-latest:${lastKnownGood.bundleId}`));
});

test('a compositor crash restarts the compositor before retry and preserves last-known-good on retry failure', async () => {
  const testHarness = harness({ fail: ['retry-publication'] });
  await testHarness.controller.recover({ kind: 'compositor-crash' }, lastKnownGood);

  assert.ok(testHarness.events.indexOf('restart-compositor') < testHarness.events.indexOf('retry-publication'));
  assert.deepEqual(testHarness.read(), lastKnownGood.latestDocument);
});

test('corrupt output is quarantined and cannot replace the coherent latest Earth', async () => {
  const testHarness = harness();
  await testHarness.controller.recover({ kind: 'corrupt-output', candidateBundleId: 'earth-corrupt' }, lastKnownGood);

  assert.ok(testHarness.events.includes('quarantine:earth-corrupt'));
  assert.deepEqual(testHarness.read(), lastKnownGood.latestDocument);
});

test('publication interruption resumes from last-known-good and rolls back if the retry cannot finish', async () => {
  const testHarness = harness({ fail: ['retry-publication'] });
  await testHarness.controller.recover({ kind: 'publication-interruption' }, lastKnownGood);

  assert.ok(testHarness.events.includes('retry-publication'));
  assert.deepEqual(testHarness.read(), lastKnownGood.latestDocument);
});

test('CDN failure repairs delivery from the verified bundle while the origin pointer remains coherent', async () => {
  const testHarness = harness();
  const result = await testHarness.controller.recover({ kind: 'cdn-failure' }, lastKnownGood);

  assert.ok(testHarness.events.includes(`restore-delivery:${lastKnownGood.bundleId}`));
  assert.equal(result.activeBundleId, lastKnownGood.bundleId);
  assert.deepEqual(testHarness.read(), lastKnownGood.latestDocument);
});

test('explicit rollback atomically restores the recorded last-known-good latest document', async () => {
  const testHarness = harness({ current: { schemaVersion: 1, bundleId: 'earth-bad-current' } });
  const result = await testHarness.controller.recover({ kind: 'rollback' }, lastKnownGood);

  assert.equal(result.outcome, 'rolled-back');
  assert.deepEqual(testHarness.read(), lastKnownGood.latestDocument);
  assert.ok(testHarness.events.includes(`replace-latest:${lastKnownGood.bundleId}`));
});
