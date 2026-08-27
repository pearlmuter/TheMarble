export type RollingSurfaceProduct = 'mcd43a4-nbar' | 'viirs-surface-reflectance';

export interface RollingSurfaceCandidate {
  product: RollingSurfaceProduct;
  version: string;
  href: string;
  validAt: string;
  observedFrom: string;
  observedTo: string;
  producedAt: string;
  coverage: { observedFraction: number };
  quality: { acceptedFraction: number };
  byteLength?: number;
  checksum?: { algorithm: 'sha256'; value: string };
}

export function selectRollingSurfaceObservations(options: {
  targetTime: string | Date;
  previousValidAt?: string;
  candidates: RollingSurfaceCandidate[];
  maxCandidateAgeDays?: number;
  minAcceptedFraction?: number;
}): RollingSurfaceCandidate[];
