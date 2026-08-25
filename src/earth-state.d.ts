export type EarthStateClassification = 'static-fallback' | 'observed' | 'model-assisted';

export const EARTH_STATE_REQUIRED_LAYERS: readonly string[];
export const EARTH_STATE_REQUIRED_RESOURCES: readonly string[];

export interface EarthStateChecksum {
  algorithm: 'sha256';
  value: string;
}

export interface EarthStateAssetReference {
  href: string;
  mediaType: string;
  byteLength: number;
  immutable: true;
  checksum: EarthStateChecksum;
}

export interface EarthStateDataset {
  id: string;
  version: string;
  attribution: string;
  observedFrom?: string;
  observedTo?: string;
}

export interface EarthStateLayer {
  datasetId: string;
  units: string;
  dimensions: { width: number; height: number };
  colorSpace: string;
  channels: Record<string, string>;
  textureSemantics: { mapping: string; sampling: string };
  asset: EarthStateAssetReference;
}

export interface EarthStateResource {
  datasetId: string;
  semantics: string;
  asset: EarthStateAssetReference;
  dimensions?: { width: number; height: number };
  colorSpace?: string;
}

export interface EarthStateManifest {
  schemaVersion: 1;
  bundleId: string;
  classification: EarthStateClassification;
  geographicConvention: {
    crs: 'EPSG:4326';
    projection: 'equirectangular';
    longitudeRange: [-180, 180];
    latitudeRange: [-90, 90];
    northAtTop: true;
    seamLongitude: -180;
  };
  times: {
    observedFrom: string;
    observedTo: string;
    validAt: string;
    producedAt: string;
    retrievedAt: string;
  };
  datasets: EarthStateDataset[];
  layers: Record<string, EarthStateLayer>;
  resources: Record<string, EarthStateResource>;
}

export interface EarthStateAssetRequest {
  name: string;
  role: 'layer' | 'resource';
  descriptor: EarthStateLayer | EarthStateResource;
  url: string;
}

export interface ActivatedEarthState<LoadedAsset> {
  manifest: EarthStateManifest;
  layers: Record<string, LoadedAsset>;
  resources: Record<string, LoadedAsset>;
  layerDatasets: Record<string, EarthStateDataset>;
}

export interface EarthStateActivator<LoadedAsset> {
  readonly current: ActivatedEarthState<LoadedAsset> | undefined;
  activate(manifestUrl: string): Promise<ActivatedEarthState<LoadedAsset>>;
}

export function createEarthStateActivator<LoadedAsset>(adapters: {
  loadManifest(manifestUrl: string): Promise<unknown>;
  loadAsset(request: EarthStateAssetRequest): Promise<{ value: LoadedAsset; bytes: Uint8Array }>;
}): EarthStateActivator<LoadedAsset>;
