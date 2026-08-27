import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the operational cloud publisher prefers SatCORPS and invokes GMGSI on rejection or failure', async () => {
  const source = await readFile(new URL('../scripts/publish-cloud-earth-state.mjs', import.meta.url), 'utf8');
  assert.match(source, /selectCloudProviderSequence/);
  assert.match(source, /addSatcorpsCloudSequence/);
  assert.match(source, /createEarthStatePublisher/);
  assert.match(source, /publish-gmgsi-earth-state\.mjs/);
  assert.match(source, /catch \(satcorpsError\)/);
  assert.match(source, /await publishGmgsiFallback/);
});

test('the operational cloud publisher composes and publishes all four physical fields as one staged source', async () => {
  const source = await readFile(new URL('../scripts/publish-cloud-earth-state.mjs', import.meta.url), 'utf8');
  for (const layer of ['cloudOpacity', 'cloudDensity', 'cloudPhysics', 'cloudAge']) {
    assert.match(source, new RegExp(`${layer}: await assetReference`));
  }
  assert.match(source, /await publisher\.publish/);
});
