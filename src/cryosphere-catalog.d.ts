import type { CryosphereCandidate, CryosphereProduct, DailyCryosphereSelection } from './cryosphere-selection.js';

export declare const CRYOSPHERE_ATTRIBUTION: Readonly<Record<CryosphereProduct, string>>;

export interface CryosphereAdapterProduct {
  product: CryosphereProduct;
  key?: string;
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

export function newestObservedCryosphereDays(products: CryosphereAdapterProduct[]): {
  products: CryosphereAdapterProduct[];
  excluded: { product: CryosphereProduct; validAt: string; reason: string }[];
};

export function buildCryosphereCatalog(options: {
  products: CryosphereAdapterProduct[];
  retrievedAt: string;
}): CryosphereCatalog;

export function configuredEndpoint(override: string | undefined, configured: string | null | undefined): string | undefined;
