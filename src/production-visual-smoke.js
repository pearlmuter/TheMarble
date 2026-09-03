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
        // A run that only says `failed` for all three views cannot be diagnosed
        // afterwards, so carry whatever the app recorded about the failure.
        failures.push(`${name} is not current production data${capture.refreshReason ? `: ${capture.refreshReason}` : ''}`);
      }
      if (capture.consoleErrors?.length > 0) failures.push(`${name} emitted console errors: ${capture.consoleErrors.join('; ')}`);
      if (capture.pageErrors?.length > 0) failures.push(`${name} emitted page errors: ${capture.pageErrors.join('; ')}`);
      if (typeof capture.bundleId !== 'string' || capture.bundleId.length === 0) failures.push(`${name} did not expose an active bundle`);
    } catch (error) {
      failures.push(`${name} capture failed: ${error.message ?? String(error)}`);
    }
  }

  // The views load one after another and the publisher advances every ten
  // minutes, so a run straddling a publish legitimately sees two bundles. That
  // is the feed working. What matters is that every view reached production
  // data, which is checked per view above; the last bundle observed is the
  // freshest thing the client was seen on.
  const bundleIds = captures.map(capture => capture.bundleId).filter(Boolean);
  if (captures.length !== FIXED_VIEWS.length) failures.push('Not every fixed visual smoke view produced a diagnostic artifact');

  return {
    schemaVersion: 1,
    checkedAt: new Date(checkedAtMilliseconds).toISOString().replace('.000Z', 'Z'),
    ok: failures.length === 0,
    bundleId: bundleIds.at(-1),
    bundleIds: [...new Set(bundleIds)],
    artifacts,
    failures,
    views: captures.map(({ name, bundleId, runtimeSource, refresh, refreshReason, consoleErrors, pageErrors }) => ({
      name,
      bundleId,
      runtimeSource,
      refresh,
      refreshReason,
      consoleErrors: consoleErrors ?? [],
      pageErrors: pageErrors ?? [],
    })),
  };
}
