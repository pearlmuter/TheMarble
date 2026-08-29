import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLOUD_PROVIDER_SOAK_POLICY_VERSION, evaluateCloudProviderSoak } from '../src/cloud-provider-soak.js';
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

async function readJsonResult(value) {
  try {
    return { value: await readJson(value) };
  } catch (error) {
    return { error: error.message ?? String(error) };
  }
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
    const samples = [];
    const errors = [];
    for (const [index, line] of source.split('\n').entries()) {
      if (line.trim() === '') continue;
      try {
        samples.push(JSON.parse(line));
      } catch (error) {
        errors.push(`line ${index + 1}: ${error.message ?? String(error)}`);
      }
    }
    return { source, samples, errors };
  } catch (error) {
    if (error?.code === 'ENOENT') return { source: '', samples: [], errors: [] };
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
        available: source.available !== false && !metrics.temporalInvalid,
        discoveryLatencyMinutes: Math.max(0, metrics.discoveryLatencyMinutes),
        expectedObservations: source.expectedObservations,
        missingObservations: metrics.missingObservations,
        coverageFraction: metrics.coverageFraction,
        corruptProducts: metrics.corruptProducts,
        schemaDrift: metrics.schemaDrift,
        dimensionsChanged: metrics.dimensionsChanged,
        schemaFingerprint: source.schemaFingerprint,
        dimensions: source.dimensions,
        qualityFlags: metrics.temporalInvalid ? [...metrics.qualityFlags, 'temporal-invalid'] : metrics.qualityFlags,
      }];
    })),
    interSourceDisagreementFraction: snapshot.interSourceDisagreementFraction,
  };
}

function unavailableSnapshot(checkedAt, policy, detail) {
  const provider = name => {
    const missing = policy.health.providers[name].maximumMissingObservations + 1;
    return {
      latestObservationAt: checkedAt,
      discoveredAt: checkedAt,
      expectedObservations: missing,
      missingObservations: missing,
      schemaFingerprint: 'telemetry-unavailable',
      expectedSchemaFingerprint: 'telemetry-unavailable',
      dimensions: { width: 1, height: 1 },
      expectedDimensions: { width: 1, height: 1 },
      corruptProducts: 0,
      coverageFraction: 0,
      qualityFlags: ['telemetry-unavailable'],
      processingDurationMs: 0,
      available: false,
    };
  };
  return {
    checkedAt,
    providers: { satcorps: provider('satcorps'), gmgsi: provider('gmgsi') },
    transformation: { ok: false, durationMs: 0, error: detail },
    compositor: { ok: false, durationMs: 0, error: 'Compositor state unavailable with production snapshot' },
    publication: { outcome: 'unavailable', durationMs: 0, bundleId: 'unavailable' },
    delivery: { latestManifestRetrievedAt: checkedAt, latestManifestAdvancedAt: checkedAt },
    interSourceDisagreementFraction: 1,
  };
}

function normalizeHistorySample(sample) {
  return {
    ...sample,
    ...Object.fromEntries(['satcorps', 'gmgsi'].map(provider => {
      const observation = sample?.[provider] ?? {};
      const hasIdentity = typeof observation.schemaFingerprint === 'string'
        && observation.dimensions && Number.isFinite(observation.dimensions.width) && Number.isFinite(observation.dimensions.height);
      return [provider, {
        ...observation,
        available: observation.available === true || (observation.available !== false && hasIdentity),
      }];
    })),
  };
}

function validateHistorySample(sample) {
  if (Number.isNaN(Date.parse(sample.checkedAt)) || !Number.isFinite(sample.interSourceDisagreementFraction)
    || sample.interSourceDisagreementFraction < 0 || sample.interSourceDisagreementFraction > 1) {
    throw new Error('invalid sample time or inter-source disagreement');
  }
  for (const provider of ['satcorps', 'gmgsi']) {
    const observation = sample[provider];
    if (!observation || typeof observation.available !== 'boolean'
      || !Number.isFinite(observation.discoveryLatencyMinutes) || observation.discoveryLatencyMinutes < 0
      || !Number.isFinite(observation.expectedObservations) || observation.expectedObservations < 1
      || !Number.isFinite(observation.missingObservations) || observation.missingObservations < 0
      || !Number.isFinite(observation.coverageFraction) || observation.coverageFraction < 0 || observation.coverageFraction > 1
      || !Number.isFinite(observation.corruptProducts) || observation.corruptProducts < 0
      || typeof observation.schemaDrift !== 'boolean' || typeof observation.dimensionsChanged !== 'boolean'
      || !Array.isArray(observation.qualityFlags) || observation.qualityFlags.some(flag => typeof flag !== 'string')) {
      throw new Error(`invalid ${provider} observation`);
    }
    if (observation.available && (typeof observation.schemaFingerprint !== 'string' || observation.schemaFingerprint.length === 0
      || !Number.isFinite(observation.dimensions?.width) || observation.dimensions.width < 1
      || !Number.isFinite(observation.dimensions?.height) || observation.dimensions.height < 1)) {
      throw new Error(`invalid ${provider} identity`);
    }
  }
  return sample;
}

