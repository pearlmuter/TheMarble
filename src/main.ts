import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  celestialSceneFrameAt,
  EARTH_EQUATORIAL_RADIUS_KM,
  MOON_EQUATORIAL_RADIUS_KM,
  SUN_EQUATORIAL_RADIUS_KM,
} from './astronomical-state.js';
import { createOneTimeInertialCameraPlacement } from './inertial-camera.js';
import type { FixedSceneView } from './inertial-camera.js';
import { createOneTimeOrbitalGoldenCameraPlacement, orbitalGoldenScene } from './orbital-golden-scenes.js';
import { orbitalPhotographyState } from './orbital-photography-state.js';
import { createCloudObservationController } from './cloud-observation-controller.js';
import { formatCloudGapStatus } from './cloud-gap-status.js';
import { CLOUD_RENDER_GLSL } from './cloud-render-model.js';
import { activateEarthStateAtStartup, createEarthStateBundleCache } from './earth-state-cache.js';
import type { EarthStateBundleCache, EarthStateCacheCandidate, EarthStateCacheEntry } from './earth-state-cache.js';
import { parseEarthStateJson } from './earth-state-codec.js';
import { loadEarthStateJsonDocument } from './earth-state-document.js';
import { createIndexedDbEarthStateStorage } from './earth-state-indexeddb.js';
import { isHipparcosPayload, validateEarthStateScene } from './earth-state-scene.js';
import type { HipparcosPayload } from './earth-state-scene.js';
import { selectEarthSurfaceForRendering } from './earth-surface-selection.js';
import { formatRollingSurfaceStatus } from './rolling-surface-status.js';
import { createEarthStateActivator, EARTH_STATE_OPTIONAL_LAYERS, EARTH_STATE_REQUIRED_LAYERS, EARTH_STATE_REQUIRED_RESOURCES } from './earth-state.js';
import type { ActivatedEarthState, EarthStateAssetRequest, EarthStateLayerName, EarthStateLoadedDocument, EarthStateResourceName } from './earth-state.js';
import { createSeasonalSurfaceController } from './seasonal-surface-controller.js';
import type { SeasonalPair } from './seasonal-surface-controller.js';
import './style.css';

type CloudDensityPayload = { width: number; height: number; rgba: number[] };
type DeferredSceneTexture = {
  kind: 'deferred-scene-texture';
  request: EarthStateAssetRequest;
  bytes: Uint8Array;
  mediaType: string;
};
type LoadedSceneAsset = THREE.Texture | HipparcosPayload | DeferredSceneTexture;
type PreparedSeasonalSurface = SeasonalPair<THREE.Texture, LoadedSceneAsset>;
type SceneEarthStateLoaders = {
  loadDocument(url: string, options: { signal: AbortSignal }): Promise<EarthStateLoadedDocument>;
  loadAsset(request: EarthStateAssetRequest, options: { signal: AbortSignal }): Promise<{ value: LoadedSceneAsset; bytes: Uint8Array }>;
};

function isCloudDensityPayload(value: unknown): value is CloudDensityPayload {
  if (typeof value !== 'object' || value === null || !('width' in value) || !('height' in value) || !('rgba' in value)) return false;
  const { width, height, rgba } = value;
  return typeof width === 'number' && typeof height === 'number' && Number.isSafeInteger(width) && Number.isSafeInteger(height) && Array.isArray(rgba)
    && rgba.length === width * height * 4
    && rgba.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255);
}

function verifyImageDimensions(image: { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }, descriptor: { dimensions?: { width: number; height: number } }, name: string) {
  if (!descriptor.dimensions) return;
  const width = image.naturalWidth ?? image.width;
  const height = image.naturalHeight ?? image.height;
  if (width !== descriptor.dimensions.width || height !== descriptor.dimensions.height) {
    throw new Error(`Earth-state asset dimensions mismatch for ${name}`);
  }
}

function verifyTextureDimensions(map: THREE.Texture, descriptor: { dimensions?: { width: number; height: number } }, name: string) {
  verifyImageDimensions(map.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }, descriptor, name);
}

const canvas = document.querySelector<HTMLCanvasElement>('#globe')!;
const clock = document.querySelector<HTMLElement>('#clock')!;
const sunStatus = document.querySelector<HTMLElement>('#sun-status')!;
const loading = document.querySelector<HTMLElement>('#loading')!;
const sceneParameters = new URLSearchParams(window.location.search);
const goldenScene = orbitalGoldenScene(sceneParameters.get('golden'));
const fixedSceneTime = goldenScene?.time ?? sceneParameters.get('time');
const requestedSceneView = sceneParameters.get('view');
const fixedSceneView: FixedSceneView = requestedSceneView === 'day' || requestedSceneView === 'terminator'
  ? requestedSceneView
  : 'night';
