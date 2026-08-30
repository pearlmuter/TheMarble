import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCryosphereCatalog } from '../src/cryosphere-catalog.js';
import { resolveEarthStatePublishedManifestPath } from '../src/earth-state-publication-base.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const PREVIEW_ROOT = 'public/earth-state-preview';
const FIXTURE_VERSION = 'local-preview-fixture';

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

/** Each producer inherits the current bundle, so a previous fixture would survive the switch. */
async function publishedCarriesFixture(earthStateDirectory) {
  const manifestPath = await resolveEarthStatePublishedManifestPath(earthStateDirectory);
  if (!manifestPath) return false;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  return Object.values(manifest.layers ?? {})
    .some(layer => layer?.provenance?.sourceVersion?.includes(FIXTURE_VERSION));
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

async function buildFixtureCatalog({ python, directory, now }) {
  const validAt = `${now.toISOString().slice(0, 10)}T00:00:00Z`;
  const producedAt = now.toISOString().replace('.000Z', 'Z');
  const planPath = join(directory, 'fixture-plan.json');
  const productsPath = join(directory, 'adapter-products.json');
  await mkdir(directory, { recursive: true });
  await run(python, [
    join(scriptDirectory, 'preview_cryosphere_fixture.py'),
    '--output', directory,
    '--plan', planPath,
    '--valid-at', validAt,
    '--produced-at', producedAt,
  ]);
  await run(python, [
    join(scriptDirectory, 'cryosphere_provider_adapter.py'),
    '--plan', planPath,
    '--output', directory,
    '--products', productsPath,
  ]);
  const adapted = JSON.parse(await readFile(productsPath, 'utf8'));
  const catalog = buildCryosphereCatalog({ products: adapted.products, retrievedAt: producedAt });
  const catalogPath = join(directory, 'cryosphere-catalog.json');
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalogPath;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const python = options.python ?? 'python3';
  const now = new Date(options.now ?? Date.now());
  const earthStateDirectory = resolve(options.output ?? `${PREVIEW_ROOT}/earth-state`);
  const workingDirectory = resolve(options.work ?? `${PREVIEW_ROOT}/work`);
  await mkdir(earthStateDirectory, { recursive: true });

  process.stdout.write('Publishing a local Earth state for visual acceptance.\n');
  // Clouds are genuinely live from the public NOAA bucket. No daily cryosphere source
  // has a working public endpoint, so snow and ice stay with the seasonal surface —
  // real imagery for the month rather than an invented analysis — unless asked otherwise.
  const wantsFixture = booleanOption(options, 'cryosphere-fixture');
  const cryosphereCatalog = options['cryosphere-catalog']
    ?? (wantsFixture ? await buildFixtureCatalog({ python, directory: workingDirectory, now }) : undefined);
  if (!cryosphereCatalog && await publishedCarriesFixture(earthStateDirectory)) {
    await rm(earthStateDirectory, { recursive: true, force: true });
    await mkdir(earthStateDirectory, { recursive: true });
    process.stdout.write('Cleared a previous fixture cryosphere so it is not inherited by this run.\n');
  }
  process.stdout.write(cryosphereCatalog
    ? 'Snow and sea ice come from a labelled local fixture; they are not an observation.\n'
    : 'Snow and sea ice come from the seasonal surface; no contemporary cryosphere source is configured.\n');

  await run(process.execPath, [
    join(scriptDirectory, 'publish-earth-state-feed.mjs'),
    '--output', earthStateDirectory,
    '--python', python,
    ...(cryosphereCatalog ? ['--cryosphere-catalog', cryosphereCatalog] : []),
    ...(options['skip-clouds'] ? ['--skip-clouds', options['skip-clouds']] : []),
    '--report', join(workingDirectory, 'feed-run.json'),
  ]).catch(error => {
    process.stdout.write(`The live producers did not complete: ${error.message}\n`);
    process.stdout.write('TheMarble will open on whatever verified state the preview directory already holds.\n');
  });

  const latestUrl = `/${earthStateDirectory.split('public/').at(-1)}/latest.json`;
  process.stdout.write(`Opening TheMarble against ${latestUrl}\n`);
  await run('npx', ['vite', ...(options.host ? ['--host', options.host] : []), ...(options.port ? ['--port', options.port] : [])], {
    env: { ...process.env, VITE_EARTH_STATE_LATEST_URL: latestUrl },
  });
}

await main();
