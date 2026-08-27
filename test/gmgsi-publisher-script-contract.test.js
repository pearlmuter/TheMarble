import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publisherSource = await readFile(new URL('../scripts/publish-gmgsi-earth-state.mjs', import.meta.url), 'utf8');

test('the GMGSI compositor path is resolved beside the publisher instead of from the scheduler working directory', () => {
  assert.match(publisherSource, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(publisherSource, /join\(scriptDirectory, 'gmgsi_compositor\.py'\)/);
  assert.doesNotMatch(publisherSource, /resolve\('scripts\/gmgsi_compositor\.py'\)/);
});

test('GMGSI fallback removes SatCORPS-only layers and their dataset before validation', () => {
  assert.match(publisherSource, /delete manifest\.layers\.cloudPhysics/);
  assert.match(publisherSource, /delete manifest\.layers\.cloudAge/);
  assert.match(publisherSource, /delete manifest\.layers\.cloudProvenance/);
  assert.match(publisherSource, /provider: 'gmgsi'/);
});
