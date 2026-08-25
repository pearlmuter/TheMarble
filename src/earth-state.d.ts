export type EarthStateClassification = 'static-fallback' | 'observed' | 'model-assisted';

export const EARTH_STATE_REQUIRED_LAYERS: readonly ['surfaceAlbedo', 'nightLights', 'cloudOpacity', 'cloudDensity'];
export const EARTH_STATE_REQUIRED_RESOURCES: readonly ['moonAlbedo', 'milkyWay', 'starCatalog'];
export type EarthStateLayerName = typeof EARTH_STATE_REQUIRED_LAYERS[number];
export type EarthStateResourceName = typeof EARTH_STATE_REQUIRED_RESOURCES[number];

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

export interface EarthStateLoadedBytes {
  bytes: Uint8Array;
  mediaType: string;
}

export interface EarthStateLoadedDocument extends EarthStateLoadedBytes {
  value: unknown;
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
  layers: Record<EarthStateLayerName, EarthStateLayer>;
  resources: Record<EarthStateResourceName, EarthStateResource>;
}

export function validateEarthStateManifest(manifest: unknown): asserts manifest is EarthStateManifest;

export interface EarthStateLatest {
  schemaVersion: 1;
  bundleId: string;
  manifest: EarthStateAssetReference;
}

export function validateEarthStateLatest(latest: unknown): asserts latest is EarthStateLatest;

export type EarthStateAssetRequest = {
  name: EarthStateLayerName;
  role: 'layer';
  descriptor: EarthStateLayer;
  url: string;
} | {
  name: EarthStateResourceName;
  role: 'resource';
  descriptor: EarthStateResource;
  url: string;
};

export interface ActivatedEarthState<LoadedAsset> {
  manifest: EarthStateManifest;
  layers: Record<EarthStateLayerName, LoadedAsset>;
  resources: Record<EarthStateResourceName, LoadedAsset>;
  layerDatasets: Record<EarthStateLayerName, EarthStateDataset>;
}

export interface EarthStateActivator<LoadedAsset> {
  readonly current: ActivatedEarthState<LoadedAsset> | undefined;
  activate(manifestUrl: string): Promise<ActivatedEarthState<LoadedAsset>>;
  activateLatest(latestUrl: string): Promise<ActivatedEarthState<LoadedAsset>>;
}

export function createEarthStateActivator<LoadedAsset>(adapters: {
  loadDocument(url: string, options: { signal: AbortSignal }): Promise<EarthStateLoadedDocument>;
  loadAsset(request: EarthStateAssetRequest, options: { signal: AbortSignal }): Promise<{ value: LoadedAsset; bytes: Uint8Array }>;
  timeoutMs?: number;
}): EarthStateActivator<LoadedAsset>;
