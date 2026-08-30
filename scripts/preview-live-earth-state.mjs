import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCryosphereCatalog } from '../src/cryosphere-catalog.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const PREVIEW_ROOT = 'public/earth-state-preview';

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

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

function dayOfYear(date) {
  return Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
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
    '--day-of-year', String(dayOfYear(now)),
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
  const cryosphereCatalog = options['cryosphere-catalog']
    ?? (options['skip-cryosphere'] === 'true' ? undefined : await buildFixtureCatalog({ python, directory: workingDirectory, now }));
  if (!options['cryosphere-catalog'] && cryosphereCatalog) {
    process.stdout.write('Daily cryosphere endpoints are operations-owned, so this preview uses a labelled local fixture for snow and sea ice.\n');
  }

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
