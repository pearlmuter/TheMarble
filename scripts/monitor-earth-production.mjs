import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateCloudProviderSoak } from '../src/cloud-provider-soak.js';
import { evaluateEarthProductionHealth } from '../src/production-observability.js';

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

function sourceUrl(value) {
  try {
    return new URL(value);
  } catch {
    return new URL(pathToFileURL(resolve(value)));
  }
}

async function readBytes(value) {
  const url = sourceUrl(value);
  if (url.protocol === 'file:') return readFile(fileURLToPath(url));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported monitoring source protocol: ${url.protocol}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Monitoring source unavailable (${response.status}): ${url.href}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function readJson(value) {
  return JSON.parse(new TextDecoder().decode(await readBytes(value)));
}

async function probeLatest(value) {
  try {
    const latest = await readJson(value);
    if (typeof latest?.bundleId !== 'string' || latest.bundleId.length === 0) throw new Error('latest pointer has no bundleId');
    return { available: true, bundleId: latest.bundleId };
  } catch (error) {
    return { available: false, bundleId: 'unavailable', error: error.message ?? String(error) };
  }
}

async function readHistory(path) {
  try {
    const source = await readFile(path, 'utf8');
    return source.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function createSoakSample(snapshot, health) {
  return {
    checkedAt: health.checkedAt,
    ...Object.fromEntries(['satcorps', 'gmgsi'].map(provider => {
      const source = snapshot.providers[provider];
      const metrics = health.metrics.providers[provider];
      return [provider, {
        discoveryLatencyMinutes: metrics.discoveryLatencyMinutes,
        expectedObservations: source.expectedObservations,
        missingObservations: metrics.missingObservations,
        coverageFraction: metrics.coverageFraction,
        corruptProducts: metrics.corruptProducts,
        schemaDrift: metrics.schemaDrift,
        dimensionsChanged: metrics.dimensionsChanged,
        qualityFlags: metrics.qualityFlags,
      }];
    })),
    interSourceDisagreementFraction: snapshot.interSourceDisagreementFraction,
  };
}

function json(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function writeImmutable(path, document) {
  const body = json(document);
  try {
    await writeFile(path, body, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST' || await readFile(path, 'utf8') !== body) throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  for (const required of ['snapshot', 'origin-latest', 'cdn-latest', 'smoke-report', 'policy', 'history', 'output']) {
    if (!options[required]) throw new Error(`The production monitor requires --${required}`);
  }
  const now = new Date(options.now ?? Date.now());
  if (Number.isNaN(now.valueOf())) throw new Error('Invalid --now value');
  const checkedAt = now.toISOString().replace('.000Z', 'Z');
  const [snapshot, origin, cdn, smoke, policy] = await Promise.all([
    readJson(options.snapshot),
    probeLatest(options['origin-latest']),
    probeLatest(options['cdn-latest']),
    readJson(options['smoke-report']),
    readJson(options.policy),
  ]);

  const health = evaluateEarthProductionHealth({
    ...snapshot,
    checkedAt,
    delivery: {
      ...snapshot.delivery,
      originAvailable: origin.available,
      cdnAvailable: cdn.available,
      originBundleId: origin.bundleId,
      cdnBundleId: cdn.bundleId,
    },
    client: {
      bundleId: typeof smoke.bundleId === 'string' && smoke.bundleId.length > 0 ? smoke.bundleId : 'unavailable',
      visualSmoke: {
        ok: smoke.ok === true,
        artifacts: Array.isArray(smoke.artifacts) ? smoke.artifacts : [],
        ...(Array.isArray(smoke.failures) && smoke.failures.length > 0 ? { error: smoke.failures.join('; ') } : {}),
      },
    },
  }, policy.health);

  const historyPath = resolve(options.history);
  const history = [...await readHistory(historyPath), createSoakSample(snapshot, health)];
  const promotion = evaluateCloudProviderSoak(history, policy.soak);
  const outputDirectory = resolve(options.output);
  await Promise.all([mkdir(dirname(historyPath), { recursive: true }), mkdir(outputDirectory, { recursive: true })]);
  await writeFile(historyPath, `${history.map(item => JSON.stringify(item)).join('\n')}\n`);
  await writeFile(join(outputDirectory, 'health.json'), json(health));
  await writeFile(join(outputDirectory, 'satcorps-promotion.json'), json(promotion));
  const timestamp = health.checkedAt.replaceAll(':', '-').replace('.000Z', 'Z');
  await writeImmutable(join(outputDirectory, `health-${timestamp}.json`), health);

  process.stdout.write(json({ status: health.status, checkedAt: health.checkedAt, alerts: health.alerts, satcorpsQualified: promotion.qualified }));
  if (health.status !== 'healthy') process.exitCode = 1;
}

await main();
