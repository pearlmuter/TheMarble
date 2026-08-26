import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publisherSource = await readFile(new URL('../scripts/publish-gmgsi-earth-state.mjs', import.meta.url), 'utf8');

test('the GMGSI compositor path is resolved beside the publisher instead of from the scheduler working directory', () => {
  assert.match(publisherSource, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(publisherSource, /join\(scriptDirectory, 'gmgsi_compositor\.py'\)/);
  assert.doesNotMatch(publisherSource, /resolve\('scripts\/gmgsi_compositor\.py'\)/);
});
