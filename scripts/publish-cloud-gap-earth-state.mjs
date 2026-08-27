import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addCloudGapCompletion } from '../src/cloud-gap-manifest.js';
import { selectCloudGapSources } from '../src/cloud-gap-selection.js';
import { earthStateMediaTypeForPath } from '../src/earth-state-media-types.js';
import { resolveEarthStateBaseManifest } from '../src/earth-state-publication-base.js';
import { createFilePublicationStore } from '../src/earth-state-publication-file-store.js';
import { createEarthStatePublisher } from '../src/earth-state-publication.js';
import { rebaseEarthStateSourceAssets } from '../src/earth-state-source-assets.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const DEFAULT_THRESHOLDS = Object.freeze({
  maxObservationAgeSeconds: 10_800,
  minObservationQuality: .72,
  seamBlendPixels: 3,
});

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

function inputUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return pathToFileURL(resolve(value)).href;
  }
}

async function readUrlBytes(url) {
  const parsed = new URL(url);
  if (parsed.protocol === 'file:') return new Uint8Array(await readFile(fileURLToPath(parsed)));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Unsupported cloud-gap source protocol: ${parsed.protocol}`);
  const response = await fetch(parsed, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Cloud-gap source unavailable (${response.status}): ${parsed.href}`);
  return new Uint8Array(await response.arrayBuffer());
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function verifyDeclaredBytes(bytes, descriptor, label) {
  if (descriptor.byteLength !== undefined && bytes.byteLength !== descriptor.byteLength) {
    throw new Error(`Cloud-gap ${label} byteLength mismatch`);
  }
  if (descriptor.checksum && (descriptor.checksum.algorithm !== 'sha256'
    || !/^[a-f0-9]{64}$/i.test(descriptor.checksum.value))) {
    throw new Error(`Cloud-gap ${label} checksum declaration is invalid`);
  }
  const expected = descriptor.checksum?.value?.toLowerCase();
  if (expected && sha256(bytes) !== expected) throw new Error(`Cloud-gap ${label} checksum mismatch`);
}

async function materializeUrl(url, path, descriptor, label) {
  const bytes = await readUrlBytes(url);
  verifyDeclaredBytes(bytes, descriptor, label);
  await writeFile(path, bytes);
  return path;
}