function sceneNow() {
  if (fixedSceneTime) {
    const date = new Date(fixedSceneTime);
    if (!Number.isNaN(date.valueOf())) return date;
  }
  return new Date();
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
// A full-Earth orbital view: Earth stays jewel-sized while the Sun retains its true 0.53° disc.
const camera = new THREE.PerspectiveCamera(goldenScene?.fovDegrees ?? 22, window.innerWidth / window.innerHeight, .1, 30000);
camera.position.set(6, 1.4, 3.6);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = .045;
controls.enablePan = false;
controls.minDistance = 5.5;
controls.maxDistance = 18;

const planet = new THREE.Group();
scene.add(planet);
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

function solidTexture(red: number, green: number, blue: number, alpha = 255) {
  const map = new THREE.DataTexture(new Uint8Array([red, green, blue, alpha]), 1, 1, THREE.RGBAFormat);
  map.needsUpdate = true;
  return map;
}

const previewLayers: Record<EarthStateLayerName, LoadedSceneAsset> = {
  surfaceAlbedo: solidTexture(7, 18, 32),
  nightLights: solidTexture(0, 0, 0),
  cloudOpacity: solidTexture(255, 255, 255, 0),
  cloudDensity: solidTexture(0, 0, 0, 0),
  snowCover: solidTexture(0, 0, 0, 0),
  seaIce: solidTexture(0, 0, 0, 0),
  // Alpha zero marks the neutral fields as a legacy GMGSI fallback.
  cloudPhysics: solidTexture(0, 128, 140, 0),
  cloudAge: solidTexture(0, 0, 0, 0),
  cloudProvenance: solidTexture(0, 0, 0, 255),
  surfaceAge: solidTexture(255, 255, 255, 255),
};
const previewResources: Record<EarthStateResourceName, LoadedSceneAsset> = {
  moonAlbedo: solidTexture(38, 38, 38),
  milkyWay: solidTexture(0, 0, 0, 0),
  starCatalog: { stars: [] },
};
let applyVerifiedLayer: (name: EarthStateLayerName, asset: LoadedSceneAsset) => void = () => undefined;
let applyVerifiedResource: (name: EarthStateResourceName, asset: LoadedSceneAsset) => void = () => undefined;
let seasonalSurfaceController: {
  prepare(options: { frames: Array<{ month: number; value: LoadedSceneAsset }>; date: Date; fallbackTexture?: THREE.Texture }): Promise<PreparedSeasonalSurface>;
  activate(prepared: PreparedSeasonalSurface): void;
  update(date: Date): void;
};
let cloudObservationController: ReturnType<typeof createCloudObservationController<THREE.Texture>>;
let weatherFeed = (_now: Date) => 'loading bundled Earth state';
let activeBundleId: string | undefined;

async function decodeSceneAsset(
  { name, descriptor }: EarthStateAssetRequest,
  bytes: Uint8Array,
  mediaType: string,
) {
  if (mediaType !== descriptor.asset.mediaType) {
    throw new Error(`Earth-state asset media type mismatch for ${name}`);
  }
  if (descriptor.asset.mediaType.includes('json')) {
    const payload: unknown = parseEarthStateJson(bytes, `Earth-state JSON asset is malformed: ${name}`);
    if (name === 'starCatalog') {
      if (!isHipparcosPayload(payload)) throw new Error('Earth-state starCatalog is invalid');
      return { value: payload, bytes };
    }
    if (name === 'cloudDensity') {
      if (!isCloudDensityPayload(payload)) throw new Error('Earth-state cloudDensity is invalid');
      const map = new THREE.DataTexture(new Uint8Array(payload.rgba), payload.width, payload.height, THREE.RGBAFormat);
      map.minFilter = THREE.NearestFilter;
      map.magFilter = THREE.NearestFilter;
      map.needsUpdate = true;
      verifyTextureDimensions(map, descriptor, name);
      return { value: map, bytes };
    }
    throw new Error(`Unsupported Earth-state JSON asset: ${name}`);
  }
  const imageBytes = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>
    : Uint8Array.from(bytes);
  const objectUrl = URL.createObjectURL(new Blob([imageBytes], { type: descriptor.asset.mediaType }));
  try {
    const map = await loader.loadAsync(objectUrl);
    verifyTextureDimensions(map, descriptor, name);
    if (descriptor.colorSpace === 'srgb') map.colorSpace = THREE.SRGBColorSpace;
    if ('textureSemantics' in descriptor && descriptor.textureSemantics.sampling === 'nearest') {
      map.minFilter = THREE.NearestFilter;
      map.magFilter = THREE.NearestFilter;
    }
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return { value: map, bytes };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function createDeferredSceneTexture(request: EarthStateAssetRequest, bytes: Uint8Array, mediaType: string) {
  const { name, descriptor } = request;
  if (mediaType !== descriptor.asset.mediaType) throw new Error(`Earth-state asset media type mismatch for ${name}`);
  const imageBytes = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>
    : Uint8Array.from(bytes);
  const blob = new Blob([imageBytes], { type: mediaType });
  if ('createImageBitmap' in globalThis) {
    const bitmap = await createImageBitmap(blob);
    try {
      verifyImageDimensions(bitmap, descriptor, `${name} deferred image`);
    } finally {
      bitmap.close();
    }
  } else {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const map = await loader.loadAsync(objectUrl);
      verifyTextureDimensions(map, descriptor, `${name} deferred image`);
      map.dispose();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  return { kind: 'deferred-scene-texture', request, bytes, mediaType } satisfies DeferredSceneTexture;
}

async function loadNetworkSceneAsset(request: EarthStateAssetRequest, signal: AbortSignal) {
  const { descriptor, url } = request;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Earth-state asset unavailable (${response.status}): ${url}`);
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0] ?? descriptor.asset.mediaType;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (request.role === 'seasonal-layer-frame' || (request.role === 'layer' && request.name === 'surfaceAlbedo' && request.descriptor.seasonalCycle && !request.descriptor.rollingComposite)) {
    return { value: await createDeferredSceneTexture(request, bytes, mediaType), bytes, mediaType };
  }
  const loaded = await decodeSceneAsset(request, bytes, mediaType);
  return { ...loaded, mediaType };
}

function createNetworkEarthStateLoaders(onLoaded?: (entry: EarthStateCacheEntry) => void): SceneEarthStateLoaders {
  return {
    async loadDocument(url, options) {
      const document = await loadEarthStateJsonDocument(url, options);
      onLoaded?.({ url, mediaType: document.mediaType, bytes: document.bytes });
      return document;
    },
    async loadAsset(request, { signal }) {
      const loaded = await loadNetworkSceneAsset(request, signal);
      onLoaded?.({ url: request.url, mediaType: loaded.mediaType, bytes: loaded.bytes });
      return loaded;
    },
  };
}

function createCachedEarthStateLoaders(candidate: EarthStateCacheCandidate): SceneEarthStateLoaders {
  return {
    async loadDocument(url) {
      const entry = candidate.read(url);
      if (entry.mediaType !== 'application/json') throw new Error(`Cached Earth-state document media type mismatch: ${url}`);
      return {
        ...entry,
        value: parseEarthStateJson(entry.bytes, `Cached Earth-state document is malformed JSON: ${url}`),
      };
    },
    async loadAsset(request) {
      const entry = candidate.read(request.url);
      if (request.role === 'seasonal-layer-frame' || (request.role === 'layer' && request.name === 'surfaceAlbedo' && request.descriptor.seasonalCycle && !request.descriptor.rollingComposite)) {
        return {
          value: await createDeferredSceneTexture(request, entry.bytes, entry.mediaType),
          bytes: entry.bytes,
        };
      }
      return decodeSceneAsset(request, entry.bytes, entry.mediaType);
    },
  };
}

const isTauriRuntime = '__TAURI_INTERNALS__' in window;
const desktopEarthStateCache: EarthStateBundleCache | undefined = isTauriRuntime && 'indexedDB' in globalThis
  ? createEarthStateBundleCache({ storage: createIndexedDbEarthStateStorage() })
  : undefined;
const bundledEarthStateLoaders = createNetworkEarthStateLoaders();
let latestCapture: Map<string, EarthStateCacheEntry> | undefined;
const remoteEarthStateLoaders = createNetworkEarthStateLoaders(entry => latestCapture?.set(entry.url, entry));
let currentEarthStateLoaders = bundledEarthStateLoaders;
const earthStateActivator = createEarthStateActivator<LoadedSceneAsset>({
  loadDocument: (url, options) => currentEarthStateLoaders.loadDocument(url, options),
  loadAsset: (request, options) => currentEarthStateLoaders.loadAsset(request, options),
});

async function activateWithLoaders<Result>(loaders: SceneEarthStateLoaders, activate: () => Promise<Result>) {
  currentEarthStateLoaders = loaders;
  return activate();
}

function validateRenderableEarthState(activeEarthState: ActivatedEarthState<LoadedSceneAsset>) {
  return validateEarthStateScene(
    activeEarthState,
    asset => asset instanceof THREE.Texture,
    { isSeasonalSurfaceSource: asset => isDeferredSceneTexture(asset) },
  );
}

function requireLoadedTexture(asset: LoadedSceneAsset, name: string) {
  if (!(asset instanceof THREE.Texture)) throw new Error(`Earth-state asset ${name} is not a texture`);
  return asset;
}

function isDeferredSceneTexture(asset: LoadedSceneAsset): asset is DeferredSceneTexture {
  return typeof asset === 'object' && asset !== null && 'kind' in asset && asset.kind === 'deferred-scene-texture';
}

async function applyActivatedEarthState(activeEarthState: ActivatedEarthState<LoadedSceneAsset>) {
  const selectedSurface = selectEarthSurfaceForRendering(activeEarthState);
  const frames = selectedSurface.frames;
  const fallbackSurface = selectedSurface.fallbackAsset === undefined
    ? undefined
    : requireLoadedTexture(selectedSurface.fallbackAsset, 'surfaceAlbedo');
  const seasonalSurface = await seasonalSurfaceController.prepare({ frames, date: sceneNow(), fallbackTexture: fallbackSurface });
  for (const name of EARTH_STATE_REQUIRED_LAYERS) {
    if (!['surfaceAlbedo', 'cloudOpacity', 'cloudDensity'].includes(name)) {
      applyVerifiedLayer(name, activeEarthState.layers[name]);
    }
  }
  for (const name of EARTH_STATE_OPTIONAL_LAYERS) {
    if (!['cloudPhysics', 'cloudAge', 'cloudProvenance', 'surfaceAge'].includes(name)) {
      applyVerifiedLayer(name, activeEarthState.layers[name] ?? previewLayers[name]);
    }
  }
  for (const name of EARTH_STATE_REQUIRED_RESOURCES) applyVerifiedResource(name, activeEarthState.resources[name]);
  seasonalSurfaceController.activate(seasonalSurface);
  const cloudDataset = activeEarthState.layerDatasets.cloudOpacity;
  const surfaceStatus = formatRollingSurfaceStatus(activeEarthState.manifest.layers.surfaceAlbedo.rollingComposite);
  if (activeEarthState.cloudSequence) {
    const sequence = {
      transitionSeconds: activeEarthState.cloudSequence.transitionSeconds,
      frames: activeEarthState.cloudSequence.frames.map(frame => ({
        validAt: frame.validAt,
        observedFrom: frame.observedFrom,
        observedTo: frame.observedTo,
        layers: {
          cloudOpacity: requireLoadedTexture(frame.layers.cloudOpacity, 'cloud observation opacity'),
          cloudDensity: requireLoadedTexture(frame.layers.cloudDensity, 'cloud observation density'),
          cloudPhysics: requireLoadedTexture(frame.layers.cloudPhysics ?? previewLayers.cloudPhysics, 'cloud observation physics'),
          cloudAge: requireLoadedTexture(frame.layers.cloudAge ?? previewLayers.cloudAge, 'cloud observation age'),
          cloudProvenance: requireLoadedTexture(frame.layers.cloudProvenance ?? previewLayers.cloudProvenance, 'cloud observation provenance'),
        },
      })) as [
        { validAt: string; observedFrom: string; observedTo: string; layers: { cloudOpacity: THREE.Texture; cloudDensity: THREE.Texture; cloudPhysics: THREE.Texture; cloudAge: THREE.Texture; cloudProvenance: THREE.Texture } },
        { validAt: string; observedFrom: string; observedTo: string; layers: { cloudOpacity: THREE.Texture; cloudDensity: THREE.Texture; cloudPhysics: THREE.Texture; cloudAge: THREE.Texture; cloudProvenance: THREE.Texture } },
      ],
    };
    cloudObservationController.activate(sequence, sceneNow());
    const [from, to] = activeEarthState.cloudSequence.frames;
    weatherFeed = now => {
      const ageMinutes = Math.max(0, Math.floor((now.valueOf() - Date.parse(to.observedTo)) / 60_000));
      const coverage = Math.round(to.coverage.observedFraction * 100);
      const latitude = Math.min(Math.abs(to.coverage.latitudeRange[0]), Math.abs(to.coverage.latitudeRange[1])).toFixed(1);
      const provider = activeEarthState.cloudSequence?.provider === 'satcorps' ? 'NASA SatCORPS' : 'NOAA GMGSI';
      const gapStatus = formatCloudGapStatus({
        gapCompletion: activeEarthState.cloudSequence?.gapCompletion,
        frame: to,
      });
      if (gapStatus) {
        return [surfaceStatus, `${provider} ${cloudDataset.version} · frames ${from.validAt.slice(11, 16)}Z → ${to.validAt.slice(11, 16)}Z · latest observed through ${to.observedTo.slice(11, 19)}Z · ${ageMinutes} min old · ${gapStatus}`].filter(Boolean).join(' · ');
      }
      return [surfaceStatus, `${provider} ${cloudDataset.version} · frames ${from.validAt.slice(11, 16)}Z → ${to.validAt.slice(11, 16)}Z · latest observed through ${to.observedTo.slice(11, 19)}Z · ${ageMinutes} min old · ${coverage}% usable coverage to ±${latitude}°`].filter(Boolean).join(' · ');
    };
  } else {
    cloudObservationController.activateStatic({
      cloudOpacity: requireLoadedTexture(activeEarthState.layers.cloudOpacity, 'cloudOpacity'),
      cloudDensity: requireLoadedTexture(activeEarthState.layers.cloudDensity, 'cloudDensity'),
      cloudPhysics: requireLoadedTexture(activeEarthState.layers.cloudPhysics ?? previewLayers.cloudPhysics, 'cloudPhysics'),
      cloudAge: requireLoadedTexture(activeEarthState.layers.cloudAge ?? previewLayers.cloudAge, 'cloudAge'),
      cloudProvenance: requireLoadedTexture(activeEarthState.layers.cloudProvenance ?? previewLayers.cloudProvenance, 'cloudProvenance'),
    });
    weatherFeed = () => [surfaceStatus, `clouds ${activeEarthState.manifest.classification.replace('-', ' ')} · ${cloudDataset.version}`].filter(Boolean).join(' · ');
  }
  activeBundleId = activeEarthState.manifest.bundleId;
}

let updateFrame: () => void = () => undefined;
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateFrame();
  renderer.render(scene, camera);
}
animate();

startScene();
const configuredLatestEarthStateUrl = import.meta.env.VITE_EARTH_STATE_LATEST_URL as string | undefined;
const latestEarthStateUrl = new URL(configuredLatestEarthStateUrl ?? '/earth-state/latest.json', window.location.href).href;
let latestRefreshInFlight = false;
async function refreshLatestEarthState() {
  if (latestRefreshInFlight) return;
  latestRefreshInFlight = true;
  latestCapture = new Map();
  try {
    const previous = earthStateActivator.current;
    const activeEarthState = validateRenderableEarthState(await activateWithLoaders(
      remoteEarthStateLoaders,
      () => earthStateActivator.activateLatest(latestEarthStateUrl),
    ));
    if (activeEarthState.manifest.bundleId !== activeBundleId) await applyActivatedEarthState(activeEarthState);
    if (activeEarthState !== previous && desktopEarthStateCache) {
      const snapshot = {
        bundleId: activeEarthState.manifest.bundleId,
        validAt: activeEarthState.manifest.times.validAt,
        latestUrl: latestEarthStateUrl,
        entries: [...latestCapture.values()],
      };
      void desktopEarthStateCache.remember(snapshot).catch(() => {
        // Storage quota or eviction must not prevent a fully verified online bundle from rendering.
      });
    }
  } catch {
    // Missing or invalid production state is an expected fallback condition. Keep the verified globe.
  } finally {
    latestCapture = undefined;
    latestRefreshInFlight = false;
  }
}

void activateEarthStateAtStartup({
  cache: desktopEarthStateCache,
  activateCached: async candidate => validateRenderableEarthState(await activateWithLoaders(
    createCachedEarthStateLoaders(candidate),
    () => earthStateActivator.activateLatest(candidate.latestUrl),
  )),
  activateBundled: async () => validateRenderableEarthState(await activateWithLoaders(
    bundledEarthStateLoaders,
    () => earthStateActivator.activate(new URL('/earth-state/bundled-v1.json', window.location.href).href),
  )),
}).then(async activeEarthState => {
  await applyActivatedEarthState(activeEarthState);
  loading.classList.add('hidden');
  void refreshLatestEarthState();
  window.setInterval(refreshLatestEarthState, 10 * 60 * 1000);
}).catch(error => {
  loading.setAttribute('aria-label', 'TheMarble could not load a complete Earth state');
  console.error(error);
});

function startScene() {

function requireTexture(asset: LoadedSceneAsset, name: string) {
  if (!(asset instanceof THREE.Texture)) throw new Error(`Earth-state asset ${name} is not a texture`);
  return asset;
}

function requireStarCatalog(asset: LoadedSceneAsset) {
  if (!isHipparcosPayload(asset)) throw new Error('Earth-state starCatalog is invalid');
  return asset;
}

const dayMap = requireTexture(previewLayers.surfaceAlbedo, 'surfaceAlbedo');
const nightMap = requireTexture(previewLayers.nightLights, 'nightLights');
const cloudMap = requireTexture(previewLayers.cloudOpacity, 'cloudOpacity');
const liveWeatherMap = requireTexture(previewLayers.cloudDensity, 'cloudDensity');
const cloudPhysicsMap = requireTexture(previewLayers.cloudPhysics, 'cloudPhysics');
const cloudAgeMap = requireTexture(previewLayers.cloudAge, 'cloudAge');
const cloudProvenanceMap = requireTexture(previewLayers.cloudProvenance, 'cloudProvenance');
const snowCoverMap = requireTexture(previewLayers.snowCover, 'snowCover');
const seaIceMap = requireTexture(previewLayers.seaIce, 'seaIce');
const moonMap = requireTexture(previewResources.moonAlbedo, 'moonAlbedo');
const milkyWayMap = requireTexture(previewResources.milkyWay, 'milkyWay');
const celestialSky = new THREE.Group();
scene.add(celestialSky);

const milkyWayMaterial = new THREE.ShaderMaterial({
  transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
  uniforms: { map: { value: milkyWayMap }, exposure: { value: .08 } },
  vertexShader: `varying vec3 vDirection; void main(){ vDirection=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D map; uniform float exposure; varying vec3 vDirection;
    const float PI=3.14159265359;
    void main(){
      vec3 direction=normalize(vDirection); float rightAscension=atan(-direction.z,direction.x); float declination=asin(clamp(direction.y,-1.0,1.0));
      vec2 uv=vec2(fract(.5-rightAscension/(2.0*PI)),.5+declination/PI); vec3 panorama=texture2D(map,uv).rgb;
      float luminance=dot(panorama,vec3(.2126,.7152,.0722)); vec3 diffuse=max(panorama-vec3(.032),vec3(0.0));
      float galacticStructure=smoothstep(.028,.2,luminance); diffuse=mix(vec3(luminance),diffuse,.68)*galacticStructure*.38*exposure;
      gl_FragColor=vec4(diffuse,1.0);
    }`
});
const milkyWay = new THREE.Mesh(new THREE.SphereGeometry(900, 96, 64), milkyWayMaterial);
celestialSky.add(milkyWay);

function blackbodyColor(colorIndex: number) {
  const bv = THREE.MathUtils.clamp(colorIndex, -.4, 2);
  const kelvin = 4600 * (1 / (.92 * bv + 1.7) + 1 / (.92 * bv + .62));
  const temperature = kelvin / 100;
  const red = temperature <= 66 ? 255 : 329.698727446 * Math.pow(temperature - 60, -.1332047592);
  const green = temperature <= 66 ? 99.4708025861 * Math.log(temperature) - 161.1195681661 : 288.1221695283 * Math.pow(temperature - 60, -.0755148492);
  const blue = temperature >= 66 ? 255 : temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  return new THREE.Color(THREE.MathUtils.clamp(red, 0, 255) / 255, THREE.MathUtils.clamp(green, 0, 255) / 255, THREE.MathUtils.clamp(blue, 0, 255) / 255);
}

let starMaterial: THREE.ShaderMaterial | undefined;
let starPoints: THREE.Points | undefined;
function loadHipparcosStars({ stars }: HipparcosPayload) {
  if (starPoints) {
    celestialSky.remove(starPoints);
    starPoints.geometry.dispose();
    (starPoints.material as THREE.Material).dispose();
  }
  const positions = new Float32Array(stars.length * 3); const colors = new Float32Array(stars.length * 3);
  const magnitudes = new Float32Array(stars.length); const brightness = new Float32Array(stars.length);
  stars.forEach(([rightAscension, declination, magnitude, colorIndex], index) => {
    const position = latLonVector(declination, rightAscension, 850); const color = blackbodyColor(colorIndex);
    positions.set(position.toArray(), index * 3); colors.set(color.toArray(), index * 3);
    magnitudes[index] = magnitude; brightness[index] = THREE.MathUtils.clamp((8.15 - magnitude) / 9.6, .025, 1);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('magnitude', new THREE.BufferAttribute(magnitudes, 1));
  geometry.setAttribute('brightness', new THREE.BufferAttribute(brightness, 1));
  starMaterial = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, vertexColors: true,
    uniforms: { pixelRatio: { value: renderer.getPixelRatio() }, exposure: { value: .2 } },
    vertexShader: `attribute float magnitude; attribute float brightness; uniform float pixelRatio; varying vec3 vColor; varying float vBrightness; void main(){ vColor=color; vBrightness=brightness; vec4 viewPosition=modelViewMatrix*vec4(position,1.0); gl_PointSize=mix(.55,4.4,pow(brightness,2.15))*pixelRatio; gl_Position=projectionMatrix*viewPosition; }`,
    fragmentShader: `uniform float exposure; varying vec3 vColor; varying float vBrightness; void main(){ float radius=length(gl_PointCoord-.5)*2.0; if(radius>1.0)discard; float halo=pow(max(1.0-radius,0.0),2.5); float core=pow(max(1.0-radius,0.0),10.0); float alpha=(halo*.52+core*.92)*mix(.2,1.0,sqrt(vBrightness)); vec3 radiance=vColor*(.42+vBrightness*1.72+core)*exposure; gl_FragColor=vec4(radiance,alpha); }`
  });
  starPoints = new THREE.Points(geometry, starMaterial);
  celestialSky.add(starPoints);
}

const earthMaterial = new THREE.ShaderMaterial({
  uniforms: {
    dayMapFrom: { value: dayMap }, dayMapTo: { value: dayMap }, seasonalMix: { value: 0 },
    nightMap: { value: nightMap },
    snowCoverMap: { value: snowCoverMap }, seaIceMap: { value: seaIceMap },
    cloudMapFrom: { value: cloudMap }, cloudMapTo: { value: cloudMap },
    cloudDensityFrom: { value: liveWeatherMap }, cloudDensityTo: { value: liveWeatherMap }, cloudMix: { value: 0 },
    cloudPhysicsFrom: { value: cloudPhysicsMap }, cloudPhysicsTo: { value: cloudPhysicsMap },
    cloudAgeFrom: { value: cloudAgeMap }, cloudAgeTo: { value: cloudAgeMap },
    sunDirection: { value: new THREE.Vector3(1, 0, 0) }, sunLocalDirection: { value: new THREE.Vector3(1, 0, 0) }
  },
  vertexShader: `varying vec2 vUv; varying vec3 vObjectNormal; varying vec3 vViewNormal; varying vec3 vViewPosition; void main(){ vUv=uv; vObjectNormal=normalize(normal); vViewNormal=normalize(normalMatrix*normal); vViewPosition=(modelViewMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*vec4(vViewPosition,1.0); }`,
  fragmentShader: `
    uniform sampler2D dayMapFrom; uniform sampler2D dayMapTo; uniform float seasonalMix;
    uniform sampler2D nightMap; uniform sampler2D snowCoverMap; uniform sampler2D seaIceMap; uniform sampler2D cloudMapFrom; uniform sampler2D cloudMapTo;
    uniform sampler2D cloudDensityFrom; uniform sampler2D cloudDensityTo; uniform sampler2D cloudPhysicsFrom; uniform sampler2D cloudPhysicsTo;
    uniform sampler2D cloudAgeFrom; uniform sampler2D cloudAgeTo; uniform float cloudMix; uniform vec3 sunDirection; uniform vec3 sunLocalDirection;
    varying vec2 vUv; varying vec3 vObjectNormal; varying vec3 vViewNormal; varying vec3 vViewPosition;
    const float PI=3.14159265359;
    ${CLOUD_RENDER_GLSL}
    void main() {
      vec3 normal=normalize(vViewNormal); vec3 viewDirection=normalize(-vViewPosition); vec3 sunView=normalize((viewMatrix*vec4(sunDirection,0.0)).xyz);
      float solar=dot(normal,sunView); float nDotL=max(solar,0.0); float nDotV=max(dot(normal,viewDirection),.001);
      float daylight=smoothstep(-.012,.028,solar); float directLight=.055+1.32*smoothstep(-.015,.72,solar);
      float zenithDegrees=degrees(acos(clamp(solar,0.0,1.0))); float airMass=1.0/(max(solar,0.0)+.50572*pow(max(96.07995-zenithDegrees,.01),-1.6364));
      vec3 sunlight=exp(-vec3(.04,.07,.15)*min(airMass,38.0));
      vec3 surface=mix(texture2D(dayMapFrom,vUv).rgb,texture2D(dayMapTo,vUv).rgb,seasonalMix);
      float luminance=dot(surface,vec3(.2126,.7152,.0722));
      float blueDominance=surface.b-max(surface.r,surface.g);
      float ocean=smoothstep(.0006,.006,blueDominance)*(1.0-smoothstep(.12,.36,luminance));
      float snowCover=texture2D(snowCoverMap,vUv).r;
      float seaIce=texture2D(seaIceMap,vUv).r;
      float landSnow=snowCover;
      float oceanIce=seaIce;
      vec3 land=surface*directLight*1.22*mix(vec3(1.0),sunlight,.82);
      vec3 snowAlbedo=mix(vec3(.58,.66,.72),vec3(.94,.965,.985),clamp(luminance*2.2,.0,1.0))*directLight*mix(vec3(1.0),sunlight,.72);
      vec3 halfVector=normalize(sunView+viewDirection); float nDotH=max(dot(normal,halfVector),0.0); float vDotH=max(dot(viewDirection,halfVector),0.0);
      float roughness=.19; roughness=mix(roughness,.68,oceanIce); float alpha2=roughness*roughness; alpha2*=alpha2;
      float denominator=nDotH*nDotH*(alpha2-1.0)+1.0; float distribution=alpha2/(3.14159265*denominator*denominator+.00001);
      float k=roughness*roughness*.5; float geometryView=nDotV/(nDotV*(1.0-k)+k); float geometryLight=nDotL/(nDotL*(1.0-k)+k);
      float fresnel=.0204+(1.0-.0204)*pow(1.0-vDotH,5.0);
      float specular=distribution*geometryView*geometryLight*fresnel/(4.0*nDotV*max(nDotL,.001)+.0001);
      float horizonFresnel=.0204+(1.0-.0204)*pow(1.0-nDotV,5.0);
      vec3 deepWater=vec3(.0022,.012,.026); vec3 waterDiffuse=deepWater*(.13+.48*nDotL)*mix(vec3(1.0),sunlight,.7);
      vec3 atmosphericReflection=vec3(.018,.075,.15)*horizonFresnel*(.3+.7*daylight);
      vec3 sunGlint=vec3(1.0,.78,.5)*specular*nDotL*1.3;
      vec3 oceanLight=waterDiffuse+atmosphericReflection+sunGlint;
      vec3 seaIceLight=vec3(.68,.76,.82)*(.3+.92*nDotL)*mix(vec3(1.0),sunlight,.68)+atmosphericReflection*.28;
      vec3 day=mix(land,oceanLight,ocean);
      day=mix(day,snowAlbedo,landSnow*.94);
      day=mix(day,seaIceLight,oceanIce);
      vec4 weather=mix(texture2D(cloudDensityFrom,vUv),texture2D(cloudDensityTo,vUv),cloudMix);
      vec4 physics=mix(texture2D(cloudPhysicsFrom,vUv),texture2D(cloudPhysicsTo,vUv),cloudMix);
      float cloudQuality=physics.a; float physicalWeight=step(.001,cloudQuality);
      float opticalDepth=decodeCloudOpticalDepth(physics.r);
      vec4 localCloud=mix(texture2D(cloudMapFrom,vUv),texture2D(cloudMapTo,vUv),cloudMix);
      opticalDepth=mix(-log(max(1.0-localCloud.a*.82,.01)),opticalDepth,physicalWeight);
      cloudQuality=mix(weather.g,cloudQuality,physicalWeight);
      vec3 surfaceDirection=normalize(vObjectNormal); vec3 localSun=normalize(sunLocalDirection);
      vec2 probeUv0=sphericalCloudShadowUv(surfaceDirection,localSun,1.5);
      vec2 probeUv1=sphericalCloudShadowUv(surfaceDirection,localSun,6.5);
      vec2 probeUv2=sphericalCloudShadowUv(surfaceDirection,localSun,11.5);
      vec2 probeUv3=sphericalCloudShadowUv(surfaceDirection,localSun,16.5);
      vec4 casterProbe=mix(texture2D(cloudPhysicsFrom,probeUv0),texture2D(cloudPhysicsTo,probeUv0),cloudMix);
      float casterProbeScore=cloudProbeScore(casterProbe,1.5);
      vec4 nextProbe=mix(texture2D(cloudPhysicsFrom,probeUv1),texture2D(cloudPhysicsTo,probeUv1),cloudMix);
      float nextProbeScore=cloudProbeScore(nextProbe,6.5); if(nextProbeScore>casterProbeScore){ casterProbe=nextProbe; casterProbeScore=nextProbeScore; }
      nextProbe=mix(texture2D(cloudPhysicsFrom,probeUv2),texture2D(cloudPhysicsTo,probeUv2),cloudMix);
      nextProbeScore=cloudProbeScore(nextProbe,11.5); if(nextProbeScore>casterProbeScore){ casterProbe=nextProbe; casterProbeScore=nextProbeScore; }
      nextProbe=mix(texture2D(cloudPhysicsFrom,probeUv3),texture2D(cloudPhysicsTo,probeUv3),cloudMix);
      nextProbeScore=cloudProbeScore(nextProbe,16.5); if(nextProbeScore>casterProbeScore){ casterProbe=nextProbe; casterProbeScore=nextProbeScore; }
      float casterPhysicalWeight=step(.001,casterProbeScore);
      float casterHeightKm=mix(11.0,casterProbe.b*20.0,casterPhysicalWeight);
      vec2 shadowUv0=sphericalCloudShadowUv(normalize(vObjectNormal),normalize(sunLocalDirection),casterHeightKm*.78);
      vec2 shadowUv1=sphericalCloudShadowUv(normalize(vObjectNormal),normalize(sunLocalDirection),casterHeightKm);
      vec2 shadowUv2=sphericalCloudShadowUv(normalize(vObjectNormal),normalize(sunLocalDirection),casterHeightKm*1.22);
      float cloudShadow0=mix(texture2D(cloudMapFrom,shadowUv0).a,texture2D(cloudMapTo,shadowUv0).a,cloudMix);
      float cloudShadow1=mix(texture2D(cloudMapFrom,shadowUv1).a,texture2D(cloudMapTo,shadowUv1).a,cloudMix);
      float cloudShadow2=mix(texture2D(cloudMapFrom,shadowUv2).a,texture2D(cloudMapTo,shadowUv2).a,cloudMix);
      vec4 casterPhysics=mix(texture2D(cloudPhysicsFrom,shadowUv1),texture2D(cloudPhysicsTo,shadowUv1),cloudMix);
      vec4 casterWeather=mix(texture2D(cloudDensityFrom,shadowUv1),texture2D(cloudDensityTo,shadowUv1),cloudMix);
      float casterQuality=casterPhysics.a; casterPhysicalWeight=step(.001,casterQuality);
      float casterOpticalDepth=decodeCloudOpticalDepth(casterPhysics.r);
      casterOpticalDepth=mix(-log(max(1.0-cloudShadow1*.82,.01)),casterOpticalDepth,casterPhysicalWeight);
      casterQuality=mix(casterWeather.g,casterQuality,casterPhysicalWeight);
      float casterDensity=mix(.72,1.18,casterWeather.r)*casterWeather.g;
      float cloudShadow=(cloudShadow0+2.0*cloudShadow1+cloudShadow2)*.25*casterDensity;
      day*=1.0-cloudShadow*daylight*mix(.12,.34,clamp(casterOpticalDepth/18.0,0.0,1.0))*casterQuality;
      float nightFalloff=1.0-smoothstep(-.035,.008,solar);
      vec3 night=texture2D(nightMap,vUv).rgb*nightFalloff*1.8;
      night*=cloudTransmission(opticalDepth,cloudQuality);
      gl_FragColor=vec4(mix(night,day,daylight),1.0);
    }
  `
});
const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 192), earthMaterial);
planet.add(earth);

const cloudMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: {
    cloudMapFrom: { value: cloudMap }, cloudMapTo: { value: cloudMap },
    cloudDensityFrom: { value: liveWeatherMap }, cloudDensityTo: { value: liveWeatherMap }, cloudMix: { value: 0 },
    cloudPhysicsFrom: { value: cloudPhysicsMap }, cloudPhysicsTo: { value: cloudPhysicsMap },
    cloudAgeFrom: { value: cloudAgeMap }, cloudAgeTo: { value: cloudAgeMap },
    sunDirection: { value: new THREE.Vector3(1, 0, 0) },
  },
  vertexShader: `
    uniform sampler2D cloudPhysicsFrom; uniform sampler2D cloudPhysicsTo; uniform float cloudMix;
    varying vec2 vUv; varying vec3 vViewNormal; varying vec3 vViewPosition; varying vec4 vPhysics;
    void main(){
      vUv=uv; vPhysics=mix(texture2D(cloudPhysicsFrom,uv),texture2D(cloudPhysicsTo,uv),cloudMix);
      float physicalWeight=step(.001,vPhysics.a); float heightKm=mix(11.0,vPhysics.b*20.0,physicalWeight);
      float cloudRadius=1.0+heightKm/6371.0; vec3 displaced=position*cloudRadius;
      vViewNormal=normalize(normalMatrix*normal); vViewPosition=(modelViewMatrix*vec4(displaced,1.0)).xyz;
      gl_Position=projectionMatrix*vec4(vViewPosition,1.0);
    }`,
  fragmentShader: `
    uniform sampler2D cloudMapFrom; uniform sampler2D cloudMapTo; uniform sampler2D cloudDensityFrom; uniform sampler2D cloudDensityTo;
    uniform sampler2D cloudAgeFrom; uniform sampler2D cloudAgeTo; uniform float cloudMix; uniform vec3 sunDirection;
    varying vec2 vUv; varying vec3 vViewNormal; varying vec3 vViewPosition; varying vec4 vPhysics;
    const float PI=3.14159265359;
    ${CLOUD_RENDER_GLSL}
    void main(){
      vec4 cloud=mix(texture2D(cloudMapFrom,vUv),texture2D(cloudMapTo,vUv),cloudMix);
      vec4 weather=mix(texture2D(cloudDensityFrom,vUv),texture2D(cloudDensityTo,vUv),cloudMix);
      float observationAge=mix(texture2D(cloudAgeFrom,vUv).r,texture2D(cloudAgeTo,vUv).r,cloudMix);
      vec4 physics=vPhysics; float cloudQuality=physics.a; float physicalWeight=step(.001,cloudQuality);
      float opticalDepth=decodeCloudOpticalDepth(physics.r);
      opticalDepth=mix(-log(max(1.0-cloud.a*.82,.01)),opticalDepth,physicalWeight);
      cloudQuality=mix(weather.g,cloudQuality,physicalWeight);
      float icePhase=physics.g;
      float density=mix(mix(.72,1.18,weather.r),1.0-exp(-opticalDepth*.35),physicalWeight)*cloudQuality;
      vec3 sunView=normalize((viewMatrix*vec4(sunDirection,0.0)).xyz); vec3 viewDirection=normalize(-vViewPosition);
      float solarRaw=dot(normalize(vViewNormal),sunView); float solar=smoothstep(-.012,.035,solarRaw);
      float zenithDegrees=degrees(acos(clamp(solarRaw,0.0,1.0)));
      float airMass=1.0/(max(solarRaw,0.0)+.50572*pow(max(96.07995-zenithDegrees,.01),-1.6364));
      vec3 sunlight=exp(-vec3(.04,.07,.15)*min(airMass,38.0));
      float forward=max(-dot(viewDirection,sunView),0.0);
      float phaseExponent=mix(12.0,22.0,icePhase); float silver=pow(forward,phaseExponent)*smoothstep(-.02,.28,solarRaw)*mix(.55,1.05,icePhase);
      vec3 phaseTint=mix(vec3(1.03,.995,.94),vec3(.94,.99,1.08),icePhase);
      vec3 litCloud=phaseTint*mix(vec3(1.0),sunlight,.88);
      vec3 cloudLight=litCloud*solar+vec3(1.0,.56,.2)*silver*.48*solar;
      float ageTrust=1.0-observationAge*.18;
      gl_FragColor=vec4(cloud.rgb*cloudLight,cloud.a*density*.9*ageTrust);
    }`
});
const clouds = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 192), cloudMaterial);
planet.add(clouds);

function installCloudUniforms(material: THREE.ShaderMaterial, from: { cloudOpacity: THREE.Texture; cloudDensity: THREE.Texture; cloudPhysics?: THREE.Texture; cloudAge?: THREE.Texture }, to: { cloudOpacity: THREE.Texture; cloudDensity: THREE.Texture; cloudPhysics?: THREE.Texture; cloudAge?: THREE.Texture }, mix: number) {
  material.uniforms.cloudMapFrom.value = from.cloudOpacity;
  material.uniforms.cloudMapTo.value = to.cloudOpacity;
  material.uniforms.cloudDensityFrom.value = from.cloudDensity;
  material.uniforms.cloudDensityTo.value = to.cloudDensity;
  material.uniforms.cloudPhysicsFrom.value = from.cloudPhysics ?? cloudPhysicsMap;
  material.uniforms.cloudPhysicsTo.value = to.cloudPhysics ?? cloudPhysicsMap;
  material.uniforms.cloudAgeFrom.value = from.cloudAge ?? cloudAgeMap;
  material.uniforms.cloudAgeTo.value = to.cloudAge ?? cloudAgeMap;
  material.uniforms.cloudMix.value = mix;
}

cloudObservationController = createCloudObservationController<THREE.Texture>({
  initialLayers: {
    cloudOpacity: cloudMap,
    cloudDensity: liveWeatherMap,
    cloudPhysics: cloudPhysicsMap,
    cloudAge: cloudAgeMap,
    cloudProvenance: cloudProvenanceMap,
  },
  install({ from, to, mix }) {
    installCloudUniforms(earthMaterial, from, to, mix);
    installCloudUniforms(cloudMaterial, from, to, mix);
  },
  disposeTexture(texture) {
    if (texture !== cloudPhysicsMap && texture !== cloudAgeMap && texture !== cloudProvenanceMap) texture.dispose();
  },
});

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.02, 192, 192),
  new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: `varying vec3 vWorldPosition; void main(){ vWorldPosition=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 sunDirection; varying vec3 vWorldPosition;
      const float PI=3.14159265359; const float GROUND_RADIUS=1.0; const float ATMOSPHERE_RADIUS=1.02;
      const float RAYLEIGH_HEIGHT=.001258; const float MIE_HEIGHT=.000189;
      const vec3 BETA_R=vec3(36.96,86.38,210.88); const vec3 BETA_M_EXT=vec3(28.3); const vec3 BETA_M_SCA=vec3(25.46); const vec3 BETA_O3=vec3(4.14,11.98,.54);
      vec2 sphereInterval(vec3 origin,vec3 direction,float radius){ float b=dot(origin,direction); float h=b*b-dot(origin,origin)+radius*radius; if(h<0.0)return vec2(1e5,-1e5); h=sqrt(h); return vec2(-b-h,-b+h); }
      bool earthShadow(vec3 point,vec3 lightDirection){ vec2 hit=sphereInterval(point+lightDirection*.00002,lightDirection,GROUND_RADIUS); return hit.y>0.0&&hit.x>0.0; }
      vec3 extinction(float odR,float odM,float odO){ return exp(-(BETA_R*odR+BETA_M_EXT*odM+BETA_O3*odO)); }
      void main(){
        vec3 rayDirection=normalize(vWorldPosition-cameraPosition); vec3 lightDirection=normalize(sunDirection);
        vec2 atmosphereHit=sphereInterval(cameraPosition,rayDirection,ATMOSPHERE_RADIUS); float nearDistance=max(atmosphereHit.x,0.0); float farDistance=atmosphereHit.y;
        vec2 groundHit=sphereInterval(cameraPosition,rayDirection,GROUND_RADIUS); if(groundHit.x>0.0) farDistance=min(farDistance,groundHit.x);
        if(farDistance<=nearDistance) discard;
        float mu=clamp(dot(rayDirection,lightDirection),-1.0,1.0); float phaseR=3.0/(16.0*PI)*(1.0+mu*mu);
        float g=.8; float phaseM=3.0/(8.0*PI)*((1.0-g*g)*(1.0+mu*mu))/((2.0+g*g)*pow(max(1.0+g*g-2.0*g*mu,.001),1.5));
        float stepLength=(farDistance-nearDistance)/10.0; float odR=0.0; float odM=0.0; float odO=0.0; vec3 radiance=vec3(0.0);
        for(int i=0;i<10;i++){
          float distanceAlong=nearDistance+(float(i)+.5)*stepLength; vec3 point=cameraPosition+rayDirection*distanceAlong; float altitude=max(length(point)-GROUND_RADIUS,0.0);
          float densityR=exp(-altitude/RAYLEIGH_HEIGHT); float densityM=exp(-altitude/MIE_HEIGHT); float densityO=max(0.0,1.0-abs(altitude-.00393)/.0026);
          odR+=densityR*stepLength; odM+=densityM*stepLength; odO+=densityO*stepLength;
          if(!earthShadow(point,lightDirection)){
            vec2 sunHit=sphereInterval(point,lightDirection,ATMOSPHERE_RADIUS); float sunLength=max(sunHit.y,0.0)/5.0; float sunR=0.0; float sunM=0.0; float sunO=0.0;
            for(int j=0;j<5;j++){
              vec3 sunPoint=point+lightDirection*(float(j)+.5)*sunLength; float sunAltitude=max(length(sunPoint)-GROUND_RADIUS,0.0);
              sunR+=exp(-sunAltitude/RAYLEIGH_HEIGHT)*sunLength; sunM+=exp(-sunAltitude/MIE_HEIGHT)*sunLength; sunO+=max(0.0,1.0-abs(sunAltitude-.00393)/.0026)*sunLength;
            }
            vec3 transmittance=extinction(odR,odM,odO)*extinction(sunR,sunM,sunO);
            radiance+=transmittance*(BETA_R*densityR*phaseR+BETA_M_SCA*densityM*phaseM)*stepLength;
          }
        }
        // A small exposure lift stands in for unresolved multiple scattering at this scale.
        // It remains gated by the same tangent height, solar direction, and Earth shadow.
        float nearestTime=max(-dot(cameraPosition,rayDirection),0.0); vec3 tangentPoint=cameraPosition+rayDirection*nearestTime;
        float impact=length(tangentPoint); float tangentHeight=max(impact-GROUND_RADIUS,0.0);
        float limbEnvelope=step(GROUND_RADIUS,impact)*exp(-tangentHeight/(RAYLEIGH_HEIGHT*6.0));
        float tangentSun=dot(normalize(tangentPoint),lightDirection); float illuminated=smoothstep(-.018,.035,tangentSun);
        float forwardAureole=pow(max(mu,0.0),30.0);
        vec3 exposedLimb=vec3(.018,.31,.78)*limbEnvelope*illuminated*.92;
        exposedLimb+=vec3(1.0,.36,.035)*limbEnvelope*illuminated*forwardAureole*.08;
        // Additive light carries its own physical intensity; an alpha derived from intensity
        // would multiply the already-dim limb a second time and erase it.
        vec3 color=radiance*vec3(13.0,13.0,10.0)+exposedLimb; gl_FragColor=vec4(color,1.0);
      }`
  })
);
planet.add(atmosphere);

const moonMaterial = new THREE.ShaderMaterial({
  uniforms: { moonMap: { value: moonMap }, sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
  vertexShader: `varying vec2 vUv; varying vec3 vViewNormal; void main(){ vUv=uv; vViewNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D moonMap; uniform vec3 sunDirection; varying vec2 vUv; varying vec3 vViewNormal; void main(){ vec3 sunView=normalize((viewMatrix*vec4(sunDirection,0.0)).xyz); float light=smoothstep(-.004,.018,dot(normalize(vViewNormal),sunView)); vec3 albedo=texture2D(moonMap,vUv).rgb; gl_FragColor=vec4(albedo*mix(.003,1.0,light),1.0); }`
});
// Distances and radii below are expressed in equatorial Earth radii (Earth = 1.0).
const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_EQUATORIAL_RADIUS_KM / EARTH_EQUATORIAL_RADIUS_KM, 64, 64), moonMaterial);
scene.add(moon);
const sunRadius = SUN_EQUATORIAL_RADIUS_KM / EARTH_EQUATORIAL_RADIUS_KM;
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(sunRadius, 48, 48),
  new THREE.ShaderMaterial({
    // The physical sphere preserves the true solar angular size and position, while the
    // exposed camera image is carried by the soft optical layers below.
    colorWrite: false, depthWrite: false,
    vertexShader: `varying vec3 vWorldPosition; varying vec3 vWorldNormal; void main(){ vWorldPosition=(modelMatrix*vec4(position,1.0)).xyz; vWorldNormal=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vWorldPosition; varying vec3 vWorldNormal;
      const float PI=3.14159265359; const float RAYLEIGH_HEIGHT=.001258; const float MIE_HEIGHT=.000189;
      const vec3 BETA_R=vec3(36.96,86.38,210.88); const vec3 BETA_M=vec3(28.3);
      void main(){
        vec3 ray=normalize(vWorldPosition-cameraPosition); float nearestTime=max(-dot(cameraPosition,ray),0.0); float impact=length(cameraPosition+ray*nearestTime);
        if(nearestTime>0.0&&impact<1.0) discard;
        float altitude=max(impact-1.0,0.0); float slantR=exp(-altitude/RAYLEIGH_HEIGHT)*sqrt(2.0*PI*RAYLEIGH_HEIGHT); float slantM=exp(-altitude/MIE_HEIGHT)*sqrt(2.0*PI*MIE_HEIGHT);
        vec3 transmission=impact<1.00943?exp(-(BETA_R*slantR+BETA_M*slantM)):vec3(1.0);
        vec3 viewDirection=normalize(cameraPosition-vWorldPosition); float limb=max(dot(normalize(vWorldNormal),viewDirection),0.0); float limbDarkening=.88+.12*pow(limb,.42);
        float granulation=.99+.01*sin(vWorldNormal.x*173.0+sin(vWorldNormal.y*211.0))*sin(vWorldNormal.z*197.0);
        gl_FragColor=vec4(vec3(18.0,16.8,15.2)*transmission*limbDarkening*granulation,1.0);
      }`
  })
);
scene.add(sun);
const coronaCanvas = document.createElement('canvas');
coronaCanvas.width = 256; coronaCanvas.height = 256;
const coronaContext = coronaCanvas.getContext('2d')!;
const coronaGradient = coronaContext.createRadialGradient(128, 128, 0, 128, 128, 128);
coronaGradient.addColorStop(0, 'rgba(255,255,252,1)');
coronaGradient.addColorStop(.16, 'rgba(255,255,250,1)');
coronaGradient.addColorStop(.28, 'rgba(255,248,229,.72)');
coronaGradient.addColorStop(.48, 'rgba(255,220,170,.12)');
coronaGradient.addColorStop(.76, 'rgba(168,190,220,.012)');
coronaGradient.addColorStop(1, 'rgba(0,0,0,0)');
coronaContext.fillStyle = coronaGradient;
coronaContext.fillRect(0, 0, 256, 256);
const coronaTexture = new THREE.CanvasTexture(coronaCanvas);
const sunCorona = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: coronaTexture, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false })
);
sunCorona.scale.set(sunRadius * 4, sunRadius * 4, 1);
scene.add(sunCorona);

// A restrained camera starburst: the physical solar disc above stays unchanged while this
// additive optical layer approximates diffraction and sensor bloom in orbital photography.
const starburstCanvas = document.createElement('canvas');
starburstCanvas.width = 512; starburstCanvas.height = 512;
const starburstContext = starburstCanvas.getContext('2d')!;
starburstContext.translate(256, 256);
for (let rayIndex = 0; rayIndex < 16; rayIndex += 1) {
  const isPrimary = rayIndex % 4 === 0;
  const isSecondary = rayIndex % 2 === 0;
  const rayLength = isPrimary ? 238 : isSecondary ? 154 : 92;
  const rayWidth = isPrimary ? 5.2 : isSecondary ? 2.7 : 1.25;
  const rayGradient = starburstContext.createLinearGradient(5, 0, rayLength, 0);
  rayGradient.addColorStop(0, `rgba(255,252,241,${isPrimary ? .55 : .3})`);
  rayGradient.addColorStop(.12, `rgba(255,247,224,${isPrimary ? .2 : .1})`);
  rayGradient.addColorStop(1, 'rgba(255,210,150,0)');
  starburstContext.save();
  starburstContext.rotate(rayIndex * Math.PI / 8);
  starburstContext.fillStyle = rayGradient;
  starburstContext.beginPath();
  starburstContext.moveTo(4, -rayWidth);
  starburstContext.lineTo(rayLength, 0);
  starburstContext.lineTo(4, rayWidth);
  starburstContext.closePath();
  starburstContext.fill();
  starburstContext.restore();
}
const starburstCore = starburstContext.createRadialGradient(0, 0, 0, 0, 0, 58);
starburstCore.addColorStop(0, 'rgba(255,255,248,.95)');
starburstCore.addColorStop(.22, 'rgba(255,252,235,.82)');
starburstCore.addColorStop(.48, 'rgba(255,208,132,.16)');
starburstCore.addColorStop(1, 'rgba(0,0,0,0)');
starburstContext.fillStyle = starburstCore;
starburstContext.beginPath(); starburstContext.arc(0, 0, 104, 0, Math.PI * 2); starburstContext.fill();
const starburstTexture = new THREE.CanvasTexture(starburstCanvas);
const sunStarburst = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: starburstTexture, transparent: true, opacity: .68, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false })
);
sunStarburst.scale.set(sunRadius * 10, sunRadius * 10, 1);
scene.add(sunStarburst);
const sunOpticsPosition = new THREE.Vector3();

function flareTexture(kind: 'soft' | 'ring', color: [number, number, number]) {
  const flareCanvas = document.createElement('canvas'); flareCanvas.width = 256; flareCanvas.height = 256;
  const context = flareCanvas.getContext('2d')!; const [red, green, blue] = color;
  const gradient = context.createRadialGradient(128, 128, kind === 'ring' ? 63 : 0, 128, 128, 128);
  if (kind === 'ring') {
    gradient.addColorStop(0, `rgba(${red},${green},${blue},0)`); gradient.addColorStop(.38, `rgba(${red},${green},${blue},.03)`);
    gradient.addColorStop(.55, `rgba(${red},${green},${blue},.15)`); gradient.addColorStop(.69, `rgba(${red},${green},${blue},.025)`);
  } else {
    gradient.addColorStop(0, `rgba(${red},${green},${blue},.22)`); gradient.addColorStop(.28, `rgba(${red},${green},${blue},.06)`);
  }
  gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`); context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(flareCanvas);
}

const lensFlareGhosts = [
  { factor: -.3, scale: .48, opacity: .16, sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTexture('soft', [166, 207, 255]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false })) },
  { factor: -.66, scale: .31, opacity: .1, sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTexture('ring', [255, 198, 132]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false })) },
  { factor: .22, scale: .2, opacity: .08, sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTexture('soft', [180, 232, 226]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false })) },
];
lensFlareGhosts.forEach(({ sprite }) => { sprite.renderOrder = 20; scene.add(sprite); });
const sunScreenPosition = new THREE.Vector3();
const flareDirection = new THREE.Vector3();
let skyExposure = .1;

function radians(value: number) { return value * Math.PI / 180; }
function latLonVector(latitude: number, longitude: number, radius: number) {
  const phi = radians(90 - latitude); const theta = radians(longitude + 180);
  return new THREE.Vector3(-radius*Math.sin(phi)*Math.cos(theta),radius*Math.cos(phi),radius*Math.sin(phi)*Math.sin(theta));
}

const celestialRotationMatrix = new THREE.Matrix4();
function applyCelestialRotation(object: THREE.Object3D, matrix: readonly number[]) {
  celestialRotationMatrix.set(
    matrix[0], matrix[1], matrix[2], 0,
    matrix[3], matrix[4], matrix[5], 0,
    matrix[6], matrix[7], matrix[8], 0,
    0, 0, 0, 1,
  );
  object.quaternion.setFromRotationMatrix(celestialRotationMatrix);
}

const takeInitialCameraPosition = createOneTimeInertialCameraPlacement(fixedSceneView);
const takeGoldenCameraPose = goldenScene ? createOneTimeOrbitalGoldenCameraPlacement(goldenScene) : null;
function updateCelestialScene(now: Date) {
  const frame = celestialSceneFrameAt(now);
  const solar = frame.astronomy.sun;
  // The Earth body rotates in EQJ while the camera and Hipparcos/Gaia sky remain inertial.
  applyCelestialRotation(planet, frame.earth.bodyToSceneMatrix);
  const sunDirection = new THREE.Vector3(...frame.sun.inertialDirection);
  const goldenPose = takeGoldenCameraPose?.(frame) ?? null;
  const initialCameraPosition = goldenScene ? goldenPose?.position ?? null : takeInitialCameraPosition(frame);
  if (initialCameraPosition) {
    // Place the observer just outside the Sun–Earth occultation cone. The real, 0.53° solar disc
    // sits beyond the atmospheric limb. This placement happens once: afterwards the observer
    // remains inertial while Earth rotates and the Sun advances through the EQJ sky.
    camera.position.fromArray(initialCameraPosition);
    const cameraTarget = goldenPose?.target ?? [0, 0, 0];
    camera.lookAt(...cameraTarget);
    controls.target.fromArray(cameraTarget);
  }
  earthMaterial.uniforms.sunDirection.value.copy(sunDirection);
  earthMaterial.uniforms.sunLocalDirection.value.set(...frame.sun.earthFixedDirection);
  cloudMaterial.uniforms.sunDirection.value.copy(sunDirection);
  (atmosphere.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirection);
  sun.position.copy(sunDirection).multiplyScalar(frame.sun.distanceEarthRadii);
  const moonDirection = new THREE.Vector3(...frame.moon.inertialDirection);
  moon.position.copy(moonDirection).multiplyScalar(frame.moon.distanceEarthRadii);
  applyCelestialRotation(moon, frame.moon.bodyToSceneMatrix);
  moonMaterial.uniforms.sunDirection.value.copy(sunDirection);
  // Put camera optics just in front of the solar sphere so the sphere cannot depth-mask them;
  // Earth remains vastly nearer and therefore still occludes the complete optical effect.
  // A generous camera-space separation avoids far-plane depth quantization masking the
  // translucent glare sprites; Earth is still thousands of radii nearer and occludes them.
  sunOpticsPosition.copy(camera.position).sub(sun.position).normalize().multiplyScalar(sunRadius * 20).add(sun.position);
  sunCorona.position.copy(sunOpticsPosition);
  sunStarburst.position.copy(sunOpticsPosition);
  sunScreenPosition.copy(sun.position).project(camera);
  const photograph = orbitalPhotographyState({
    cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
    sunPosition: [sun.position.x, sun.position.y, sun.position.z],
    sunRadius,
    moonPosition: [moon.position.x, moon.position.y, moon.position.z],
    moonRadius: MOON_EQUATORIAL_RADIUS_KM / EARTH_EQUATORIAL_RADIUS_KM,
    sunNdc: [sunScreenPosition.x, sunScreenPosition.y, sunScreenPosition.z],
  });
  const coronaMaterial = sunCorona.material as THREE.SpriteMaterial;
  const starburstMaterial = sunStarburst.material as THREE.SpriteMaterial;
  coronaMaterial.opacity = photograph.optics.bloomStrength * .84;
  starburstMaterial.opacity = photograph.optics.diffractionStrength * .58;
  sunCorona.visible = photograph.optics.bloomStrength > .001;
  sunStarburst.visible = photograph.optics.diffractionStrength > .001;
  lensFlareGhosts.forEach(({ factor, scale, opacity, sprite }) => {
    const ndc = new THREE.Vector3(sunScreenPosition.x * factor, sunScreenPosition.y * factor, .2).unproject(camera);
    flareDirection.copy(ndc).sub(camera.position).normalize();
    sprite.position.copy(camera.position).addScaledVector(flareDirection, 30); sprite.scale.setScalar(scale);
    (sprite.material as THREE.SpriteMaterial).opacity = opacity * photograph.optics.flareStrength;
    sprite.visible = photograph.optics.flareStrength > .001;
  });
  // Human eyes and ordinary cameras cannot expose a direct Sun and a rich Milky Way at once.
  skyExposure = THREE.MathUtils.lerp(skyExposure, photograph.exposure.milkyWay, photograph.sun.inFrame ? .045 : .012);
  milkyWayMaterial.uniforms.exposure.value = skyExposure;
  if (starMaterial) starMaterial.uniforms.exposure.value = photograph.exposure.stars;
  const zone=new Intl.DateTimeFormat(undefined,{timeZoneName:'short'}).formatToParts(now).find(part=>part.type==='timeZoneName')?.value ?? 'local';
  clock.textContent=new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'medium'}).format(now)+` ${zone}`;
  sunStatus.textContent=`Sun over ${Math.abs(solar.subsolarLatitudeDegrees).toFixed(1)}°${solar.subsolarLatitudeDegrees>=0?'N':'S'}, ${Math.abs(solar.subsolarLongitudeDegrees).toFixed(1)}°${solar.subsolarLongitudeDegrees>=0?'E':'W'} · ${weatherFeed(now)} · Earth rotates beneath an inertial EQJ sky · Stars: ESA Hipparcos-2 · Sky: ESA/Gaia/DPAC · CDS HiPS/hips2fits${goldenScene ? ` · Golden scene: ${goldenScene.id}` : ''}`;
}

