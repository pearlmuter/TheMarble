const FIXED_VIEWS = ['day', 'terminator', 'night'];

export async function runEarthProductionVisualSmoke({ appUrl, checkedAt, captureView, retainArtifact }) {
  if (typeof captureView !== 'function' || typeof retainArtifact !== 'function') {
    throw new Error('Invalid Earth production visual smoke adapters');
  }
  const checkedAtMilliseconds = Date.parse(checkedAt);
  if (Number.isNaN(checkedAtMilliseconds)) throw new Error('Invalid Earth production visual smoke checkedAt');
  const baseUrl = new URL(appUrl);
  const artifacts = [];
  const captures = [];
  const failures = [];

  for (const name of FIXED_VIEWS) {
    const url = new URL(baseUrl);
    url.searchParams.set('time', new Date(checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'));
    url.searchParams.set('view', name);
    const artifact = `${name}.png`;
    try {
      const capture = await captureView({ name, url: url.href });
      if (!(capture?.screenshot instanceof Uint8Array) || capture.screenshot.byteLength === 0) {
        throw new Error(`${name} did not produce a screenshot`);
      }
      await retainArtifact(artifact, capture.screenshot);
      artifacts.push(artifact);
      captures.push({ name, ...capture });
      if (capture.runtimeSource !== 'remote' || capture.refresh !== 'current') {
        failures.push(`${name} is not current production data`);
      }
      if (capture.consoleErrors?.length > 0) failures.push(`${name} emitted console errors: ${capture.consoleErrors.join('; ')}`);
      if (capture.pageErrors?.length > 0) failures.push(`${name} emitted page errors: ${capture.pageErrors.join('; ')}`);
      if (typeof capture.bundleId !== 'string' || capture.bundleId.length === 0) failures.push(`${name} did not expose an active bundle`);
    } catch (error) {
      failures.push(`${name} capture failed: ${error.message ?? String(error)}`);
    }
  }

  const bundleIds = new Set(captures.map(capture => capture.bundleId).filter(Boolean));
  if (bundleIds.size > 1) failures.push('Fixed visual smoke views rendered different bundles');
  if (captures.length !== FIXED_VIEWS.length) failures.push('Not every fixed visual smoke view produced a diagnostic artifact');

  return {
    schemaVersion: 1,
    checkedAt: new Date(checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'),
    ok: failures.length === 0,
    bundleId: bundleIds.size === 1 ? [...bundleIds][0] : undefined,
    artifacts,
    failures,
    views: captures.map(({ name, bundleId, runtimeSource, refresh, consoleErrors, pageErrors }) => ({
      name,
      bundleId,
      runtimeSource,
      refresh,
      consoleErrors: consoleErrors ?? [],
      pageErrors: pageErrors ?? [],
    })),
  };
}
