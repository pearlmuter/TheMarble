export type CryosphereProduct = 'ims-snow-ice' | 'gmasi-snow' | 'gmasi-sea-ice' | 'amsr2-snow' | 'amsr2-sea-ice' | 'viirs-snow';

export interface CryosphereCandidate {
  product: CryosphereProduct;
  validAt: string;
  producedAt: string;
  version: string;
  href: string;
  coverage: { latitudeRange: [number, number]; observedFraction: number };
  qualityHref?: string;
  attribution?: string;
}

export interface DailyCryosphereSelection {
  validAt: string;
  retrievedAt: string;
  analysis: {
    northernPrimary?: CryosphereCandidate;
    globalFallback: { snow: CryosphereCandidate; seaIce: CryosphereCandidate };
  };
  refinement?: CryosphereCandidate;
  fallback: { ims: boolean; reason?: string };
  publish: boolean;
}

export function selectDailyCryosphere(options: {
  candidates: CryosphereCandidate[];
  retrievedAt: string;
  lastPublishedValidAt?: string;
}): DailyCryosphereSelection;
