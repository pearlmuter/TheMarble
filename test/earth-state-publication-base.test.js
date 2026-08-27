import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { resolveEarthStateBaseManifest } from '../src/earth-state-publication-base.js';

test('a producer derives from the current atomic bundle unless an explicit base is supplied', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'themarble-base-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'latest.json'), JSON.stringify({
    manifest: { href: './bundles/current/manifest.json' },
  }));

  assert.equal(await resolveEarthStateBaseManifest({
    outputDirectory: directory,
    fallbackPath: '/repo/public/earth-state/bundled-v1.json',
  }), join(directory, 'bundles/current/manifest.json'));
  assert.equal(await resolveEarthStateBaseManifest({
    explicitPath: './chosen.json',
    outputDirectory: directory,
    fallbackPath: '/repo/public/earth-state/bundled-v1.json',
  }), resolve('./chosen.json'));
});

test('a producer rejects a latest pointer that escapes its output directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'themarble-base-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'latest.json'), JSON.stringify({
    manifest: { href: '../outside.json' },
  }));

  await assert.rejects(resolveEarthStateBaseManifest({
    outputDirectory: directory,
    fallbackPath: '/repo/public/earth-state/bundled-v1.json',
  }), /escapes output directory/);
});
