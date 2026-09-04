import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCryosphereCatalog } from '../src/cryosphere-catalog.js';
import { evaluateCloudProviderSoak } from '../src/cloud-provider-soak.js';
import { resolveEarthStatePublishedManifestPath } from '../src/earth-state-publication-base.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
// Never inside public/: Vite copies that directory into every website build.
const PREVIEW_ROOT = 'artifacts/earth-state-preview';
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

/**
 * Serves the fixture granules over HTTP. The cloud publisher fetches every source by URL, which
 * is the same path it takes in production; handing it a local file would exercise a different
 * one.
 */
function serveFixtureGranules(directory, port) {
  const server = createServer(async (request, response) => {
    const name = basename(new URL(request.url, 'http://localhost').pathname);
    const path = join(directory, name);
    try {
      const info = await stat(path);
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': info.size });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise(fulfil => server.listen(port, '127.0.0.1', () => fulfil(server)));
}

/**
 * SatCORPS is gated behind a soak: it is only preferred once it has proven itself over weeks of
 * sampling. A fixture has no history, so one is generated and the report is derived from it with
 * the same function the gate re-derives it with -- the gate is satisfied rather than bypassed,
 * and it stays a real check of whether the samples support promotion.
 */
async function buildFixtureSoak({ directory, now, policyPath }) {
  const policy = JSON.parse(await readFile(policyPath, 'utf8')).soak;
  const start = Date.parse(now.toISOString()) - 22 * 24 * 60 * 60 * 1000;
  const provider = {
    discoveryLatencyMinutes: 48,
    expectedObservations: 24,
    missingObservations: 0,
    coverageFraction: .95,
    corruptProducts: 0,
    schemaDrift: false,
    dimensionsChanged: false,
    schemaFingerprint: 'preview-fixture-v1',
    dimensions: { width: 2048, height: 1024 },
    available: true,
    qualityFlags: [],
  };
  const samples = Array.from({ length: 22 * 24 }, (_, hour) => ({
    checkedAt: new Date(start + hour * 60 * 60 * 1000).toISOString().replace('.000Z', 'Z'),
    satcorps: { ...provider },
    gmgsi: { ...provider, discoveryLatencyMinutes: 61 },
    interSourceDisagreementFraction: .04,
  }));
  const report = evaluateCloudProviderSoak(samples, policy);
  if (report.qualified !== true) {
    throw new Error('The generated soak history does not qualify SatCORPS, so the fixture would silently fall back to GMGSI');
  }
  const historyPath = join(directory, 'satcorps-soak.ndjson');
  const reportPath = join(directory, 'satcorps-soak.json');
  await writeFile(historyPath, `${samples.map(sample => JSON.stringify(sample)).join('\n')}\n`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { historyPath, reportPath };
}

async function buildSatcorpsFixture({ python, directory, now, port }) {
  const granuleDirectory = join(directory, 'satcorps');
  const planPath = join(granuleDirectory, 'plan.json');
  await mkdir(granuleDirectory, { recursive: true });
  await run(python, [
    join(scriptDirectory, 'preview_satcorps_fixture.py'),
    '--output', granuleDirectory,
    '--valid-at', `${now.toISOString().slice(0, 13)}:00:00Z`,
    '--plan', planPath,
  ]);
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const server = await serveFixtureGranules(granuleDirectory, port);
  const catalog = {
    sequences: [{
      provider: 'satcorps',
      frames: plan.frames.map(frame => ({
        provider: 'satcorps',
        validAt: frame.validAt,
        observedFrom: frame.observedFrom,
        observedTo: frame.observedTo,
        producedAt: frame.producedAt,
        version: frame.version,
        coverage: { observedFraction: .946 },
        quality: { usableFraction: .946 },
        assets: { manifest: `http://127.0.0.1:${port}/${basename(frame.path)}` },
      })),
    }],
  };
  const catalogPath = join(directory, 'satcorps-catalog.json');
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return { catalogPath, server };
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
  const wantsSatcorps = booleanOption(options, 'satcorps-fixture');
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

  // Production never reaches the SatCORPS publisher: the clouds workflow runs the feed with no
  // cloud catalog, so it always takes the GMGSI path and every published state has said "cloud
  // thickness assumed". This runs the dormant path so the renderer can be shown a retrieved
  // optical depth and a retrieved cloud-top height.
  let satcorps;
  if (wantsSatcorps) {
    satcorps = await buildSatcorpsFixture({
      python, directory: workingDirectory, now, port: Number(options['fixture-port'] ?? 8789),
    });
    const soak = await buildFixtureSoak({
      directory: workingDirectory, now, policyPath: options['soak-policy'] ?? 'config/earth-production-policy.json',
    });
    process.stdout.write('Clouds come from a labelled local SatCORPS fixture; they are not an observation.\n');
    await run(process.execPath, [
      join(scriptDirectory, 'publish-cloud-earth-state.mjs'),
      '--catalog', satcorps.catalogPath,
      '--python', python,
      '--output', earthStateDirectory,
      '--soak-report', soak.reportPath,
      '--soak-history', soak.historyPath,
      '--soak-policy', options['soak-policy'] ?? 'config/earth-production-policy.json',
    ]);
  }

  await run(process.execPath, [
    join(scriptDirectory, 'publish-earth-state-feed.mjs'),
    '--output', earthStateDirectory,
    '--python', python,
    ...(cryosphereCatalog ? ['--cryosphere-catalog', cryosphereCatalog] : []),
    ...(wantsSatcorps ? ['--skip-clouds', 'true'] : options['skip-clouds'] ? ['--skip-clouds', options['skip-clouds']] : []),
    '--report', join(workingDirectory, 'feed-run.json'),
  ]).catch(error => {
    process.stdout.write(`The live producers did not complete: ${error.message}\n`);
    process.stdout.write('TheMarble will open on whatever verified state the preview directory already holds.\n');
  });

  // The feed daemon serves the published state with the headers the delivery
  // rules require, so the preview exercises the same path production uses.
  const feedPort = options['feed-port'] ?? '8788';
  const daemon = spawn(process.execPath, [
    join(scriptDirectory, 'serve-earth-state-feed.mjs'),
    '--output', earthStateDirectory,
    '--python', python,
    '--port', feedPort,
  ], { stdio: 'inherit' });
  const latestUrl = `http://127.0.0.1:${feedPort}/latest.json`;
  process.stdout.write(`Opening TheMarble against ${latestUrl}\n`);
  try {
    await run('npx', ['vite', ...(options.host ? ['--host', options.host] : []), ...(options.port ? ['--port', options.port] : [])], {
      env: { ...process.env, VITE_EARTH_STATE_LATEST_URL: latestUrl },
    });
  } finally {
    daemon.kill();
    satcorps?.server.close();
  }
}

await main();
