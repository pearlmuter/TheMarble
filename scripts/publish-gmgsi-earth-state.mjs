import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectGmgsiCloudSequence } from '../src/gmgsi-discovery.js';
import { earthStateMediaTypeForPath } from '../src/earth-state-media-types.js';
import { createFilePublicationStore } from '../src/earth-state-publication-file-store.js';
import { createEarthStatePublisher } from '../src/earth-state-publication.js';

const DEFAULT_BUCKET = 'https://noaa-gmgsi-pds.s3.amazonaws.com';

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

function xmlText(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function keysFromListing(xml) {
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(match => xmlText(match[1]));
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`GMGSI source unavailable (${response.status}): ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function utcDay(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '/');
}

async function discoverKeys(bucket, now) {
  const days = [utcDay(now), utcDay(new Date(now.valueOf() - 24 * 60 * 60 * 1000))];
  const listings = await Promise.all(days.flatMap(day => ['VIS', 'LW'].map(async band => {
    const prefix = `GMGSI_${band}/${day}/`;
    const url = `${bucket}/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
    return keysFromListing(new TextDecoder().decode(await fetchBytes(url)));
  })));
  return listings.flat();
}

async function existingValidAt(outputDirectory) {
  try {
    const latest = JSON.parse(await readFile(join(outputDirectory, 'latest.json'), 'utf8'));
    const manifestPath = resolve(outputDirectory, latest.manifest.href.replace(/^\.\//, ''));
    const outputPrefix = `${resolve(outputDirectory)}${sep}`;
    if (!manifestPath.startsWith(outputPrefix)) throw new Error('Published manifest escapes output directory');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    return manifest.cloudSequence?.frames?.at(-1)?.validAt;
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

function assetReference(path, mediaType = 'image/png') {
  return readFile(path).then(bytes => ({
    href: `./${path.split(sep).at(-1)}`,
    mediaType,
    byteLength: bytes.byteLength,
    immutable: true,
    checksum: { algorithm: 'sha256', value: createHash('sha256').update(bytes).digest('hex') },
  }));
}

function cloudDescriptors(metadata, opacityAsset, densityAsset, datasetId) {
  return {
    cloudOpacity: {
      datasetId,
      units: 'observation-derived normalized cloud radiance and opacity',
      dimensions: metadata.dimensions,
      colorSpace: 'srgb',
      channels: { l: 'neutral cloud radiance', a: 'derived cloud opacity' },
      textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
      asset: opacityAsset,
    },
    cloudDensity: {
      datasetId,
      units: 'normalized opacity, observation confidence, and visible-band contribution',
      dimensions: metadata.dimensions,
      colorSpace: 'linear',
      channels: { r: 'derived opacity', g: 'observation confidence', b: 'visible-band contribution' },
      textureSemantics: { mapping: 'equirectangular', sampling: 'linear' },
      asset: densityAsset,
    },
  };
}

function frameContract(discovered, metadata, layers, datasetId) {
  for (const field of ['observedFrom', 'observedTo', 'producedAt']) {
    if (metadata[field] !== discovered[field]) throw new Error(`GMGSI compositor ${field} disagrees with discovery`);
  }
  return {
    validAt: discovered.validAt,
    observedFrom: metadata.observedFrom,
    observedTo: metadata.observedTo,
    producedAt: metadata.producedAt,
    retrievedAt: discovered.retrievedAt,
    coverage: metadata.coverage,
    layers: {
      cloudOpacity: { datasetId, asset: layers.cloudOpacity.asset },
      cloudDensity: { datasetId, asset: layers.cloudDensity.asset },
    },
  };
}

async function composeFrame({ bucket, frame, index, python, stage, width, height }) {
  const visiblePath = join(stage, `visible-${index}.nc`);
  const longwavePath = join(stage, `longwave-${index}.nc`);
  const opacityPath = join(stage, `cloud-opacity-${frame.validAt.replaceAll(':', '-')}.png`);
  const densityPath = join(stage, `cloud-density-${frame.validAt.replaceAll(':', '-')}.png`);
  const metadataPath = join(stage, `cloud-metadata-${index}.json`);
  const [visibleBytes, longwaveBytes] = await Promise.all([
    fetchBytes(`${bucket}/${frame.visibleKey}`),
    fetchBytes(`${bucket}/${frame.longwaveKey}`),
  ]);
  await Promise.all([writeFile(visiblePath, visibleBytes), writeFile(longwavePath, longwaveBytes)]);
  await run(python, [
    resolve('scripts/gmgsi_compositor.py'),
    '--visible', visiblePath,
    '--longwave', longwavePath,
    '--cloud', opacityPath,
    '--density', densityPath,
    '--metadata', metadataPath,
    '--width', String(width),
    '--height', String(height),
  ]);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const [opacityAsset, densityAsset] = await Promise.all([
    assetReference(opacityPath),
    assetReference(densityPath),
  ]);
  return { metadata, opacityAsset, densityAsset };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const now = new Date(options.now ?? Date.now());
  if (Number.isNaN(now.valueOf())) throw new Error('Invalid --now value');
  const outputDirectory = resolve(options.output ?? 'public/earth-state');
  const baseManifestPath = resolve(options['base-manifest'] ?? 'public/earth-state/bundled-v1.json');
  const publicRoot = resolve(options['public-root'] ?? 'public');
  const bucket = (options.bucket ?? DEFAULT_BUCKET).replace(/\/$/, '');
  const python = options.python ?? 'python3';
  const width = Number(options.width ?? 4096);
  const height = Number(options.height ?? 2048);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('GMGSI output dimensions must be positive integers');
  }
  await access(baseManifestPath);

  const retrievedAt = now.toISOString().replace('.000Z', 'Z');
  const selection = selectGmgsiCloudSequence({
    keys: await discoverKeys(bucket, now),
    retrievedAt,
    lastPublishedValidAt: await existingValidAt(outputDirectory),
  });
  if (!selection.publish) {
    process.stdout.write(`${JSON.stringify({ status: 'unchanged', validAt: selection.frames[1].validAt }, null, 2)}\n`);
    return;
  }

  const stage = await mkdtemp(join(tmpdir(), 'themarble-gmgsi-'));
  try {
    const composed = [];
    for (const [index, frame] of selection.frames.entries()) {
      composed.push(await composeFrame({ bucket, frame, index, python, stage, width, height }));
    }
    const baseManifest = JSON.parse(await readFile(baseManifestPath, 'utf8'));
    const datasetId = `noaa-gmgsi-${composed[1].metadata.version}`;
    const frames = composed.map((result, index) => {
      const descriptors = cloudDescriptors(result.metadata, result.opacityAsset, result.densityAsset, datasetId);
      return frameContract(selection.frames[index], result.metadata, descriptors, datasetId);
    });
    const currentDescriptors = cloudDescriptors(
      composed[1].metadata,
      structuredClone(composed[1].opacityAsset),
      structuredClone(composed[1].densityAsset),
      datasetId,
    );
    const manifest = structuredClone(baseManifest);
    const replacedDatasetIds = new Set([
      manifest.layers.cloudOpacity.datasetId,
      manifest.layers.cloudDensity.datasetId,
    ]);
    manifest.bundleId = `source-gmgsi-${frames[1].validAt}`;
    manifest.classification = 'observed';
    manifest.datasets = manifest.datasets.filter(dataset => !replacedDatasetIds.has(dataset.id));
    manifest.datasets.push({
      id: datasetId,
      version: composed[1].metadata.version,
      attribution: 'NOAA/NESDIS Global Mosaic of Geostationary Satellite Imagery (GMGSI), modified by TheMarble',
      observedFrom: frames[0].observedFrom,
      observedTo: frames[1].observedTo,
    });
    manifest.layers.cloudOpacity = currentDescriptors.cloudOpacity;
    manifest.layers.cloudDensity = currentDescriptors.cloudDensity;
    manifest.cloudSequence = { interpolation: 'crossfade', transitionSeconds: 300, frames };
    manifest.times = {
      observedFrom: frames[0].observedFrom,
      observedTo: frames[1].observedTo,
      validAt: frames[1].validAt,
      producedAt: frames[1].producedAt,
      retrievedAt: frames[1].retrievedAt,
    };
    const sourceManifestPath = join(stage, 'manifest.json');
    await writeFile(sourceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const sourceManifestUrl = pathToFileURL(sourceManifestPath).href;
    const stagePrefix = `${stage}${sep}`;
    const publicPrefix = `${publicRoot}${sep}`;
    const publisher = createEarthStatePublisher({
      async loadSource(url) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'file:') throw new Error(`Unexpected publication source protocol: ${parsed.protocol}`);
        let path = fileURLToPath(parsed);
        if (path !== sourceManifestPath && !path.startsWith(stagePrefix)) {
          path = resolve(publicRoot, parsed.pathname.replace(/^\/+/, ''));
        }
        if (path !== sourceManifestPath && !path.startsWith(stagePrefix) && path !== publicRoot && !path.startsWith(publicPrefix)) {
          throw new Error(`Publication source escapes allowed roots: ${path}`);
        }
        const bytes = await readFile(path);
        const mediaType = earthStateMediaTypeForPath(path);
        if (!mediaType) throw new Error(`Unsupported publication source type: ${path}`);
        return { bytes, mediaType };
      },
      store: createFilePublicationStore(outputDirectory),
      assetLayout: 'content-addressed',
    });
    const publication = await publisher.publish({ targetTime: retrievedAt, sourceManifestUrl });
    process.stdout.write(`${JSON.stringify({
      status: 'published',
      bundleId: publication.manifest.bundleId,
      validAt: frames[1].validAt,
      observedThrough: frames[1].observedTo,
      coverage: frames[1].coverage,
      latest: join(outputDirectory, 'latest.json'),
    }, null, 2)}\n`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

await main();
