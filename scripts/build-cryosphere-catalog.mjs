import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCryosphereCatalog, configuredEndpoint, newestObservedCryosphereDays } from '../src/cryosphere-catalog.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CANDIDATE_DAYS = 3;

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

function utcDays(newestDay, count) {
  const newest = Date.parse(`${newestDay}T00:00:00Z`);
  if (Number.isNaN(newest)) throw new Error(`Invalid analysis day: ${newestDay}`);
  return Array.from({ length: count }, (_, index) => new Date(newest - index * 86_400_000).toISOString().slice(0, 10));
}

function templateValues(day, grid) {
  const date = new Date(`${day}T00:00:00Z`);
  const dayOfYear = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
  return {
    ISO_DATE: day,
    EPOCH_MS: String(date.valueOf()),
    YYYY: day.slice(0, 4),
    MM: day.slice(5, 7),
    DD: day.slice(8, 10),
    DDD: String(dayOfYear).padStart(3, '0'),
    WIDTH: String(grid.width),
    HEIGHT: String(grid.height),
    NORTHERN_HEIGHT: String(Math.round(grid.height / 2)),
  };
}

function expand(template, values) {
  return template.replaceAll(/\{([A-Z_]+)\}/g, (match, name) => {
    if (!(name in values)) throw new Error(`Unknown source template variable: ${name}`);
    return values[name];
  });
}

function resolveUrl(descriptor, values) {
  const template = configuredEndpoint(
    descriptor.urlTemplateEnv ? process.env[descriptor.urlTemplateEnv] : undefined,
    descriptor.urlTemplate,
  );
  return template ? expand(template, values) : undefined;
}

function authorizationHeader(descriptor) {
  const authorization = descriptor.authorization;
  if (!authorization) return {};
  const secret = process.env[authorization.env];
  if (!secret) throw new Error(`${descriptor.product} requires ${authorization.env} in the publishing environment`);
  return { authorization: `${authorization.scheme} ${secret}` };
}

