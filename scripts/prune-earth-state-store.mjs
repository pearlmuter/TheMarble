import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { planEarthStateRetention } from '../src/earth-state-retention.js';
import { resolveEarthStatePublishedManifestPath } from '../src/earth-state-publication-base.js';

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error('Arguments must be --name value pairs');
    options[flag.slice(2)] = value;
  }
  return options;
}

function booleanOption(options, name) {
  const value = options[name];
  if (value === undefined) return false;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new Error(`--${name} accepts only true or false`);
}

async function listDirectory(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/** Read every published bundle in the store, with the assets its manifest names. */
async function readStoredBundles(storeDirectory) {
  const bundlesRoot = join(storeDirectory, 'bundles');
  const entries = await listDirectory(bundlesRoot);
  const bundles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(bundlesRoot, entry.name, 'manifest.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      bundles.push({
        bundleId: manifest.bundleId,
        path: `bundles/${entry.name}`,
        // The publisher writes its time key as the ISO instant with ':' replaced by '-'.
        publishedAt: entry.name.slice(0, 24).replace(/T(\d\d)-(\d\d)-/, 'T$1:$2:'),
        assetHrefs: collectAssetHrefs(manifest),
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return bundles;
}

function collectAssetHrefs(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetHrefs(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    if (typeof value.asset?.href === 'string') found.push(value.asset.href);
    for (const item of Object.values(value)) collectAssetHrefs(item, found);
  }
  return found;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const storeDirectory = resolve(options.store ?? 'artifacts/earth-state');
  const apply = booleanOption(options, 'apply');

  const manifestPath = await resolveEarthStatePublishedManifestPath(storeDirectory);
  if (!manifestPath) throw new Error(`${storeDirectory} has no published latest.json to prune against`);
  const currentBundleId = JSON.parse(await readFile(manifestPath, 'utf8')).bundleId;

  const bundles = await readStoredBundles(storeDirectory);
  const assetEntries = await listDirectory(join(storeDirectory, 'assets'));
  const assetPaths = assetEntries.filter(entry => entry.isFile()).map(entry => `assets/${entry.name}`);
  const assetSizes = Object.fromEntries(await Promise.all(assetPaths.map(async path => [
    path,
    (await stat(join(storeDirectory, path))).size,
  ])));

  const plan = planEarthStateRetention({
    bundles,
    assetPaths,
    assetSizes,
    currentBundleId,
    now: new Date(options.now ?? Date.now()).toISOString().replace('.000Z', 'Z'),
    keepDays: Number(options['keep-days'] ?? 7),
    minimumBundles: Number(options['minimum-bundles'] ?? 3),
  });

  const removedPaths = [...plan.removeBundles.map(bundle => bundle.path), ...plan.removeAssets];
  if (apply) {
    for (const path of removedPaths) await rm(join(storeDirectory, path), { recursive: true, force: true });
  }
  // The workflow deletes the same keys from the origin, so emit them verbatim.
  if (options['removed-keys']) {
    await writeFile(resolve(options['removed-keys']), `${removedPaths.join('\n')}\n`);
  }

  process.stdout.write(`${JSON.stringify({
    status: apply ? 'pruned' : 'planned',
    currentBundleId,
    retainedBundles: plan.retainBundles.length,
    removedBundles: plan.removeBundles.map(bundle => bundle.path),
    removedAssets: plan.removeAssets.length,
    reclaimedBytes: plan.reclaimedBytes,
  }, null, 2)}\n`);
}

await main();
