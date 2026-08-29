export interface CloudProviderSoakSample {
  checkedAt: string;
  satcorps: CloudProviderSoakObservation;
  gmgsi: CloudProviderSoakObservation;
  interSourceDisagreementFraction: number;
}

export interface CloudProviderSoakObservation {
  discoveryLatencyMinutes: number;
  expectedObservations: number;
  missingObservations: number;
  coverageFraction: number;
  corruptProducts: number;
  schemaDrift: boolean;
  dimensionsChanged: boolean;
  qualityFlags: string[];
}

export interface CloudProviderSoakPolicy {
  minimumDurationDays: number;
  minimumSamples: number;
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
  evaluatedAt: string;
  qualified: boolean;
  window: { from: string; to: string; durationDays: number; samples: number };
  metrics: Record<string, unknown>;
  thresholds: Array<{ id: string; actual: number; passed: boolean; minimum?: number; maximum?: number }>;
}

export function evaluateCloudProviderSoak(
  samples: CloudProviderSoakSample[],
  policy: CloudProviderSoakPolicy,
): CloudProviderPromotionReport;

export function cloudProviderPromotionIsCurrent(
  report: unknown,
  options: { now: string; maximumAgeHours: number },
): report is CloudProviderPromotionReport;
