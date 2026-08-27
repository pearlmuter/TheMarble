export type EarthStateClassification = 'static-fallback' | 'observed' | 'model-assisted';

export const EARTH_STATE_REQUIRED_LAYERS: readonly ['surfaceAlbedo', 'nightLights', 'cloudOpacity', 'cloudDensity'];
export const EARTH_STATE_CRYOSPHERE_LAYERS: readonly ['snowCover', 'seaIce'];
export const EARTH_STATE_PHYSICAL_CLOUD_LAYERS: readonly ['cloudPhysics', 'cloudAge'];
export const EARTH_STATE_OPTIONAL_LAYERS: readonly ['snowCover', 'seaIce', 'cloudPhysics', 'cloudAge'];
export const EARTH_STATE_LAYER_NAMES: readonly ['surfaceAlbedo', 'nightLights', 'cloudOpacity', 'cloudDensity', 'snowCover', 'seaIce', 'cloudPhysics', 'cloudAge'];
export const EARTH_STATE_REQUIRED_RESOURCES: readonly ['moonAlbedo', 'milkyWay', 'starCatalog'];
export type EarthStateLayerName = typeof EARTH_STATE_LAYER_NAMES[number];
export type EarthStateResourceName = typeof EARTH_STATE_REQUIRED_RESOURCES[number];
export type EarthStateCloudLayerName = 'cloudOpacity' | 'cloudDensity' | 'cloudPhysics' | 'cloudAge';

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

export interface EarthStateSurfaceLayer extends EarthStateLayer {
  seasonalCycle?: {
    interpolation: 'linear';
    frames: Array<{
      month: number;
      datasetId: string;
      asset: EarthStateAssetReference;
    }>;
  };
}

export interface EarthStateCryosphereLayer extends EarthStateLayer {
  provenance: {
    validAt: string;
    producedAt: string;
    retrievedAt: string;
    sourceVersion: string;
    coverage: {
      observedFraction: number;
      latitudeRange: [number, number];
      fallbackFraction: number;
    };
    fallback: string;
    attribution: string;
  };
}

export interface EarthStateResource {
  datasetId: string;
  semantics: string;
  asset: EarthStateAssetReference;
  dimensions?: { width: number; height: number };
  colorSpace?: string;
}

export interface EarthStateCloudFrame {
  validAt: string;
  observedFrom: string;
  observedTo: string;
  producedAt: string;
  retrievedAt: string;
  coverage: {
    observedFraction: number;
    latitudeRange: [number, number];
    visibleOptimalFraction?: number;
    longwaveOptimalFraction?: number;
    usableFraction?: number;
  };
  layers: Record<'cloudOpacity' | 'cloudDensity', {
    datasetId: string;
    asset: EarthStateAssetReference;
  }> & Partial<Record<'cloudPhysics' | 'cloudAge', {
    datasetId: string;
    asset: EarthStateAssetReference;
  }>>;
}

export interface EarthStateCloudSequence {
  provider?: 'gmgsi' | 'satcorps';
  interpolation: 'crossfade';
  transitionSeconds: number;
  frames: [EarthStateCloudFrame, EarthStateCloudFrame];
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
  layers: Record<'nightLights' | 'cloudOpacity' | 'cloudDensity', EarthStateLayer>
    & { surfaceAlbedo: EarthStateSurfaceLayer }
    & Partial<Record<'snowCover' | 'seaIce', EarthStateCryosphereLayer>>
    & Partial<Record<'cloudPhysics' | 'cloudAge', EarthStateLayer>>;
  resources: Record<EarthStateResourceName, EarthStateResource>;
  cloudSequence?: EarthStateCloudSequence;
}

export function validateEarthStateManifest(manifest: unknown): asserts manifest is EarthStateManifest;

export interface EarthStateLatest {
  schemaVersion: 1;
  bundleId: string;
  manifest: EarthStateAssetReference;
}

export function validateEarthStateLatest(latest: unknown): asserts latest is EarthStateLatest;

export type EarthStateAssetRequest = {
  name: 'surfaceAlbedo';
  role: 'layer';
  descriptor: EarthStateSurfaceLayer;
  url: string;
} | {
  name: Exclude<EarthStateLayerName, 'surfaceAlbedo'>;
  role: 'layer';
  descriptor: EarthStateLayer;
  url: string;
} | {
  name: EarthStateResourceName;
  role: 'resource';
  descriptor: EarthStateResource;
  url: string;
} | {
  name: 'surfaceAlbedo';
  role: 'seasonal-layer-frame';
  month: number;
  descriptor: EarthStateLayer;
  url: string;
} | {
  name: EarthStateCloudLayerName;
  role: 'cloud-observation-frame';
  frameIndex: number;
  descriptor: EarthStateLayer;
  url: string;
};

export interface ActivatedEarthState<LoadedAsset> {
  manifest: EarthStateManifest;
  layers: Record<typeof EARTH_STATE_REQUIRED_LAYERS[number], LoadedAsset> & Partial<Record<typeof EARTH_STATE_OPTIONAL_LAYERS[number], LoadedAsset>>;
  resources: Record<EarthStateResourceName, LoadedAsset>;
  seasonalLayers: { surfaceAlbedo?: Array<{ month: number; value: LoadedAsset }> };
  cloudSequence?: Omit<EarthStateCloudSequence, 'frames'> & {
    frames: [Omit<EarthStateCloudFrame, 'layers'> & { layers: Record<'cloudOpacity' | 'cloudDensity', LoadedAsset> & Partial<Record<'cloudPhysics' | 'cloudAge', LoadedAsset>> }, Omit<EarthStateCloudFrame, 'layers'> & { layers: Record<'cloudOpacity' | 'cloudDensity', LoadedAsset> & Partial<Record<'cloudPhysics' | 'cloudAge', LoadedAsset>> }];
  };
  layerDatasets: Record<typeof EARTH_STATE_REQUIRED_LAYERS[number], EarthStateDataset> & Partial<Record<typeof EARTH_STATE_OPTIONAL_LAYERS[number], EarthStateDataset>>;
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
