export const CLOUD_PROVIDER_SOAK_POLICY_VERSION: 'themarble-cloud-soak-v1';

export interface CloudProviderSoakSample {
  checkedAt: string;
  satcorps: CloudProviderSoakObservation;
  gmgsi: CloudProviderSoakObservation;
  interSourceDisagreementFraction: number;
}

export interface CloudProviderSoakObservation {
  available: boolean;
  discoveryLatencyMinutes: number;
  expectedObservations: number;
  missingObservations: number;
  coverageFraction: number;
  corruptProducts: number;
  schemaDrift: boolean;
  dimensionsChanged: boolean;
  schemaFingerprint: string;
  dimensions: { width: number; height: number };
  qualityFlags: string[];
}

export interface CloudProviderSoakPolicy {
  version: 'themarble-cloud-soak-v1';
  minimumDurationDays: number;
  minimumSamples: number;
  maximumSampleGapHours: number;
  maximumEvaluationWindowDays: number;
  maximumP95DiscoveryLatencyMinutes: number;
  maximumMissingFraction: number;
  minimumMeanCoverageFraction: number;
  maximumCorruptFraction: number;
  maximumSchemaChanges: number;
  maximumDimensionChanges: number;
  maximumQualityFlagFraction: number;
  maximumP95InterSourceDisagreementFraction: number;
}

export interface CloudProviderPromotionReport {
  schemaVersion: 1;
  policyVersion: 'themarble-cloud-soak-v1';
  evaluatedAt: string;
  qualified: boolean;
  window: {
    from: string; to: string; durationDays: number; samples: number; maximumObservedGapHours: number;
    auditSamples: number; resetReason?: 'provider-unavailable' | 'provider-recovered' | 'sample-gap' | 'schema-or-dimension-change';
  };
  metrics: Record<string, unknown>;
  thresholds: Array<{ id: string; actual: number; passed: boolean; minimum?: number; maximum?: number }>;
}

export function evaluateCloudProviderSoak(
  samples: CloudProviderSoakSample[],
  policy: CloudProviderSoakPolicy,
): CloudProviderPromotionReport;

export function cloudProviderPromotionIsCurrent(
  report: unknown,
  options: { now: string; maximumAgeHours: number; policy: CloudProviderSoakPolicy; samples: CloudProviderSoakSample[] },
): report is CloudProviderPromotionReport;
