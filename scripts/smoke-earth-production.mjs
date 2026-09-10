import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { EARTH_STATE_ACTIVATION_TIMEOUT_MS } from '../src/earth-state.js';
import { runEarthProductionVisualSmoke } from '../src/production-visual-smoke.js';
import { waitForProductionClient } from '../src/production-client-ready.js';
import { installCaptureFramePacing } from './lib/capture-frame-pacing.mjs';

// The app abandons an activation at EARTH_STATE_ACTIVATION_TIMEOUT_MS and then
// says why. Giving up first would replace that answer with a harness timeout.
const READY_TIMEOUT_MS = EARTH_STATE_ACTIVATION_TIMEOUT_MS + 30_000;

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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options['app-url']) throw new Error('The production smoke check requires --app-url');
  const checkedAtDate = new Date(options.now ?? Date.now());
  if (Number.isNaN(checkedAtDate.valueOf())) throw new Error('Invalid --now value');
  const checkedAt = checkedAtDate.toISOString().replace('.000Z', 'Z');
  const outputDirectory = resolve(options.output ?? 'artifacts/production-health/visual-smoke');
  await mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: options['software-rendering'] === 'true' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
  });
  let report;
  try {
    report = await runEarthProductionVisualSmoke({
      appUrl: options['app-url'],
      checkedAt,
      captureView: async ({ url }) => {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
        // This job captures stills on a GPU-less runner. Continuous full-size
        // software rendering competes with decoding/uploading the live bundle.
        // Keep every pixel and shader, but pace redraws during loading only.
        await page.addInitScript(installCaptureFramePacing, 4);
        const started = Date.now();
        const consoleErrors = [];
        const pageErrors = [];
        page.on('console', message => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', error => pageErrors.push(error.message));
        try {
          let readyError;
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
            // Startup first activates the bundled globe, then the live bundle.
            // Give each phase its own application-sized deadline: subtracting
            // fallback loading time can expire while live activation is healthy.
            await waitForProductionClient(page, READY_TIMEOUT_MS);
          } catch (error) {
            readyError = `Production view did not become ready: ${error.message ?? String(error)}`;
          }
          const readinessMs = Date.now() - started;
          await page.evaluate(() => window.__captureResumeFrames?.());
          await page.waitForTimeout(1_000);
          const diagnostics = await page.evaluate(() => {
            const canvas = document.querySelector('#globe');
            const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
            const extension = gl?.getExtension('WEBGL_debug_renderer_info');
            const fetches = performance.getEntriesByType('resource').filter(entry => entry.initiatorType === 'fetch');
            return {
              renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable',
              width: canvas?.width, height: canvas?.height,
              fetchCount: fetches.length,
              lastFetchCompletedMs: Math.max(0, ...fetches.map(entry => entry.responseEnd)),
            };
          }).catch(error => ({ diagnosticError: error.message }));
          const currentness = await page.locator('#earth-state-summary').evaluate(element => ({
            bundleId: element.getAttribute('data-bundle-id') ?? '',
            runtimeSource: element.getAttribute('data-runtime-source') ?? '',
            refresh: element.getAttribute('data-refresh') ?? '',
            refreshReason: element.getAttribute('data-refresh-reason') ?? undefined,
          })).catch(error => {
            pageErrors.push(`Production currentness marker unavailable: ${error.message ?? String(error)}`);
            return { bundleId: '', runtimeSource: '', refresh: '' };
          });
          // The read above is the authority, not the wait. A view that reached
          // production data was ready; the wait merely stopped watching first,
          // which happens when a publish lands mid-run and the client activates a
          // second bundle. Reporting that as a page error is the same mistake as
          // timing out before the app's own deadline -- it fails a healthy view
          // for the harness's impatience. When the view genuinely did not arrive,
          // the timeout is the only account of why, so it is kept.
          if (readyError && !(currentness.runtimeSource === 'remote' && currentness.refresh === 'current')) {
            pageErrors.push(readyError);
          }
          return {
            ...currentness,
            consoleErrors,
            pageErrors,
            diagnostics: { ...diagnostics, readinessMs, loadingFramesPerSecond: 4, activationBudgetMs: EARTH_STATE_ACTIVATION_TIMEOUT_MS },
            screenshot: await page.screenshot({ type: 'png' }),
          };
        } finally {
          await page.close();
        }
      },
      retainArtifact: (name, bytes) => writeFile(join(outputDirectory, name), bytes),
    });
  } finally {
    await browser.close();
  }
  await writeFile(join(outputDirectory, 'smoke-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

await main();
