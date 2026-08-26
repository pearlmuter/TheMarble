import type { EarthStateManifest } from './earth-state.js';

export function rebaseEarthStateSourceAssets(
  manifest: EarthStateManifest,
  options: { sourceManifestUrl: string; publicRootUrl: string },
): { manifest: EarthStateManifest; sourceUrls: Set<string> };
