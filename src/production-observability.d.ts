export type EarthProductionAlertStage =
  | 'upstream-provider-lateness'
  | 'transformation'
  | 'compositor'
  | 'publication'
  | 'delivery'
  | 'client-currentness';

export interface EarthProductionHealthPolicy {
  providers: Record<'satcorps' | 'gmgsi', {
    maximumDiscoveryLatencyMinutes: number;
    maximumMissingObservations: number;
    minimumCoverageFraction: number;
  }>;
  maximumLatestManifestAgeMinutes: number;
}

export interface EarthProductionHealthSnapshot {
  checkedAt: string;
  interSourceDisagreementFraction: number;
  providers: Record<'satcorps' | 'gmgsi', {
    latestObservationAt: string;
    discoveredAt: string;
    expectedObservations: number;
    missingObservations: number;
    schemaFingerprint: string;
    expectedSchemaFingerprint: string;
    dimensions: { width: number; height: number };
    expectedDimensions: { width: number; height: number };
    corruptProducts: number;
    coverageFraction: number;
    qualityFlags: string[];
    processingDurationMs: number;
  }>;
  transformation: { ok: boolean; durationMs: number; error?: string };
  compositor: { ok: boolean; durationMs: number; error?: string };
  publication: { outcome: string; durationMs: number; bundleId: string };
  delivery: {
    originAvailable: boolean; cdnAvailable: boolean; originBundleId: string; cdnBundleId: string;
    latestManifestRetrievedAt: string;
  };
  client: { bundleId: string; visualSmoke: { ok: boolean; artifacts: string[]; error?: string } };
}

export interface EarthProductionHealthReport {
  schemaVersion: 1;
  checkedAt: string;
  status: 'healthy' | 'failing';
  metrics: Record<string, unknown>;
  alerts: Array<{ stage: EarthProductionAlertStage; code: string; detail: string; provider?: 'satcorps' | 'gmgsi' }>;
}

export function evaluateEarthProductionHealth(
  snapshot: EarthProductionHealthSnapshot,
  policy: EarthProductionHealthPolicy,
): EarthProductionHealthReport;
