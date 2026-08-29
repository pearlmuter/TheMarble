import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { selectCloudProviderSequence } from '../src/cloud-provider-selection.js';
import { cloudProviderPromotionIsCurrent } from '../src/cloud-provider-soak.js';
import { earthStateMediaTypeForPath } from '../src/earth-state-media-types.js';
import { resolveEarthStateBaseManifest } from '../src/earth-state-publication-base.js';
import { createFilePublicationStore } from '../src/earth-state-publication-file-store.js';
import { createEarthStatePublisher } from '../src/earth-state-publication.js';
import { rebaseEarthStateSourceAssets } from '../src/earth-state-source-assets.js';
import { addSatcorpsCloudSequence } from '../src/satcorps-manifest.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

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

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

async function fetchBytes(url) {
  const parsed = new URL(url);
  if (parsed.protocol === 'file:') return new Uint8Array(await readFile(fileURLToPath(parsed)));
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(`Unsupported SatCORPS source protocol: ${parsed.protocol}`);
  const response = await fetch(parsed, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`SatCORPS source unavailable (${response.status}): ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function sourceUrl(value) {
  try {
    return new URL(value).href;
  } catch {
    return pathToFileURL(resolve(value)).href;
  }
}

async function readCatalog(value) {
  const url = sourceUrl(value);
  const catalog = JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  if (!Array.isArray(catalog?.sequences)) throw new Error('SatCORPS catalog must contain a sequences array');
  return {
    sequences: catalog.sequences.map(sequence => ({
      ...sequence,
      frames: sequence.frames?.map(frame => {
        const manifest = typeof frame.assets?.manifest === 'string' && frame.assets.manifest.trim() !== ''
          ? new URL(frame.assets.manifest, url).href
          : frame.assets?.manifest;
        return { ...frame, assets: { ...frame.assets, manifest } };
      }),
    })),
  };
}

async function readSatcorpsPromotion(path, now) {
  if (!path) return false;
  try {
    const report = JSON.parse(await readFile(resolve(path), 'utf8'));
    return cloudProviderPromotionIsCurrent(report, { now, maximumAgeHours: 36 });
  } catch (error) {
    process.stderr.write(`SatCORPS soak report is unavailable or invalid; retaining GMGSI: ${error.message}\n`);
    return false;
  }
}

async function existingValidAt(outputDirectory) {
  try {
    const latest = JSON.parse(await readFile(join(outputDirectory, 'latest.json'), 'utf8'));
    const manifestPath = resolve(outputDirectory, latest.manifest.href.replace(/^\.\//, ''));
    if (!manifestPath.startsWith(`${resolve(outputDirectory)}${sep}`)) throw new Error('Published manifest escapes output directory');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    return manifest.cloudSequence?.frames?.at(-1)?.validAt;
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function assetReference(path) {
  const bytes = await readFile(path);
  return {
    href: `./${path.split(sep).at(-1)}`,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    immutable: true,
    checksum: { algorithm: 'sha256', value: createHash('sha256').update(bytes).digest('hex') },
  };
}

async function composeFrame({ frame, index, python, stage }) {
  const sourcePath = join(stage, `satcorps-${index}.nc`);
  const suffix = frame.validAt.replaceAll(':', '-');
  const paths = {
    cloud: join(stage, `cloud-opacity-${suffix}.png`),
    density: join(stage, `cloud-density-${suffix}.png`),
    physics: join(stage, `cloud-physics-${suffix}.png`),
    age: join(stage, `cloud-age-${suffix}.png`),
    metadata: join(stage, `cloud-metadata-${index}.json`),
  };
  await writeFile(sourcePath, await fetchBytes(frame.assets.manifest));
  await run(python, [
    join(scriptDirectory, 'satcorps_compositor.py'),
    '--source', sourcePath,
    '--cloud', paths.cloud,
    '--density', paths.density,
    '--physics', paths.physics,
    '--age', paths.age,
    '--metadata', paths.metadata,
  ]);
  return {
    metadata: JSON.parse(await readFile(paths.metadata, 'utf8')),
    assets: {
      cloudOpacity: await assetReference(paths.cloud),
      cloudDensity: await assetReference(paths.density),
      cloudPhysics: await assetReference(paths.physics),
      cloudAge: await assetReference(paths.age),
    },
  };
}

async function publishSatcorps({ baseManifestPath, outputDirectory, publicRoot, python, retrievedAt, catalog, satcorpsPromoted }) {
  const selection = selectCloudProviderSequence({
    sequences: catalog.sequences,
    retrievedAt,
    lastPublishedValidAt: await existingValidAt(outputDirectory),
    satcorpsPromoted,
  });
  if (selection.provider !== 'satcorps') throw new Error('No usable SatCORPS sequence was selected');
  if (!selection.publish) return { status: 'unchanged', validAt: selection.frames[1].validAt };

  const stage = await mkdtemp(join(tmpdir(), 'themarble-satcorps-'));
  try {
    const composedFrames = [];
    for (const [index, frame] of selection.frames.entries()) {
      composedFrames.push(await composeFrame({ frame, index, python, stage }));
    }
    const baseDocument = JSON.parse(await readFile(baseManifestPath, 'utf8'));
    const { manifest: baseManifest, sourceUrls: baseSourceUrls } = rebaseEarthStateSourceAssets(baseDocument, {
      sourceManifestUrl: pathToFileURL(baseManifestPath).href,
      publicRootUrl: pathToFileURL(`${publicRoot}${sep}`).href,
    });
    const manifest = addSatcorpsCloudSequence(baseManifest, { selection, composedFrames });
    const sourceManifestPath = join(stage, 'manifest.json');
    await writeFile(sourceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const sourceManifestUrl = pathToFileURL(sourceManifestPath).href;
    const stagePrefix = `${stage}${sep}`;
    const publisher = createEarthStatePublisher({
      async loadSource(url) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'file:') throw new Error(`Unexpected publication source protocol: ${parsed.protocol}`);
        const path = fileURLToPath(parsed);
        if (path !== sourceManifestPath && !path.startsWith(stagePrefix) && !baseSourceUrls.has(parsed.href)) {
          throw new Error(`Publication source was not declared by the base manifest: ${path}`);
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
    return {
      status: 'published',
      provider: 'satcorps',
      bundleId: publication.manifest.bundleId,
      validAt: selection.frames[1].validAt,
      latest: join(outputDirectory, 'latest.json'),
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function publishGmgsiFallback({ options, baseManifestPath, outputDirectory, publicRoot, python, retrievedAt, satcorpsError }) {
  process.stderr.write(`SatCORPS unavailable; publishing GMGSI fallback: ${satcorpsError.message}\n`);
  const args = [
    join(scriptDirectory, 'publish-gmgsi-earth-state.mjs'),
    '--output', outputDirectory,
    '--public-root', publicRoot,
    '--base-manifest', baseManifestPath,
    '--python', python,
    '--now', retrievedAt,
  ];
  for (const name of ['bucket', 'width', 'height']) {
    if (options[name] !== undefined) args.push(`--${name}`, options[name]);
  }
  await run(process.execPath, args);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.catalog) throw new Error('The preferred cloud publisher requires --catalog');
  const now = new Date(options.now ?? Date.now());
  if (Number.isNaN(now.valueOf())) throw new Error('Invalid --now value');
  const retrievedAt = now.toISOString().replace('.000Z', 'Z');
  const outputDirectory = resolve(options.output ?? 'public/earth-state');
  const publicRoot = resolve(options['public-root'] ?? 'public');
  const python = options.python ?? 'python3';
  const satcorpsPromoted = await readSatcorpsPromotion(options['soak-report'], retrievedAt);
  const baseManifestPath = await resolveEarthStateBaseManifest({
    explicitPath: options['base-manifest'],
    outputDirectory,
    fallbackPath: 'public/earth-state/bundled-v1.json',
  });
  await access(baseManifestPath);
  try {
    const result = await publishSatcorps({
      baseManifestPath,
      outputDirectory,
      publicRoot,
      python,
      retrievedAt,
      catalog: await readCatalog(options.catalog),
      satcorpsPromoted,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (satcorpsError) {
    await publishGmgsiFallback({ options, baseManifestPath, outputDirectory, publicRoot, python, retrievedAt, satcorpsError });
  }
}

await main();
