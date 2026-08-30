import type { CryosphereCandidate, CryosphereProduct, DailyCryosphereSelection } from './cryosphere-selection.js';

export interface CryosphereAdapterProduct {
  product: CryosphereProduct;
  validAt: string;
  producedAt: string;
  version: string;
  arrayPath: string;
  qualityArrayPath?: string;
  coverage: { latitudeRange: [number, number]; observedFraction: number };
  attribution?: string;
}

export interface CryosphereCatalog {
  schemaVersion: 1;
  retrievedAt: string;
  candidates: CryosphereCandidate[];
  excluded: { product: CryosphereProduct; validAt: string; reason: string }[];
  selection: DailyCryosphereSelection;
  contingency?: 'amsr2';
  contingencyReason?: string;
}

export function buildCryosphereCatalog(options: {
  products: CryosphereAdapterProduct[];
  retrievedAt: string;
}): CryosphereCatalog;
