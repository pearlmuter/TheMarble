import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { evaluateEarthStateDelivery } from '../src/earth-state-delivery.js';
import { evaluateEarthStateFeedAcceptance } from '../src/earth-state-feed-acceptance.js';
import { representativeEarthStateAssetHref } from '../src/earth-state-feed-orchestration.js';

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

async function probe(url, origin) {
  const response = await fetch(url, {
    redirect: 'follow',
    // Object stores return the cross-origin headers only when asked as a browser asks.
    headers: origin ? { origin } : {},
    signal: AbortSignal.timeout(60_000),
  });
  const headers = Object.fromEntries([...response.headers.entries()]);
  const body = response.ok && (headers['content-type'] ?? '').includes('json') ? await response.json() : undefined;
  return { probe: { url, status: response.status, headers }, body };
}

async function degradedObservation(appUrl, latestUrl) {
  // Imported here so the scheduled publication jobs, which never pass --app-url,
  // do not need a browser installed to verify delivery.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // A corrupt latest response must leave the previously verified globe visible.
    await page.route(url => url.href.startsWith(latestUrl.replace(/latest\.json$/, 'latest')), route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"schemaVersion":1,"bundleId":"corrupt"',
    }));
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForSelector('#loading[aria-hidden="true"]', { timeout: 120_000 });
    await page.waitForFunction(() => {
      const refresh = document.querySelector('#earth-state-summary')?.getAttribute('data-refresh');
      return refresh === 'current' || refresh === 'failed';
    }, undefined, { timeout: 120_000 });
    return await page.locator('#earth-state-summary').evaluate(element => ({
      bundleId: element.getAttribute('data-bundle-id') ?? '',
      runtimeSource: element.getAttribute('data-runtime-source') ?? '',
      refresh: element.getAttribute('data-refresh') ?? '',
    }));
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.origin) throw new Error('The feed verification requires --origin');
  const origin = options.origin.endsWith('/') ? options.origin : `${options.origin}/`;
  const clientOrigins = (options['client-origins'] ?? 'https://themarble.test,tauri://localhost').split(',').map(entry => entry.trim());
  const checkedAt = new Date(options.now ?? Date.now()).toISOString().replace('.000Z', 'Z');

  const latestUrl = new URL('latest.json', origin).href;
  const latest = await probe(latestUrl, clientOrigins[0]);
  const probes = [latest.probe];
  let manifest;
  if (latest.body?.manifest?.href) {
    const manifestUrl = new URL(latest.body.manifest.href.replace(/^\.\//, ''), origin).href;
    const manifestProbe = await probe(manifestUrl, clientOrigins[0]);
    probes.push(manifestProbe.probe);
    manifest = manifestProbe.body;
    const assetHref = manifest ? representativeEarthStateAssetHref(manifest) : undefined;
    if (assetHref) probes.push((await probe(new URL(assetHref, manifestUrl).href, clientOrigins[0])).probe);
  }

  const delivery = evaluateEarthStateDelivery({ origin, clientOrigins, probes, checkedAt });
  const policy = options.policy
    ? JSON.parse(await readFile(options.policy, 'utf8')).acceptance
    : undefined;
  const acceptance = manifest
    ? evaluateEarthStateFeedAcceptance({
      manifest,
      checkedAt,
      policy,
      degraded: options['app-url'] ? await degradedObservation(options['app-url'], latestUrl) : undefined,
    })
    : { ok: false, failures: ['The origin did not serve a decodable Earth-state manifest'] };

  const report = {
    schemaVersion: 1,
    checkedAt,
    origin,
    ok: delivery.ok && acceptance.ok,
    delivery,
    acceptance,
  };
  if (options.report) {
    await mkdir(dirname(resolve(options.report)), { recursive: true });
    await writeFile(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

await main();
