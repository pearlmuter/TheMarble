import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../scripts/publish-cryosphere-earth-state.mjs', import.meta.url), 'utf8');
const cloudSource = await readFile(new URL('../scripts/publish-gmgsi-earth-state.mjs', import.meta.url), 'utf8');

test('the daily publisher selects one coherent source day and resolves its compositor beside the script', () => {
  assert.match(source, /selectDailyCryosphere/);
  assert.match(source, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(source, /join\(scriptDirectory, 'cryosphere_compositor\.py'\)/);
  assert.match(source, /addCryosphereAnalysis/);
  assert.match(source, /assetLayout: 'content-addressed'/);
});

test('hourly and daily publishers inherit the current atomic bundle before replacing their own layers', () => {
  for (const publisher of [source, cloudSource]) {
    assert.match(publisher, /resolveEarthStateBaseManifest/);
    assert.match(publisher, /rebaseEarthStateSourceAssets/);
  }
});
