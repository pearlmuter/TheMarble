import type { EarthStateLoadedBytes, EarthStateManifest } from './earth-state.js';

export interface EarthStatePublicationStore {
  writeImmutable(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  replaceLatest(path: string, bytes: Uint8Array): Promise<void>;
}

export interface EarthStatePublication {
  manifestPath: string;
  manifest: EarthStateManifest;
  latest: {
    schemaVersion: 1;
    bundleId: string;
    manifest: EarthStateManifest['layers']['surfaceAlbedo']['asset'];
  };
}

export function createEarthStatePublisher(adapters: {
  loadSource(url: string): Promise<EarthStateLoadedBytes>;
  store: EarthStatePublicationStore;
}): {
  publish(request: { targetTime: string; sourceManifestUrl: string }): Promise<EarthStatePublication>;
};
