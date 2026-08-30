import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCryosphereCatalog } from '../src/cryosphere-catalog.js';

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

function templateValues(day, grid) {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid analysis day: ${day}`);
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
  const template = (descriptor.urlTemplateEnv ? process.env[descriptor.urlTemplateEnv] : undefined) ?? descriptor.urlTemplate;
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
  return bytes.byteLength;
}

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

async function retrieve(descriptor, values, stage) {
  const url = resolveUrl(descriptor, values);
  if (!url) return { skipped: `${descriptor.product} has no configured endpoint (${descriptor.urlTemplateEnv})` };
  const headers = authorizationHeader(descriptor);
  const path = join(stage, `${descriptor.product}${descriptor.extension ?? '.tif'}`);
  try {
    await download(url, headers, path);
  } catch (error) {
    return { skipped: `${descriptor.product} delivery failed: ${error.message ?? String(error)}` };
  }

  const source = {
    product: descriptor.product,
    validAt: `${values.ISO_DATE}T00:00:00Z`,
    producedAt: values.PRODUCED_AT,
    version: descriptor.version,
    attribution: descriptor.attribution,
    input: { ...descriptor.input, path },
    semantics: structuredClone(descriptor.semantics),
  };

  if (source.semantics.type === 'viirs') {
    const quality = source.semantics.quality;
    const qualityUrl = resolveUrl(quality, values);
    if (!qualityUrl) return { skipped: `${descriptor.product} has no configured quality endpoint (${quality.urlTemplateEnv})` };
    const qualityPath = join(stage, `${descriptor.product}-quality${quality.extension ?? '.tif'}`);
    try {
      await download(qualityUrl, headers, qualityPath);
    } catch (error) {
      return { skipped: `${descriptor.product} quality delivery failed: ${error.message ?? String(error)}` };
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
  const day = options.day ?? retrievedAt.slice(0, 10);
  const outputDirectory = resolve(options.output ?? 'artifacts/cryosphere');
  const stage = join(outputDirectory, 'delivered');
  await mkdir(stage, { recursive: true });

  const values = { ...templateValues(day, grid), PRODUCED_AT: retrievedAt };
  const sources = [];
  const skipped = [];
  for (const descriptor of configuration.sources) {
    const result = await retrieve(descriptor, values, stage);
    if (result.source) sources.push(result.source);
    else {
      skipped.push(result.skipped);
      if (descriptor.required) throw new Error(result.skipped);
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
  const catalog = buildCryosphereCatalog({ products: adapted.products, retrievedAt });
  const catalogPath = join(outputDirectory, 'cryosphere-catalog.json');
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await rm(stage, { recursive: true, force: true });

  process.stdout.write(`${JSON.stringify({
    status: 'built',
    catalogPath,
    validAt: catalog.selection.validAt,
    imsFallback: catalog.selection.fallback.ims,
    contingency: catalog.contingency,
    excluded: catalog.excluded,
    skipped,
  }, null, 2)}\n`);
}

await main();