function failedPromotion(checkedAt, error) {
  return {
    schemaVersion: 1,
    policyVersion: CLOUD_PROVIDER_SOAK_POLICY_VERSION,
    evaluatedAt: checkedAt,
    qualified: false,
    window: { from: checkedAt, to: checkedAt, durationDays: 0, samples: 0, maximumObservedGapHours: 0, auditSamples: 0 },
    metrics: {},
    thresholds: [],
    error: error.message ?? String(error),
  };
}

function monitoredSnapshot(snapshot, smoke, origin, cdn, checkedAt) {
  return {
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
  };
}

function json(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function writeImmutable(path, document) {
  await writeImmutableBody(path, json(document));
}

async function writeImmutableBody(path, body) {
  try {
    await writeFile(path, body, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST' || await readFile(path, 'utf8') !== body) throw error;
  }
}

async function writeAtomic(path, body) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, body, { flag: 'wx' });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
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
  const historyPath = resolve(options.history);
  const outputDirectory = resolve(options.output);
  await Promise.all([mkdir(dirname(historyPath), { recursive: true }), mkdir(outputDirectory, { recursive: true })]);
  const policy = await readJson(options.policy);
  const [snapshotResult, origin, cdn, smokeResult] = await Promise.all([
    readJsonResult(options.snapshot),
    probeLatest(options['origin-latest']),
    probeLatest(options['cdn-latest']),
    readJsonResult(options['smoke-report']),
  ]);
  let snapshot = snapshotResult.value ?? unavailableSnapshot(checkedAt, policy, snapshotResult.error);
  const smoke = smokeResult.value ?? {
    ok: false,
    bundleId: 'unavailable',
    artifacts: [],
    failures: [`Visual smoke evidence unavailable: ${smokeResult.error}`],
  };

  let health;
  try {
    health = evaluateEarthProductionHealth(monitoredSnapshot(snapshot, smoke, origin, cdn, checkedAt), policy.health);
  } catch (error) {
    snapshot = unavailableSnapshot(checkedAt, policy, `Production snapshot was invalid: ${error.message ?? String(error)}`);
    health = evaluateEarthProductionHealth(monitoredSnapshot(snapshot, smoke, origin, cdn, checkedAt), policy.health);
  }

  await writeFile(join(outputDirectory, 'health.json'), json(health));
  const timestamp = health.checkedAt.replaceAll(':', '-').replace('.000Z', 'Z');
  await writeImmutable(join(outputDirectory, `health-${timestamp}.json`), health);

  let historical = [];
  let historyError;
  let historySource = '';
  try {
    const historyRead = await readHistory(historyPath);
    historySource = historyRead.source;
    const errors = [...historyRead.errors];
    for (const [index, sample] of historyRead.samples.entries()) {
      try {
        historical.push(validateHistorySample(normalizeHistorySample(sample)));
      } catch (error) {
        errors.push(`parsed row ${index + 1}: ${error.message ?? String(error)}`);
      }
    }
    if (errors.length > 0) historyError = new Error(`Malformed soak history: ${errors.join('; ')}`);
  } catch (error) {
    historyError = error;
  }
  if (historyError && historySource !== '') {
    await writeImmutableBody(join(outputDirectory, `soak-history-corrupt-${timestamp}.ndjson`), historySource);
  }
  const history = [...new Map([...historical, createSoakSample(snapshot, health)]
    .map(sample => [sample.checkedAt, sample])).values()]
    .sort((left, right) => Date.parse(left.checkedAt) - Date.parse(right.checkedAt));
  await writeAtomic(historyPath, `${history.map(item => JSON.stringify(item)).join('\n')}\n`);
  let promotion;
  try {
    if (historyError) throw new Error(`Previous soak history was unreadable and has been rotated: ${historyError.message ?? String(historyError)}`);
    promotion = evaluateCloudProviderSoak(history, policy.soak);
  } catch (error) {
    promotion = failedPromotion(checkedAt, error);
  }
  await writeFile(join(outputDirectory, 'satcorps-promotion.json'), json(promotion));

  process.stdout.write(json({ status: health.status, checkedAt: health.checkedAt, alerts: health.alerts, satcorpsQualified: promotion.qualified }));
  if (health.status !== 'healthy' || promotion.error) process.exitCode = 1;
}

await main();
