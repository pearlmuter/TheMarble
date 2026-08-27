import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { earthStateMediaTypeForPath } from '../src/earth-state-media-types.js';
import { createFilePublicationStore } from '../src/earth-state-publication-file-store.js';
import { createEarthStatePublisher } from '../src/earth-state-publication.js';
import { selectSeasonalSurfaceFrames } from '../src/seasonal-surface.js';
import { withRollingSurfaceUpdate } from '../src/rolling-surface-manifest.js';
import { rollingSurfaceProduct } from '../src/rolling-surface-products.js';
import { selectRollingSurfaceObservations } from '../src/rolling-surface-selection.js';

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error('Arguments must be --name value pairs');
    options[flag.slice(2)] = value;
  }
  for (const required of ['catalog', 'target-time', 'output', 'python']) {
    if (!options[required]) throw new Error(`Missing required --${required}`);
  }
  return options;
}

const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const iso = value => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid rolling-surface time: ${value}`);
  return parsed.toISOString().replace('.000Z', 'Z');
};

function mediaTypeFor(url, header) {
  const declared = header?.split(';', 1)[0];
  if (declared && declared !== 'application/octet-stream') return declared;
  const mediaType = earthStateMediaTypeForPath(new URL(url).pathname);
  if (new URL(url).pathname.endsWith('.npz')) return 'application/octet-stream';
  if (!mediaType) throw new Error(`Cannot determine media type for ${url}`);
  return mediaType;
}

async function loadBytes(url) {
  const parsed = new URL(url);
  if (parsed.protocol === 'file:') return { bytes: new Uint8Array(await readFile(fileURLToPath(parsed))), mediaType: mediaTypeFor(url) };
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Unsupported source protocol: ${parsed.protocol}`);
  const response = await fetch(parsed, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Source unavailable (${response.status}): ${url}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType: mediaTypeFor(url, response.headers.get('content-type')) };
}

function absoluteAssetReferences(manifest, manifestUrl) {
  const next = structuredClone(manifest);
  for (const descriptor of [...Object.values(next.layers), ...Object.values(next.resources)]) {
    descriptor.asset.href = new URL(descriptor.asset.href, manifestUrl).href;
  }
  for (const frame of next.layers.surfaceAlbedo.seasonalCycle?.frames ?? []) {
    frame.asset.href = new URL(frame.asset.href, manifestUrl).href;
  }
  return next;
}

async function readBaseManifest(output, explicitPath) {
  let manifestPath;
  if (explicitPath) {
    manifestPath = resolve(explicitPath);
  } else {
    const latestPath = resolve(output, 'latest.json');
    try {
      const latest = JSON.parse(await readFile(latestPath, 'utf8'));
      manifestPath = fileURLToPath(new URL(latest.manifest.href, pathToFileURL(latestPath)));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      manifestPath = resolve('public/earth-state/bundled-v1.json');
    }
  }
  const url = pathToFileURL(manifestPath).href;
  return { manifest: absoluteAssetReferences(JSON.parse(await readFile(manifestPath, 'utf8')), url), url };
}

async function materialize(url, directory, label) {
  const loaded = await loadBytes(url);
  const extension = extname(new URL(url).pathname) || '.bin';
  const path = join(directory, `${label}${extension}`);
  await writeFile(path, loaded.bytes);
  return path;
}

