import type { ActivatedEarthState } from './earth-state.js';

export type HipparcosPayload = { stars: Array<[number, number, number, number]> };

export function isHipparcosPayload(value: unknown): value is HipparcosPayload;

export function validateEarthStateScene<Asset>(
  activeEarthState: ActivatedEarthState<Asset>,
  isTexture: (asset: Asset) => boolean,
  options?: { isSeasonalSurfaceSource?: (asset: Asset) => boolean },
): ActivatedEarthState<Asset>;