window.addEventListener('resize',()=>{camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);if(starMaterial)starMaterial.uniforms.pixelRatio.value=renderer.getPixelRatio();});
function disposeReplacedTexture(previous: THREE.Texture, replacement: THREE.Texture) {
  if (previous !== replacement) previous.dispose();
}

async function decodeSeasonalFrame(frame: { month: number; value: LoadedSceneAsset }) {
  if (frame.value instanceof THREE.Texture) return frame.value;
  if (!isDeferredSceneTexture(frame.value)) throw new Error(`Earth-state seasonal frame ${frame.month} is not a texture source`);
  const loaded = await decodeSceneAsset(frame.value.request, frame.value.bytes, frame.value.mediaType);
  return requireTexture(loaded.value, `surfaceAlbedo month ${frame.month}`);
}

seasonalSurfaceController = createSeasonalSurfaceController<THREE.Texture, LoadedSceneAsset>({
  initialTextures: [dayMap],
  decodeFrame: decodeSeasonalFrame,
  installPair({ from, to, mix }) {
    earthMaterial.uniforms.dayMapFrom.value = from;
    earthMaterial.uniforms.dayMapTo.value = to;
    earthMaterial.uniforms.seasonalMix.value = mix;
  },
  disposeTexture(texture) { texture.dispose(); },
  onError(error) { console.warn('TheMarble retained the previous seasonal surface after a rollover decode failure.', error); },
});

