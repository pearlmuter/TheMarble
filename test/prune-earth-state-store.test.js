import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/prune-earth-state-store.mjs', import.meta.url));

test('pruning accepts whole-second publication directories and retains shared site/data assets', async () => {
  const store = await mkdtemp(join(tmpdir(), 'marble-retention-'));
  try {
    const names = [
      '2026-09-01T12-00-00.125Z-aaaaaaaaaaaaaaaa',
      '2026-09-10T12-51-12Z-ef89aca2a76c4d07',
      '2026-09-10T12-51-12.500Z-bbbbbbbbbbbbbbbb',
    ];
    const dataAsset = `assets/${'ab'.repeat(32)}.png`;
    await mkdir(join(store, 'assets'));
    await writeFile(join(store, dataAsset), 'live data');
    await writeFile(join(store, 'assets/index-example.js'), 'site code');
    for (const name of names) {
      await mkdir(join(store, 'bundles', name), { recursive: true });
      await writeFile(join(store, 'bundles', name, 'manifest.json'), JSON.stringify({
        bundleId: `themarble-${name}`,
        layers: { cloud: { asset: { href: `../../${dataAsset}` } } },
      }));
    }
    // Current pointer is deliberately old; it must be retained separately
    // from the minimum newest bundle, even when both exceed the age window.
    await writeFile(join(store, 'latest.json'), JSON.stringify({
      manifest: { href: `./bundles/${names[0]}/manifest.json` },
    }));
    const { stdout } = await execute(process.execPath, [script,
      '--store', store, '--now', '2026-09-20T00:00:00Z',
      '--keep-days', '1', '--minimum-bundles', '1', '--apply', 'true',
    ]);
    const report = JSON.parse(stdout);
    assert.deepEqual(report.removedBundles, [`bundles/${names[1]}`]);
    assert.equal(report.removedAssets, 0);
    assert.equal(await readFile(join(store, dataAsset), 'utf8'), 'live data');
    assert.equal(await readFile(join(store, 'assets/index-example.js'), 'utf8'), 'site code');
    assert.ok(await readFile(join(store, 'bundles', names[0], 'manifest.json')));
    assert.ok(await readFile(join(store, 'bundles', names[2], 'manifest.json')));
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test('pruning refuses an unreadable directory time before deleting anything', async () => {
  const store = await mkdtemp(join(tmpdir(), 'marble-retention-'));
  try {
    const manifestPath = 'bundles/unreadable-time/manifest.json';
    const orphan = `assets/${'cd'.repeat(32)}.png`;
    await mkdir(join(store, 'bundles/unreadable-time'), { recursive: true });
    await mkdir(join(store, 'assets'));
    await writeFile(join(store, manifestPath), JSON.stringify({ bundleId: 'bad-time', layers: {} }));
    await writeFile(join(store, orphan), 'orphan');
    await writeFile(join(store, 'latest.json'), JSON.stringify({ manifest: { href: `./${manifestPath}` } }));
    await assert.rejects(execute(process.execPath, [script, '--store', store, '--apply', 'true']),
      /unreadable publication time; refusing to prune/);
    assert.equal(await readFile(join(store, orphan), 'utf8'), 'orphan');
    assert.ok(await readFile(join(store, manifestPath)));
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});
