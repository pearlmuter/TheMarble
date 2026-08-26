import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addCryosphereAnalysis } from '../src/cryosphere-manifest.js';
import { selectDailyCryosphere } from '../src/cryosphere-selection.js';
import { earthStateMediaTypeForPath } from '../src/earth-state-media-types.js';
import { createFilePublicationStore } from '../src/earth-state-publication-file-store.js';
import { createEarthStatePublisher } from '../src/earth-state-publication.js';

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

async function bytesFromUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol === 'file:') return new Uint8Array(await readFile(fileURLToPath(parsed)));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Unsupported cryosphere source protocol: ${parsed.protocol}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Cryosphere source unavailable (${response.status}): ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function readCatalog(catalogUrl) {
  const bytes = await bytesFromUrl(catalogUrl);
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  if (!catalog || !Array.isArray(catalog.candidates)) throw new Error('Cryosphere catalog is missing candidates');
  return {
    ...catalog,
    candidates: catalog.candidates.map(candidate => ({
      ...candidate,
      href: new URL(candidate.href, catalogUrl).href,
      ...(candidate.qualityHref ? { qualityHref: new URL(candidate.qualityHref, catalogUrl).href } : {}),
    })),
  };
}

async function existingValidAt(outputDirectory) {
  try {
    const latest = JSON.parse(await readFile(join(outputDirectory, 'latest.json'), 'utf8'));
    const manifestPath = resolve(outputDirectory, latest.manifest.href.replace(/^\.\//, ''));
    const prefix = `${resolve(outputDirectory)}${sep}`;
    if (!manifestPath.startsWith(prefix)) throw new Error('Published manifest escapes output directory');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    return manifest.layers.snowCover?.provenance?.validAt;
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

async function materialize(candidate, destination) {
  await writeFile(destination, await bytesFromUrl(candidate.href));
  return destination;
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputDirectory = resolve(options.output ?? 'public/earth-state');
  const baseManifestPath = resolve(options['base-manifest'] ?? 'public/earth-state/bundled-v1.json');
  const publicRoot = resolve(options['public-root'] ?? 'public');
  const python = options.python ?? 'python3';
  const catalogUrl = new URL(options.catalog ?? './cryosphere-catalog.json', pathToFileURL(`${process.cwd()}${sep}`)).href;
  await access(baseManifestPath);
  const catalog = await readCatalog(catalogUrl);
  const retrievedAt = new Date(options.now ?? catalog.retrievedAt ?? Date.now()).toISOString().replace('.000Z', 'Z');
  const selection = selectDailyCryosphere({
    candidates: catalog.candidates,
    retrievedAt,
    lastPublishedValidAt: await existingValidAt(outputDirectory),
  });
  if (!selection.publish) {
    process.stdout.write(`${JSON.stringify({ status: 'unchanged', validAt: selection.validAt }, null, 2)}\n`);
    return;
  }

  const stage = await mkdtemp(join(tmpdir(), 'themarble-cryosphere-'));
  try {
    const paths = {
      fallbackSnow: await materialize(selection.analysis.globalFallback.snow, join(stage, 'global-snow.npy')),
      fallbackSeaIce: await materialize(selection.analysis.globalFallback.seaIce, join(stage, 'global-sea-ice.npy')),
      snow: join(stage, 'snow-cover.png'),
      seaIce: join(stage, 'sea-ice.png'),
      metadata: join(stage, 'cryosphere-metadata.json'),
    };
    if (selection.analysis.northernPrimary) paths.ims = await materialize(selection.analysis.northernPrimary, join(stage, 'ims.npy'));
    if (selection.refinement) {
      if (!selection.refinement.qualityHref) throw new Error('Selected VIIRS refinement is missing qualityHref');
      paths.viirsSnow = await materialize(selection.refinement, join(stage, 'viirs-snow.npy'));
      paths.viirsQuality = join(stage, 'viirs-quality.npy');
      await writeFile(paths.viirsQuality, await bytesFromUrl(selection.refinement.qualityHref));
    }
    const sources = [
      selection.analysis.northernPrimary,
      selection.analysis.globalFallback.snow,
      selection.analysis.globalFallback.seaIce,
      selection.refinement,
    ].filter(Boolean);
    const producedAt = sources.reduce((latest, source) => Date.parse(source.producedAt) > Date.parse(latest) ? source.producedAt : latest, sources[0].producedAt);
    const sourceVersion = [...new Set(sources.map(source => source.version))].join(' + ');
    const fallback = selection.fallback.ims
      ? selection.fallback.reason
      : 'Global microwave analysis fills the Southern Hemisphere and any IMS coverage gap.';
    const defaultAttribution = {
      'ims-snow-ice': 'U.S. National Ice Center IMS',
      'gmasi-snow': 'NOAA/NESDIS GMASI',
      'gmasi-sea-ice': 'NOAA/NESDIS GMASI',
      'amsr2-snow': 'NASA/JAXA AMSR2',
      'amsr2-sea-ice': 'NASA/JAXA AMSR2',
      'viirs-snow': 'NASA VIIRS VNP10_NRT',
    };
    const attribution = `${[...new Set(sources.map(source => source.attribution ?? defaultAttribution[source.product]))].join('; ')}, modified by TheMarble`;
    const compositorArgs = [
      join(scriptDirectory, 'cryosphere_compositor.py'),
      '--fallback-snow', paths.fallbackSnow,
      '--fallback-sea-ice', paths.fallbackSeaIce,
      '--snow', paths.snow,
      '--sea-ice', paths.seaIce,
      '--metadata', paths.metadata,
      '--valid-at', selection.validAt,
      '--produced-at', producedAt,
      '--retrieved-at', selection.retrievedAt,
      '--source-version', sourceVersion,
      '--fallback', fallback,
      '--attribution', attribution,
      ...(paths.ims ? ['--ims', paths.ims] : []),
      ...(paths.viirsSnow ? ['--viirs-snow', paths.viirsSnow, '--viirs-quality', paths.viirsQuality] : []),
    ];
    await run(python, compositorArgs);
    const [snowAsset, seaIceAsset, metadata, baseManifest] = await Promise.all([
      assetReference(paths.snow),
      assetReference(paths.seaIce),
      readFile(paths.metadata, 'utf8').then(JSON.parse),
      readFile(baseManifestPath, 'utf8').then(JSON.parse),
    ]);
    const manifest = addCryosphereAnalysis(baseManifest, { selection, metadata, snowAsset, seaIceAsset });
    manifest.bundleId = `source-cryosphere-${selection.validAt}`;
    manifest.classification = 'observed';
    const sourceManifestPath = join(stage, 'manifest.json');
    await writeFile(sourceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const stagePrefix = `${stage}${sep}`;
    const publicPrefix = `${publicRoot}${sep}`;
    const publisher = createEarthStatePublisher({
      assetLayout: 'content-addressed',
      store: createFilePublicationStore(outputDirectory),
      async loadSource(url) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'file:') throw new Error(`Unexpected publication source protocol: ${parsed.protocol}`);
        let path = fileURLToPath(parsed);
        if (path !== sourceManifestPath && !path.startsWith(stagePrefix)) path = resolve(publicRoot, parsed.pathname.replace(/^\/+/, ''));
        if (path !== sourceManifestPath && !path.startsWith(stagePrefix) && path !== publicRoot && !path.startsWith(publicPrefix)) {
          throw new Error(`Publication source escapes allowed roots: ${path}`);
        }
        const bytes = await readFile(path);
        const mediaType = earthStateMediaTypeForPath(path);
        if (!mediaType) throw new Error(`Unsupported publication source type: ${path}`);
        return { bytes, mediaType };
      },
    });
    const publication = await publisher.publish({ targetTime: selection.retrievedAt, sourceManifestUrl: pathToFileURL(sourceManifestPath).href });
    process.stdout.write(`${JSON.stringify({ status: 'published', validAt: selection.validAt, bundleId: publication.manifest.bundleId, manifestPath: publication.manifestPath }, null, 2)}\n`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

await main();