applyVerifiedLayer = (name, asset) => {
  const map = requireTexture(asset, name);
  if (name === 'nightLights') {
    const previous = earthMaterial.uniforms.nightMap.value;
    earthMaterial.uniforms.nightMap.value = map;
    disposeReplacedTexture(previous, map);
  } else if (name === 'snowCover') {
    const previous = earthMaterial.uniforms.snowCoverMap.value;
    earthMaterial.uniforms.snowCoverMap.value = map;
    if (previous !== snowCoverMap) disposeReplacedTexture(previous, map);
  } else if (name === 'seaIce') {
    const previous = earthMaterial.uniforms.seaIceMap.value;
    earthMaterial.uniforms.seaIceMap.value = map;
    if (previous !== seaIceMap) disposeReplacedTexture(previous, map);
  }
};
applyVerifiedResource = (name, asset) => {
  if (name === 'moonAlbedo') {
    const map = requireTexture(asset, name);
    const previous = moonMaterial.uniforms.moonMap.value;
    moonMaterial.uniforms.moonMap.value = map;
    disposeReplacedTexture(previous, map);
  } else if (name === 'milkyWay') {
    const map = requireTexture(asset, name);
    const previous = milkyWayMaterial.uniforms.map.value;
    milkyWayMaterial.uniforms.map.value = map;
    disposeReplacedTexture(previous, map);
  }
  else if (name === 'starCatalog') loadHipparcosStars(requireStarCatalog(asset));
};
updateFrame = () => {
  const now = sceneNow();
  seasonalSurfaceController.update(now);
  cloudObservationController.update(now);
  updateCelestialScene(now);
};
}
