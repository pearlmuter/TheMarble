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
  for (const name of ['readLatest', 'verifyBundle', 'restartCompositor', 'retryPublication', 'quarantineCandidate', 'restoreDelivery', 'replaceLatest']) {
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

      let latest = await adapters.readLatest();
      const latestVerified = await adapters.verifyBundle(latest).catch(() => false);
      if (actionError || !latestVerified) {
        await adapters.replaceLatest(lastKnownGood.latestDocument);
        latest = await adapters.readLatest();
        if (!await adapters.verifyBundle(latest) || latest.bundleId !== lastKnownGood.bundleId) {
          throw new AggregateError(actionError ? [actionError] : [], 'Production rollback could not restore the verified last-known-good Earth');
        }
      }

      const retained = latest.bundleId === lastKnownGood.bundleId;
      return {
        outcome: incident.kind === 'rollback'
          ? 'rolled-back'
          : retained ? 'retained-last-known-good' : 'recovered',
        activeBundleId: latest.bundleId,
        incident: incident.kind,
        ...(actionError ? { recoveryError: actionError.message ?? String(actionError) } : {}),
      };
    },
  };
}
