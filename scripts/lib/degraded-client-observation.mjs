import { EARTH_STATE_ACTIVATION_TIMEOUT_MS } from '../../src/earth-state.js';
import { waitForProductionClient } from '../../src/production-client-ready.js';
import { installCaptureFramePacing } from './capture-frame-pacing.mjs';

export async function observeDegradedClient(page, { appUrl, latestUrl }) {
  try {
    // This separate browser needs the same loading budget and pacing as the
    // screenshot browser. Neither setting changes the deployed application.
    await page.addInitScript(installCaptureFramePacing, 4);
    // A corrupt latest response must leave the previously verified globe visible.
    await page.route(url => url.href.startsWith(latestUrl.replace(/latest\.json$/, 'latest')), route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"schemaVersion":1,"bundleId":"corrupt"',
    }));
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await waitForProductionClient(page, EARTH_STATE_ACTIVATION_TIMEOUT_MS + 30_000);
    return await page.locator('#earth-state-summary').evaluate(element => ({
      bundleId: element.getAttribute('data-bundle-id') ?? '',
      runtimeSource: element.getAttribute('data-runtime-source') ?? '',
      refresh: element.getAttribute('data-refresh') ?? '',
    }));
  } catch (error) {
    // Preserve a failing observation so the caller can write the delivery report
    // instead of losing all diagnostics to an uncaught browser timeout.
    return { bundleId: '', runtimeSource: '', refresh: 'failed', error: error.message ?? String(error) };
  }
}
