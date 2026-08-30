import type { EarthStateManifest } from './earth-state.js';

export interface EarthStateFeedDegradedObservation {
  runtimeSource?: string;
  refresh?: string;
  bundleId?: string;
}

export interface EarthStateFeedAcceptancePolicy {
  minimumCloudObservedFraction: number;
  maximumCryosphereAgeDays: number;
}

export declare const DEFAULT_EARTH_STATE_ACCEPTANCE_POLICY: Readonly<EarthStateFeedAcceptancePolicy>;

export interface EarthStateFeedAcceptanceReport {
  schemaVersion: 1;
  checkedAt: string;
  policy: EarthStateFeedAcceptancePolicy;
  bundleId: string;
  classification?: string;
  ok: boolean;
  clouds?: {
    provider?: string;
    hours: string[];
    validAt: string;
    observedFrom: string;
    observedTo: string;
    ageMinutes: number;
    observedFraction?: number;
    modelAssistedFraction?: number;
  };
  cryosphere?: { validAt: string; ageDays: number; sourceVersion: string; observedFraction?: number };
  degraded?: EarthStateFeedDegradedObservation;
  failures: string[];
}

export function evaluateEarthStateFeedAcceptance(options: {
  manifest: EarthStateManifest;
  checkedAt: string;
  degraded?: EarthStateFeedDegradedObservation;
  policy?: Partial<EarthStateFeedAcceptancePolicy>;
}): EarthStateFeedAcceptanceReport;
