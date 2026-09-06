// The packaged globe and the remote state are sequential startup phases.
export async function waitForProductionClient(page, timeoutMs) {
  await page.waitForSelector('#loading[aria-hidden="true"]', { timeout: timeoutMs });
  await page.waitForFunction(() => {
    const refresh = document.querySelector('#earth-state-summary')?.getAttribute('data-refresh');
    return refresh === 'current' || refresh === 'failed';
  }, undefined, { timeout: timeoutMs });
}
