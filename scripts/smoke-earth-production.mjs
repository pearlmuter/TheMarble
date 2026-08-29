import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { runEarthProductionVisualSmoke } from '../src/production-visual-smoke.js';

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
  const browser = await chromium.launch({ headless: true });
  let report;
  try {
    report = await runEarthProductionVisualSmoke({
      appUrl: options['app-url'],
      checkedAt,
      captureView: async ({ url }) => {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
        const consoleErrors = [];
        const pageErrors = [];
        page.on('console', message => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('pageerror', error => pageErrors.push(error.message));
        try {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
            await page.waitForSelector('#loading[aria-hidden="true"]', { timeout: 120_000 });
            await page.waitForFunction(() => {
              const refresh = document.querySelector('#earth-state-summary')?.getAttribute('data-refresh');
              return refresh === 'current' || refresh === 'failed';
            }, undefined, { timeout: 120_000 });
            await page.waitForTimeout(1_000);
          } catch (error) {
            pageErrors.push(`Production view did not become ready: ${error.message ?? String(error)}`);
          }
          const currentness = await page.locator('#earth-state-summary').evaluate(element => ({
            bundleId: element.getAttribute('data-bundle-id') ?? '',
            runtimeSource: element.getAttribute('data-runtime-source') ?? '',
            refresh: element.getAttribute('data-refresh') ?? '',
          })).catch(error => {
            pageErrors.push(`Production currentness marker unavailable: ${error.message ?? String(error)}`);
            return { bundleId: '', runtimeSource: '', refresh: '' };
          });
          return {
            ...currentness,
            consoleErrors,
            pageErrors,
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
