import type { EarthStateLoadedBytes, EarthStateManifest } from './earth-state.js';
import type { EarthStatePresentationIndex, EarthStatePresentationTierId } from './earth-state-presentation.js';
import type { EarthStatePublicationStore } from './earth-state-publication.js';

export function createEarthStatePresentationPublisher(adapters: {
  loadSource(url: string): Promise<EarthStateLoadedBytes | undefined>;
  store: EarthStatePublicationStore;
  transcodeTexture(request: {
    bytes: Uint8Array;
    mediaType: string;
    width?: number;
    height?: number;
    tierId: EarthStatePresentationTierId;
    path: string;
    colorSpace?: string;
  }): Promise<{ bytes: Uint8Array; width: number; height: number }>;
  tiers?: Array<{
    id: EarthStatePresentationTierId; width: number; height: number;
    timeToFirstCoherentGlobeMs: number; shaderCompilationMs: number; minimumSustainedFps: number;
  }>;
}): {
  publish(request: { sourceManifestUrl: string }): Promise<{
    indexPath: string;
    index: EarthStatePresentationIndex;
    manifests: Record<EarthStatePresentationTierId, EarthStateManifest>;
  }>;
};
