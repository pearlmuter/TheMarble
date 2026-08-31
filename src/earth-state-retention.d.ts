export interface EarthStateStoredBundle {
  bundleId: string;
  path: string;
  publishedAt: string;
  assetHrefs: string[];
}

export interface EarthStateRetentionPlan {
  retainBundles: EarthStateStoredBundle[];
  removeBundles: EarthStateStoredBundle[];
  retainAssets: string[];
  removeAssets: string[];
  reclaimedBytes: number;
}

export function planEarthStateRetention(options: {
  bundles: EarthStateStoredBundle[];
  assetPaths: string[];
  assetSizes?: Record<string, number>;
  currentBundleId: string;
  now: string;
  keepDays?: number;
  minimumBundles?: number;
}): EarthStateRetentionPlan;
