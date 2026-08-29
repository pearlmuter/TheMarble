export type EarthProductionIncident =
  | { kind: 'provider-outage' }
  | { kind: 'stale-latest' }
  | { kind: 'compositor-crash' }
  | { kind: 'corrupt-output'; candidateBundleId: string }
  | { kind: 'publication-interruption' }
  | { kind: 'cdn-failure' }
  | { kind: 'rollback' };

export interface LastKnownGoodEarthPublication {
  bundleId: string;
  latestDocument: { bundleId: string; [key: string]: unknown };
}

export function createEarthProductionRecoveryController(adapters: {
  readLatest(): Promise<{ bundleId: string; [key: string]: unknown }>;
  verifyBundle(document: { bundleId: string; [key: string]: unknown }): Promise<boolean>;
  restartCompositor(): Promise<void>;
  retryPublication(baseBundleId: string): Promise<void>;
  quarantineCandidate(bundleId: string): Promise<void>;
  restoreDelivery(bundleId: string): Promise<void>;
  replaceLatest(document: { bundleId: string; [key: string]: unknown }): Promise<void>;
}): {
  recover(incident: EarthProductionIncident, lastKnownGood: LastKnownGoodEarthPublication): Promise<{
    outcome: 'recovered' | 'retained-last-known-good' | 'rolled-back';
    activeBundleId: string;
    incident: EarthProductionIncident['kind'];
    recoveryError?: string;
  }>;
};
