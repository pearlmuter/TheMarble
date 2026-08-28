import type { ActivatedEarthState, EarthStateActivator } from './earth-state.js';

export interface EarthStateCacheStorage {
  get(key: string): Promise<unknown | undefined>;
  commit(changes: {
    writes: Array<{ key: string; value: unknown }>;
    deletes: string[];
  }): Promise<void>;
}

export interface EarthStateCacheEntry {
  url: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface EarthStateBundleSnapshot {
  bundleId: string;
  validAt: string;
  latestUrl: string;
  entrypointKind?: 'latest' | 'manifest';
  entries: EarthStateCacheEntry[];
}

export interface EarthStateCacheCandidate {
  bundleId: string;
  validAt: string;
  latestUrl: string;
  entrypointKind: 'latest' | 'manifest';
  read(url: string): EarthStateCacheEntry;
}

export interface EarthStateBundleCache {
  remember(bundle: EarthStateBundleSnapshot): Promise<void>;
  bundleIds(): Promise<string[]>;
  restoreNewest<Result>(activate: (candidate: EarthStateCacheCandidate) => Promise<Result>): Promise<Result | undefined>;
}

export function activateEarthStateCacheCandidate<LoadedAsset>(
  activator: EarthStateActivator<LoadedAsset>,
  candidate: EarthStateCacheCandidate,
): Promise<ActivatedEarthState<LoadedAsset>>;

export function createEarthStateBundleCache(options: {
  storage: EarthStateCacheStorage;
  maxRemoteBundles?: number;
  maxBytes?: number;
}): EarthStateBundleCache;

export function activateEarthStateAtStartup<Result>(options: {
  cache?: EarthStateBundleCache;
  activateCached(candidate: EarthStateCacheCandidate): Promise<Result>;
  activateBundled(): Promise<Result>;
}): Promise<Result>;
