const INCIDENTS = new Set([
  'provider-outage',
  'stale-latest',
  'compositor-crash',
  'corrupt-output',
  'publication-interruption',
  'cdn-failure',
  'rollback',
]);

function requireAdapter(adapters, name) {
  if (typeof adapters?.[name] !== 'function') throw new Error(`Invalid production recovery adapter: ${name}`);
}

export function createEarthProductionRecoveryController(adapters) {
  for (const name of ['readLatest', 'verifyBundle', 'verifyDelivery', 'restartCompositor', 'retryPublication', 'quarantineCandidate', 'restoreDelivery', 'replaceLatest']) {
    requireAdapter(adapters, name);
  }

  return {
    async recover(incident, lastKnownGood) {
      if (!INCIDENTS.has(incident?.kind)) throw new Error('Invalid production recovery incident');
      if (!lastKnownGood || typeof lastKnownGood.bundleId !== 'string' || lastKnownGood.bundleId.length === 0
        || lastKnownGood.latestDocument?.bundleId !== lastKnownGood.bundleId) {
        throw new Error('Invalid production recovery last-known-good record');
      }
      if (!await adapters.verifyBundle(lastKnownGood.latestDocument)) {
        throw new Error('Last-known-good Earth bundle failed verification');
      }

      let actionError;
      try {
        if (incident.kind === 'stale-latest' || incident.kind === 'publication-interruption') {
          await adapters.retryPublication(lastKnownGood.bundleId);
        } else if (incident.kind === 'compositor-crash') {
          await adapters.restartCompositor();
          await adapters.retryPublication(lastKnownGood.bundleId);
        } else if (incident.kind === 'corrupt-output') {
          if (typeof incident.candidateBundleId !== 'string' || incident.candidateBundleId.length === 0) {
            throw new Error('Corrupt output recovery requires candidateBundleId');
          }
          await adapters.quarantineCandidate(incident.candidateBundleId);
        } else if (incident.kind === 'cdn-failure') {
          await adapters.restoreDelivery(lastKnownGood.bundleId);
        } else if (incident.kind === 'rollback') {
          await adapters.replaceLatest(lastKnownGood.latestDocument);
        }
      } catch (error) {
        actionError = error;
      }

      let latest;
      let inspectionError;
      let latestVerified = false;
      try {
        latest = await adapters.readLatest();
        latestVerified = await adapters.verifyBundle(latest);
      } catch (error) {
        inspectionError = error;
      }
      let deliveryVerified = latest
        ? await adapters.verifyDelivery(latest.bundleId).catch(() => false)
        : false;
      const exactLastKnownGoodRequired = incident.kind === 'rollback' || incident.kind === 'cdn-failure';
      const exactLastKnownGoodMissing = exactLastKnownGoodRequired && latest?.bundleId !== lastKnownGood.bundleId;
      if (actionError || inspectionError || !latestVerified || !deliveryVerified || exactLastKnownGoodMissing) {
        await adapters.replaceLatest(lastKnownGood.latestDocument);
        await adapters.restoreDelivery(lastKnownGood.bundleId);
        try {
          latest = await adapters.readLatest();
          latestVerified = await adapters.verifyBundle(latest);
          deliveryVerified = await adapters.verifyDelivery(lastKnownGood.bundleId);
        } catch (error) {
          inspectionError = error;
          latestVerified = false;
        }
        if (!latestVerified || latest.bundleId !== lastKnownGood.bundleId || !deliveryVerified) {
          throw new AggregateError([actionError, inspectionError].filter(Boolean), 'Production recovery could not restore verified last-known-good publication and delivery');
        }
      }

      const retained = latest.bundleId === lastKnownGood.bundleId;
      return {
        outcome: incident.kind === 'rollback'
          ? 'rolled-back'
          : retained ? 'retained-last-known-good' : 'recovered',
        activeBundleId: latest.bundleId,
        incident: incident.kind,
        ...(actionError || inspectionError ? { recoveryError: (actionError ?? inspectionError).message ?? String(actionError ?? inspectionError) } : {}),
      };
    },
  };
}