async function download(url, headers, destination) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(300_000) });
  // Never echo the URL: provider templates can carry query-string credentials.
  if (!response.ok) throw new Error(`Provider delivery answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('Provider delivery was empty');
  await writeFile(destination, bytes);
  // The provider's own statement about when it produced this delivery, when it makes one.
  return response.headers.get('last-modified') ?? undefined;
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

/**
 * A scattered source states where each of its cells is in separately published
 * coordinate grids. They never change -- the IMS pair has not moved since 2015 --
 * so they are fetched once and shared by every candidate day.
 */
async function resolveScatteredGrids(grids, stage, cache) {
  const resolved = {};
  for (const [axis, grid] of Object.entries(grids)) {
    if (!cache.has(grid.url)) {
      const path = join(stage, `${axis}${grid.extension ?? '.bin.gz'}`);
      await download(grid.url, {}, path);
      cache.set(grid.url, path);
    }
    resolved[axis] = { path: cache.get(grid.url), dtype: grid.dtype, shape: grid.shape };
  }
  return resolved;
}

async function retrieveCandidate(descriptor, day, values, stage, retrievedAt, gridCache) {
  const url = resolveUrl(descriptor, values);
  if (!url) return { skipped: `${descriptor.product} has no configured endpoint (${descriptor.urlTemplateEnv}): ${descriptor.reason ?? 'no public default exists'}` };
  const headers = authorizationHeader(descriptor);
  const key = `${descriptor.product}@${day}`;
  const path = join(stage, `${key}${descriptor.extension ?? '.tif'}`);
  let lastModified;
  try {
    lastModified = await download(url, headers, path);
  } catch (error) {
    return { skipped: `${key} delivery failed: ${error.message ?? String(error)}` };
  }

  const producedAt = lastModified && !Number.isNaN(Date.parse(lastModified))
    ? new Date(lastModified).toISOString().replace('.000Z', 'Z')
    : retrievedAt;
  let input = { ...descriptor.input, path };
  if (input.kind === 'scattered' && input.grids) {
    const { grids, ...rest } = input;
    try {
      input = { ...rest, ...await resolveScatteredGrids(grids, stage, gridCache) };
    } catch (error) {
      return { skipped: `${key} coordinate grids failed: ${error.message ?? String(error)}` };
    }
  }
  const source = {
    product: descriptor.product,
    key,
    validAt: `${day}T00:00:00Z`,
    // A provider that never states a production time is recorded as produced at retrieval,
    // which is the latest it can honestly be claimed to have existed.
    producedAt: Date.parse(producedAt) < Date.parse(`${day}T00:00:00Z`) ? retrievedAt : producedAt,
    version: descriptor.version,
    attribution: descriptor.attribution,
    input,
    semantics: structuredClone(descriptor.semantics),
  };

  if (source.semantics.type === 'viirs') {
    const quality = source.semantics.quality;
    const qualityUrl = resolveUrl(quality, values);
    if (!qualityUrl) return { skipped: `${descriptor.product} has no configured quality endpoint (${quality.urlTemplateEnv})` };
    const qualityPath = join(stage, `${key}-quality${quality.extension ?? '.tif'}`);
    try {
      await download(qualityUrl, headers, qualityPath);
    } catch (error) {
      return { skipped: `${key} quality delivery failed: ${error.message ?? String(error)}` };
    }
    source.semantics.quality = { kind: quality.kind, bounds: quality.bounds, path: qualityPath };
  }
  return { source };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const configuration = JSON.parse(await readFile(resolve(options.sources ?? 'config/cryosphere-sources.json'), 'utf8'));
  const grid = {
    width: Number(options.width ?? configuration.grid.width),
    height: Number(options.height ?? configuration.grid.height),
  };
  const retrievedAt = new Date(options.now ?? Date.now()).toISOString().replace('.000Z', 'Z');
  const days = utcDays(options.day ?? retrievedAt.slice(0, 10), Number(options.days ?? DEFAULT_CANDIDATE_DAYS));
  const outputDirectory = resolve(options.output ?? 'artifacts/cryosphere');
  const stage = join(outputDirectory, 'delivered');
  await mkdir(stage, { recursive: true });

  // Every provider is asked for each candidate day; the day each one actually
  // delivered is decided from its adapted pixels, never from the day requested.
  const sources = [];
  const skipped = [];
  const gridCache = new Map();
  for (const descriptor of configuration.sources) {
    for (const day of days) {
      const result = await retrieveCandidate(descriptor, day, { ...templateValues(day, grid) }, stage, retrievedAt, gridCache);
      if (result.source) sources.push(result.source);
      else skipped.push(result.skipped);
    }
    if (descriptor.required && !sources.some(source => source.product === descriptor.product)) {
      throw new Error(`${descriptor.product} delivered no usable day: ${skipped.at(-1)}`);
    }
  }
  if (sources.length === 0) throw new Error('No daily cryosphere provider delivered a usable product');

  const planPath = join(outputDirectory, 'adapter-plan.json');
  const productsPath = join(outputDirectory, 'adapter-products.json');
  await writeFile(planPath, `${JSON.stringify({ retrievedAt, ...grid, sources }, null, 2)}\n`);
  await run(options.python ?? 'python3', [
    join(scriptDirectory, 'cryosphere_provider_adapter.py'),
    '--plan', planPath,
    '--output', outputDirectory,
    '--products', productsPath,
  ]);

  const adapted = JSON.parse(await readFile(productsPath, 'utf8'));
  const resolved = newestObservedCryosphereDays(adapted.products);
  const catalog = buildCryosphereCatalog({ products: resolved.products, retrievedAt });
  catalog.excluded.push(...resolved.excluded);
  const catalogPath = join(outputDirectory, 'cryosphere-catalog.json');
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await rm(stage, { recursive: true, force: true });

  process.stdout.write(`${JSON.stringify({
    status: 'built',
    catalogPath,
    candidateDays: days,
    validAt: catalog.selection.validAt,
    imsFallback: catalog.selection.fallback.ims,
    contingency: catalog.contingency,
    excluded: catalog.excluded,
    skipped,
  }, null, 2)}\n`);
}

await main();
