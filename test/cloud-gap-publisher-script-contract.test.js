import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../scripts/publish-cloud-gap-earth-state.mjs', import.meta.url), 'utf8');

test('cloud-gap publication completes both observation frames and publishes them atomically', () => {
  assert.match(source, /selectCloudGapSources/);
  assert.match(source, /cloud_gap_compositor\.py/);
  assert.match(source, /addCloudGapCompletion/);
  assert.match(source, /for \(const \[index, frame\] of baseManifest\.cloudSequence\.frames\.entries\(\)\)/);
  assert.match(source, /assetLayout: 'content-addressed'/);
});

test('cloud-gap publication supplies physical observation age and disclosed fallback inputs', () => {
  assert.match(source, /frame\.layers\.cloudAge/);
  assert.match(source, /--primary-age/);
  assert.match(source, /--polar-age-offset-seconds/);
  assert.match(source, /--static-cloud/);
  assert.match(source, /--static-density/);
  assert.match(source, /staticFallback/);
});
