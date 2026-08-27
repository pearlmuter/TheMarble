import type { RollingSurfaceProduct } from './rolling-surface-products.js';
export type { RollingSurfaceProduct } from './rolling-surface-products.js';

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
  previousObservationWindows?: Array<Pick<RollingSurfaceCandidate, 'product' | 'version' | 'validAt' | 'observedFrom' | 'observedTo'>>;
  candidates: RollingSurfaceCandidate[];
  maxCandidateAgeDays?: number;
  minAcceptedFraction?: number;
}): RollingSurfaceCandidate[];