function runPython(python, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(resolve(python), args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Rolling-surface compositor exited with status ${code}`)));
  });
}

function referenceFor(path, mediaType) {
  return readFile(path).then(bytes => ({
    href: pathToFileURL(path).href,
    mediaType,
    byteLength: bytes.byteLength,
    immutable: true,
    checksum: { algorithm: 'sha256', value: checksum(bytes) },
  }));
}

const options = parseArguments(process.argv.slice(2));
const targetTime = iso(options['target-time']);
const output = resolve(options.output);
const catalogPath = resolve(options.catalog);
const catalogUrl = pathToFileURL(catalogPath).href;
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const { manifest: baseManifest } = await readBaseManifest(output, options['base-manifest']);
const selected = selectRollingSurfaceObservations({
  targetTime,
  previousObservationWindows: baseManifest.layers.surfaceAlbedo.rollingComposite?.observationWindows ?? [],
  maxCandidateAgeDays: Number(options['max-candidate-age-days'] ?? 16),
  minAcceptedFraction: Number(options['min-accepted-fraction'] ?? 0.25),
  candidates: catalog.candidates ?? [],
});

const temporary = await mkdtemp(join(tmpdir(), 'themarble-rolling-surface-'));
try {
  const seasonal = baseManifest.layers.surfaceAlbedo.seasonalCycle;
  if (!seasonal) throw new Error('Rolling surface requires the permanent 12-month seasonal fallback');
  const pair = selectSeasonalSurfaceFrames(new Date(targetTime));
  const fromFrame = seasonal.frames.find(frame => frame.month === pair.fromMonth);
  const toFrame = seasonal.frames.find(frame => frame.month === pair.toMonth);
  const baselineFrom = await materialize(fromFrame.asset.href, temporary, `baseline-${pair.fromMonth}`);
  const baselineTo = await materialize(toFrame.asset.href, temporary, `baseline-${pair.toMonth}`);
  const priorWindows = baseManifest.layers.surfaceAlbedo.rollingComposite?.observationWindows ?? [];
  const fingerprint = window => [window.product, window.version, window.validAt, window.observedFrom, window.observedTo].join('|');
  const existingByFingerprint = new Map(priorWindows.map(window => [fingerprint(window), window]));
  let nextWindowIndex = Math.max(0, ...priorWindows.map(window => window.index)) + 1;
  const candidateWindows = selected.map(candidate => {
    const fields = {
      product: candidate.product,
      version: candidate.version,
      validAt: candidate.validAt,
      observedFrom: candidate.observedFrom,
      observedTo: candidate.observedTo,
    };
    const existing = existingByFingerprint.get(fingerprint(fields));
    if (existing) return existing;
    if (nextWindowIndex > 65534) throw new Error('Rolling-surface observation-window index space is exhausted');
    return { index: nextWindowIndex++, ...fields };
  });
  const observations = [];
  for (const [index, candidate] of selected.entries()) {
    const sourceUrl = new URL(candidate.href, catalogUrl).href;
    const loaded = await loadBytes(sourceUrl);
    if (candidate.byteLength !== undefined && loaded.bytes.byteLength !== candidate.byteLength) throw new Error(`Observation byteLength mismatch: ${candidate.href}`);
    if (candidate.checksum?.algorithm === 'sha256' && checksum(loaded.bytes) !== candidate.checksum.value.toLowerCase()) throw new Error(`Observation checksum mismatch: ${candidate.href}`);
    const path = join(temporary, `observation-${index}-${basename(new URL(sourceUrl).pathname)}`);
    await writeFile(path, loaded.bytes);
    observations.push({ product: candidate.product, path, windowIndex: candidateWindows[index].index });
  }

  let previous;
  if (baseManifest.layers.surfaceAlbedo.rollingComposite && baseManifest.layers.surfaceAge) {
    previous = {
      surface: await materialize(baseManifest.layers.surfaceAlbedo.asset.href, temporary, 'previous-surface'),
      age: await materialize(baseManifest.layers.surfaceAge.asset.href, temporary, 'previous-age'),
      windowSources: Object.fromEntries(priorWindows.map(window => [window.index, rollingSurfaceProduct(window.product).sourceCode])),
    };
  }
  const previousValidAt = baseManifest.layers.surfaceAlbedo.rollingComposite?.validAt;
  const elapsedDays = previousValidAt ? Math.max(0, (Date.parse(targetTime) - Date.parse(previousValidAt)) / 86_400_000) : 1;
  const requestPath = join(temporary, 'request.json');
  const surfacePath = join(temporary, 'rolling-surface.png');
  const agePath = join(temporary, 'rolling-surface-age.png');
  const metadataPath = join(temporary, 'rolling-surface-metadata.json');
  await writeFile(requestPath, `${JSON.stringify({
    seasonalBaseline: { from: baselineFrom, to: baselineTo, mix: pair.mix },
    previous,
    observations,
    elapsedDays,
    minQuality: Number(options['min-quality'] ?? 0.72),
    minGeometryQuality: Number(options['min-geometry-quality'] ?? 0.5),
    maxDailyChange: Number(options['max-daily-change'] ?? 0.12),
    seamFeatherPixels: Number(options['seam-feather-pixels'] ?? 3),
  }, null, 2)}\n`);
  await runPython(options.python, [
    resolve('scripts/rolling_surface_compositor.py'),
    '--request', requestPath,
    '--surface-output', surfacePath,
    '--age-output', agePath,
    '--metadata-output', metadataPath,
  ]);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const allWindows = [...priorWindows, ...candidateWindows.filter(window => !priorWindows.some(prior => prior.index === window.index))];
  const usedWindows = allWindows.filter(window => metadata.usedWindowIndices.includes(window.index));
  const usedProducts = [...new Set(usedWindows.map(window => window.product))];
  const observedFrom = usedWindows.length
    ? new Date(Math.min(...usedWindows.map(window => Date.parse(window.observedFrom)))).toISOString().replace('.000Z', 'Z')
    : baseManifest.times.observedFrom;
  const observedTo = usedWindows.length
    ? new Date(Math.max(...usedWindows.map(window => Date.parse(window.observedTo)))).toISOString().replace('.000Z', 'Z')
    : baseManifest.times.observedTo;
  const retrievedAt = iso(catalog.retrievedAt ?? targetTime);
  const datasetVersion = usedWindows.length
    ? [...new Set(usedWindows.map(window => window.version))].join('+')
    : 'seasonal-baseline-only';
  const generated = withRollingSurfaceUpdate(baseManifest, {
    dataset: {
      id: `rolling-land-${targetTime.slice(0, 10)}`,
      version: datasetVersion,
      attribution: 'NASA LP DAAC MODIS/VIIRS surface observations; modified by TheMarble into a rolling clear-land composite',
    },
    surfaceAsset: await referenceFor(surfacePath, 'image/png'),
    ageAsset: await referenceFor(agePath, 'image/png'),
    validAt: targetTime,
    observedFrom,
    observedTo,
    producedAt: targetTime,
    retrievedAt,
    coverage: metadata.coverage,
    oldestPixelAgeDays: metadata.oldestPixelAgeDays,
    newestPixelAgeDays: metadata.newestPixelAgeDays,
    sourceProducts: usedProducts,
    observationWindows: usedWindows,
    normalization: {
      method: 'robust-channel-gain-delta-limit-and-inward-feather',
      maxDailyChange: Number(options['max-daily-change'] ?? 0.12),
      seamFeatherPixels: Number(options['seam-feather-pixels'] ?? 3),
      gainRange: [0.75, 1.25],
    },
  });
  const sourceManifestPath = join(temporary, 'manifest.json');
  await writeFile(sourceManifestPath, `${JSON.stringify(generated, null, 2)}\n`);
  const sourceManifestUrl = pathToFileURL(sourceManifestPath).href;
  const publisher = createEarthStatePublisher({ loadSource: loadBytes, store: createFilePublicationStore(output) });
  const publication = await publisher.publish({ targetTime, sourceManifestUrl });
  process.stdout.write(`${JSON.stringify({
    bundleId: publication.manifest.bundleId,
    latest: resolve(output, 'latest.json'),
    selectedObservations: selected.length,
    usedProducts,
    coverage: metadata.coverage,
  }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
