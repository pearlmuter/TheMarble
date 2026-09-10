import { readFile } from 'node:fs/promises';

// Let Vite serve code and the actual bundled assets, but make every live feed
// unavailable immediately. A 404 does not enter the transport retry backoff.
export async function installBundledEarthFixture(page, baseUrl) {
  const manifestUrl = new URL('/earth-state/bundled-v1.json', baseUrl).href;
  const assets = new Set([manifestUrl]);
  const manifest = JSON.parse(await readFile(new URL('../../public/earth-state/bundled-v1.json', import.meta.url), 'utf8'));
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.href === 'string') assets.add(new URL(value.href, manifestUrl).href);
    for (const child of Object.values(value)) collect(child);
  }
  collect(manifest);
  await page.route(/^https?:\/\//, route => {
    const request = route.request();
    const sameOrigin = new URL(request.url()).origin === new URL(baseUrl).origin;
    if (sameOrigin && (request.resourceType() !== 'fetch' || assets.has(request.url()))) return route.continue();
    return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });
}

export async function waitForBundledEarth(page) {
  await page.waitForSelector('#loading[aria-hidden="true"]', { timeout: 180000 });
  await page.waitForSelector('#earth-state-summary[data-runtime-source="bundled-fallback"][data-refresh="failed"]', { state: 'attached', timeout: 30000 });
}
