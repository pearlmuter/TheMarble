export interface CloudGapThresholds {
  maxObservationAgeSeconds: number;
  minObservationQuality: number;
  seamBlendPixels: number;
}

export interface PolarCloudCandidate {
  product: 'viirs-cloud' | 'modis-cloud';
  validAt: string;
  observedFrom: string;
  observedTo: string;
  producedAt: string;
  version: string;
  href: string;
  coverage: { observedFraction: number; latitudeRange: [number, number] };
  byteLength?: number;
  checksum?: { algorithm: 'sha256'; value: string };
}

export interface GfsCloudCandidate {
  product: 'gfs-total-cloud';
  runAt: string;
  forecastHour: number;
  validAt: string;
  producedAt: string;
  version: string;
  href: string;
  coverage: { observedFraction: number; latitudeRange: [number, number] };
  byteLength?: number;
  checksum?: { algorithm: 'sha256'; value: string };
}

export interface CloudGapSelection {
  targetValidAt: string;
  retrievedAt: string;
  polarObservation?: PolarCloudCandidate;
  model?: GfsCloudCandidate;
  thresholds: CloudGapThresholds;
}

export function selectCloudGapSources(options: {
  candidates: Array<PolarCloudCandidate | GfsCloudCandidate>;
  targetValidAt: string;
  retrievedAt: string;
  thresholds: CloudGapThresholds;
}): CloudGapSelection;