async function materializeAsset(descriptor, path, label) {
  return materializeUrl(descriptor.asset.href, path, descriptor.asset, label);
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

async function assetReference(path) {
  const bytes = await readFile(path);
  return {
    href: `./${path.split(sep).at(-1)}`,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    immutable: true,
    checksum: { algorithm: 'sha256', value: sha256(bytes) },
  };
}

function thresholdsFromOptions(options) {
  return {
    maxObservationAgeSeconds: Number(options['max-observation-age-seconds'] ?? DEFAULT_THRESHOLDS.maxObservationAgeSeconds),
    minObservationQuality: Number(options['min-observation-quality'] ?? DEFAULT_THRESHOLDS.minObservationQuality),
    seamBlendPixels: Number(options['seam-blend-pixels'] ?? DEFAULT_THRESHOLDS.seamBlendPixels),
  };
}

function candidatePath(stage, candidate, index) {
  const extension = extname(new URL(candidate.href).pathname) || (candidate.product === 'gfs-total-cloud' ? '.npy' : '.npz');
  return join(stage, `${candidate.product}-${index}${extension}`);
}

async function composeFrame({ frame, index, candidates, retrievedAt, thresholds, python, stage, staticCloud, staticDensity }) {
  const selection = selectCloudGapSources({ candidates, targetValidAt: frame.validAt, retrievedAt, thresholds });
  const suffix = frame.validAt.replaceAll(':', '-');
  const primaryCloud = await materializeAsset(frame.layers.cloudOpacity, join(stage, `primary-cloud-${index}.png`), `primary cloud frame ${index}`);
  const primaryDensity = await materializeAsset(frame.layers.cloudDensity, join(stage, `primary-density-${index}.png`), `primary density frame ${index}`);
  const primaryAge = frame.layers.cloudAge
    ? await materializeAsset(frame.layers.cloudAge, join(stage, `primary-age-${index}.png`), `primary age frame ${index}`)
    : undefined;
  const polar = selection.polarObservation
    ? await materializeUrl(
      selection.polarObservation.href,
      candidatePath(stage, selection.polarObservation, index),
      selection.polarObservation,
      `${selection.polarObservation.product} frame ${index}`,
    )
    : undefined;
  const model = selection.model
    ? await materializeUrl(
      selection.model.href,
      candidatePath(stage, selection.model, index),
      selection.model,
      `GFS frame ${index}`,
    )
    : undefined;
  const cloudPath = join(stage, `cloud-gap-opacity-${suffix}.png`);
  const densityPath = join(stage, `cloud-gap-density-${suffix}.png`);
  const provenancePath = join(stage, `cloud-gap-provenance-${suffix}.png`);
  const metadataPath = join(stage, `cloud-gap-metadata-${index}.json`);
  const primaryAgeSeconds = Math.max(0, (Date.parse(frame.validAt) - Date.parse(frame.observedTo)) / 1000);
  const args = [
    join(scriptDirectory, 'cloud_gap_compositor.py'),
    '--primary-cloud', primaryCloud,
    '--primary-density', primaryDensity,
    '--primary-age-seconds', String(primaryAgeSeconds),
    ...(primaryAge ? ['--primary-age', primaryAge] : []),
    ...(polar ? [
      '--polar', polar,
      '--polar-age-offset-seconds', String(Math.max(0, (Date.parse(frame.validAt) - Date.parse(selection.polarObservation.validAt)) / 1000)),
    ] : []),
    ...(model ? [
      '--model', model,
      '--model-run-at', selection.model.runAt,
      '--model-forecast-hour', String(selection.model.forecastHour),
    ] : []),
    '--static-cloud', staticCloud,
    '--static-density', staticDensity,
    '--cloud', cloudPath,
    '--density', densityPath,
    '--provenance', provenancePath,
    '--metadata', metadataPath,
    '--max-observation-age-seconds', String(thresholds.maxObservationAgeSeconds),
    '--min-observation-quality', String(thresholds.minObservationQuality),
    '--seam-blend-pixels', String(thresholds.seamBlendPixels),
  ];
  await run(python, args);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.staticFallback = 'Bundled static fair-weather cloud texture, used only where no accepted observation or GFS value exists';
  const assets = {
    cloudOpacity: await assetReference(cloudPath),
    cloudDensity: await assetReference(densityPath),
    cloudProvenance: await assetReference(provenancePath),
  };
  return { validAt: frame.validAt, selection, metadata, assets };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.catalog) throw new Error('--catalog is required');
  const outputDirectory = resolve(options.output ?? 'public/earth-state');
  const publicRoot = resolve(options['public-root'] ?? 'public');
  const baseManifestPath = await resolveEarthStateBaseManifest({
    explicitPath: options['base-manifest'],
    outputDirectory,
    fallbackPath: 'public/earth-state/bundled-v1.json',
  });
  const catalogUrl = inputUrl(options.catalog);
  const catalog = JSON.parse(new TextDecoder().decode(await readUrlBytes(catalogUrl)));
  if (!Array.isArray(catalog.candidates)) throw new Error('Cloud-gap catalog must contain candidates');
  const retrievedAt = new Date(options.now ?? catalog.retrievedAt ?? Date.now()).toISOString().replace('.000Z', 'Z');
  const candidates = catalog.candidates.map(candidate => ({
    ...candidate,
    href: new URL(candidate.href, catalogUrl).href,
  }));
  const thresholds = thresholdsFromOptions(options);
  const python = options.python ?? 'python3';
  const staticCloud = resolve(options['static-cloud'] ?? 'public/fair-clouds-4k.png');
  const staticDensity = resolve(options['static-density'] ?? 'public/earth-state/cloud-density-static-neutral.png');
  const baseManifestDocument = JSON.parse(await readFile(baseManifestPath, 'utf8'));
  const { manifest: baseManifest, sourceUrls: baseSourceUrls } = rebaseEarthStateSourceAssets(baseManifestDocument, {
    sourceManifestUrl: pathToFileURL(baseManifestPath).href,
    publicRootUrl: pathToFileURL(`${publicRoot}${sep}`).href,
  });
  if (!Array.isArray(baseManifest.cloudSequence?.frames) || baseManifest.cloudSequence.frames.length !== 2) {
    throw new Error('Cloud-gap publication requires a current two-frame cloud observation bundle');
  }
  if (baseManifest.cloudSequence.frames.some(frame => Date.parse(frame.observedTo) > Date.parse(retrievedAt)
    || Date.parse(frame.producedAt) > Date.parse(retrievedAt))) {
    throw new Error('Cloud-gap retrieval time precedes the current observation bundle');
  }

  const stage = await mkdtemp(join(tmpdir(), 'themarble-cloud-gap-'));
  try {
    const completedFrames = [];
    for (const [index, frame] of baseManifest.cloudSequence.frames.entries()) {
      completedFrames.push(await composeFrame({
        frame, index, candidates, retrievedAt, thresholds, python, stage, staticCloud, staticDensity,
      }));
    }
    const manifest = addCloudGapCompletion(baseManifest, { thresholds, completedFrames });
    const sourceManifestPath = join(stage, 'manifest.json');
    await writeFile(sourceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const sourceManifestUrl = pathToFileURL(sourceManifestPath).href;
    const stagePrefix = `${stage}${sep}`;
    const publisher = createEarthStatePublisher({
      async loadSource(url) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'file:') throw new Error(`Unexpected publication source protocol: ${parsed.protocol}`);
        const path = fileURLToPath(parsed);
        const isStaged = path === sourceManifestPath || path.startsWith(stagePrefix);
        if (!isStaged && !baseSourceUrls.has(parsed.href)) {
          throw new Error(`Publication source was not declared by the base manifest: ${path}`);
        }
        const bytes = new Uint8Array(await readFile(path));
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
      validAt: publication.manifest.times.validAt,
      coverage: completedFrames[1].metadata.coverage,
      thresholds,
      latest: join(outputDirectory, 'latest.json'),
    }, null, 2)}\n`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

await main();
