import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadEarthStateJsonDocument } from './earth-state-document.js';
import { createEarthStateActivator, EARTH_STATE_REQUIRED_LAYERS, EARTH_STATE_REQUIRED_RESOURCES } from './earth-state.js';
import type { ActivatedEarthState, EarthStateLayerName, EarthStateResourceName } from './earth-state.js';
import './style.css';

type HipparcosPayload = { stars: Array<[number, number, number, number]> };
type CloudDensityPayload = { width: number; height: number; rgba: number[] };
type LoadedSceneAsset = THREE.Texture | HipparcosPayload;

function isHipparcosPayload(value: unknown): value is HipparcosPayload {
  if (typeof value !== 'object' || value === null || !('stars' in value) || !Array.isArray(value.stars)) return false;
  return value.stars.every(star => Array.isArray(star) && star.length === 4 && star.every(Number.isFinite));
}

function isCloudDensityPayload(value: unknown): value is CloudDensityPayload {
  if (typeof value !== 'object' || value === null || !('width' in value) || !('height' in value) || !('rgba' in value)) return false;
  const { width, height, rgba } = value;
  return typeof width === 'number' && typeof height === 'number' && Number.isSafeInteger(width) && Number.isSafeInteger(height) && Array.isArray(rgba)
    && rgba.length === width * height * 4
    && rgba.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255);
}

function verifyTextureDimensions(map: THREE.Texture, descriptor: { dimensions?: { width: number; height: number } }, name: string) {
  if (!descriptor.dimensions) return;
  const image = map.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const width = image.naturalWidth ?? image.width;
  const height = image.naturalHeight ?? image.height;
  if (width !== descriptor.dimensions.width || height !== descriptor.dimensions.height) {
    throw new Error(`Earth-state asset dimensions mismatch for ${name}`);
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#globe')!;
const clock = document.querySelector<HTMLElement>('#clock')!;
const sunStatus = document.querySelector<HTMLElement>('#sun-status')!;
const loading = document.querySelector<HTMLElement>('#loading')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
// A full-Earth orbital view: Earth stays jewel-sized while the Sun retains its true 0.53° disc.
const camera = new THREE.PerspectiveCamera(22, window.innerWidth / window.innerHeight, .1, 30000);
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
};
const previewResources: Record<EarthStateResourceName, LoadedSceneAsset> = {
  moonAlbedo: solidTexture(38, 38, 38),
  milkyWay: solidTexture(0, 0, 0, 0),
  starCatalog: { stars: [] },
};
let applyVerifiedLayer: (name: EarthStateLayerName, asset: LoadedSceneAsset) => void = () => undefined;
let applyVerifiedResource: (name: EarthStateResourceName, asset: LoadedSceneAsset) => void = () => undefined;
let weatherFeed = 'loading bundled Earth state';

const earthStateActivator = createEarthStateActivator<LoadedSceneAsset>({
  loadDocument: loadEarthStateJsonDocument,
  async loadAsset({ name, descriptor, url }, { signal }) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Earth-state asset unavailable (${response.status}): ${url}`);
    const responseMediaType = response.headers.get('content-type')?.split(';', 1)[0];
    if (responseMediaType && responseMediaType !== descriptor.asset.mediaType) {
      throw new Error(`Earth-state asset media type mismatch for ${name}`);
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (descriptor.asset.mediaType.includes('json')) {
      const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
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
    const objectUrl = URL.createObjectURL(new Blob([buffer], { type: descriptor.asset.mediaType }));
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
  },
});

function applyActivatedEarthState(activeEarthState: ActivatedEarthState<LoadedSceneAsset>) {
  for (const name of EARTH_STATE_REQUIRED_LAYERS) applyVerifiedLayer(name, activeEarthState.layers[name]);
  for (const name of EARTH_STATE_REQUIRED_RESOURCES) applyVerifiedResource(name, activeEarthState.resources[name]);
  const cloudDataset = activeEarthState.layerDatasets.cloudOpacity;
  weatherFeed = `${activeEarthState.manifest.classification.replace('-', ' ')} · ${cloudDataset.version}`;
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
const latestEarthStateUrl = new URL('/earth-state/latest.json', window.location.href).href;
let latestRefreshInFlight = false;
async function refreshLatestEarthState() {
  if (latestRefreshInFlight) return;
  latestRefreshInFlight = true;
  try {
    const previous = earthStateActivator.current;
    const activeEarthState = await earthStateActivator.activateLatest(latestEarthStateUrl);
    if (activeEarthState !== previous) applyActivatedEarthState(activeEarthState);
  } catch {
    // Missing or invalid production state is an expected fallback condition. Keep the verified globe.
  } finally {
    latestRefreshInFlight = false;
  }
}

void earthStateActivator.activate(
  new URL('/earth-state/bundled-v1.json', window.location.href).href,
).then(activeEarthState => {
  applyActivatedEarthState(activeEarthState);
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
    dayMap: { value: dayMap }, nightMap: { value: nightMap }, cloudMap: { value: cloudMap }, liveWeatherMap: { value: liveWeatherMap },
    sunDirection: { value: new THREE.Vector3(1, 0, 0) }
  },
  vertexShader: `varying vec2 vUv; varying vec3 vViewNormal; varying vec3 vViewPosition; void main(){ vUv=uv; vViewNormal=normalize(normalMatrix*normal); vViewPosition=(modelViewMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*vec4(vViewPosition,1.0); }`,
  fragmentShader: `
    uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap; uniform sampler2D liveWeatherMap; uniform vec3 sunDirection;
    varying vec2 vUv; varying vec3 vViewNormal; varying vec3 vViewPosition;
    void main() {
      vec3 normal=normalize(vViewNormal); vec3 viewDirection=normalize(-vViewPosition); vec3 sunView=normalize((viewMatrix*vec4(sunDirection,0.0)).xyz); float solar=dot(normal,sunView);
      float daylight=smoothstep(-.075,.14,solar); float directLight=.48+1.22*smoothstep(-.08,.72,solar);
      float zenithDegrees=degrees(acos(clamp(solar,0.0,1.0))); float airMass=1.0/(max(solar,0.0)+.50572*pow(max(96.07995-zenithDegrees,.01),-1.6364));
      vec3 sunlight=exp(-vec3(.04,.07,.15)*min(airMass,38.0));
      vec3 surface=texture2D(dayMap,vUv).rgb; vec3 day=surface*directLight*1.22*mix(vec3(1.0),sunlight,.82);
      vec4 weather=texture2D(liveWeatherMap,vUv); float weatherDensity=mix(1.0,mix(.7,1.2,weather.r),weather.g*.26);
      float cloudShadow=texture2D(cloudMap,vUv+vec2(sunDirection.z,-sunDirection.x)*.0028).a*weatherDensity;
      day*=1.0-cloudShadow*daylight*.18;
      float ocean=smoothstep(.015,.16,surface.b-max(surface.r,surface.g));
      float sunGlint=pow(max(dot(reflect(-sunView,normal),viewDirection),0.0),110.0)*ocean*daylight;
      day+=vec3(1.0,.72,.38)*sunGlint*2.4;
      float nightFalloff=1.0-smoothstep(-.12,.025,solar);
      vec3 night=texture2D(nightMap,vUv).rgb*nightFalloff*1.8;
      gl_FragColor=vec4(mix(night,day,daylight),1.0);
    }
  `
});
const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 192), earthMaterial);
planet.add(earth);

const cloudMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { cloudMap: { value: cloudMap }, liveWeatherMap: { value: liveWeatherMap }, sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
  vertexShader: `varying vec2 vUv; varying vec3 vViewNormal; varying vec3 vViewPosition; void main(){ vUv=uv; vViewNormal=normalize(normalMatrix*normal); vViewPosition=(modelViewMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*vec4(vViewPosition,1.0); }`,
  fragmentShader: `uniform sampler2D cloudMap; uniform sampler2D liveWeatherMap; uniform vec3 sunDirection; varying vec2 vUv; varying vec3 vViewNormal; varying vec3 vViewPosition; void main(){ vec4 cloud=texture2D(cloudMap,vUv); vec4 weather=texture2D(liveWeatherMap,vUv); float density=mix(1.0,mix(.7,1.2,weather.r),weather.g*.26); vec3 sunView=normalize((viewMatrix*vec4(sunDirection,0.0)).xyz); vec3 viewDirection=normalize(-vViewPosition); float solarRaw=dot(normalize(vViewNormal),sunView); float solar=smoothstep(-.11,.17,solarRaw); float zenithDegrees=degrees(acos(clamp(solarRaw,0.0,1.0))); float airMass=1.0/(max(solarRaw,0.0)+.50572*pow(max(96.07995-zenithDegrees,.01),-1.6364)); vec3 sunlight=exp(-vec3(.04,.07,.15)*min(airMass,38.0)); float forward=max(-dot(viewDirection,sunView),0.0); float silver=pow(forward,18.0)*smoothstep(-.08,.25,solarRaw); vec3 litCloud=vec3(1.08,1.02,.93)*mix(vec3(1.0),sunlight,.88); vec3 cloudLight=mix(vec3(.025,.04,.07),litCloud,solar)+vec3(1.0,.56,.2)*silver*.62; gl_FragColor=vec4(cloud.rgb*cloudLight,cloud.a*density*.82); }`
});
// About 11 km above mean sea level: visibly detached at the limb, but still inside the atmosphere.
const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.00173, 192, 192), cloudMaterial);
planet.add(clouds);

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
        float tangentSun=dot(normalize(tangentPoint),lightDirection); float illuminated=smoothstep(-.055,.08,tangentSun);
        float forwardAureole=pow(max(mu,0.0),30.0);
        vec3 exposedLimb=vec3(.008,.16,1.05)*limbEnvelope*illuminated*.92;
        exposedLimb+=vec3(1.0,.36,.035)*limbEnvelope*illuminated*forwardAureole*.08;
        // Additive light carries its own physical intensity; an alpha derived from intensity
        // would multiply the already-dim limb a second time and erase it.
        vec3 color=radiance*13.0+exposedLimb; gl_FragColor=vec4(color,1.0);
      }`
  })
);
planet.add(atmosphere);

const moonMaterial = new THREE.ShaderMaterial({
  uniforms: { moonMap: { value: moonMap }, sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
  vertexShader: `varying vec2 vUv; varying vec3 vViewNormal; void main(){ vUv=uv; vViewNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D moonMap; uniform vec3 sunDirection; varying vec2 vUv; varying vec3 vViewNormal; void main(){ vec3 sunView=normalize((viewMatrix*vec4(sunDirection,0.0)).xyz); float light=smoothstep(-.07,.16,dot(normalize(vViewNormal),sunView)); vec3 albedo=texture2D(moonMap,vUv).rgb; gl_FragColor=vec4(albedo*mix(.014,1.0,light),1.0); }`
});
// Distances and radii below are expressed in Earth radii (Earth = 1.0).
const earthRadiusKm = 6371.0088;
const moon = new THREE.Mesh(new THREE.SphereGeometry(1737.4 / earthRadiusKm, 64, 64), moonMaterial);
scene.add(moon);
const sunDistance = 149597870.7 / earthRadiusKm; // mean Sun–Earth distance: 1 AU / Earth radius
const sunRadius = 696340 / earthRadiusKm;
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
coronaGradient.addColorStop(.32, 'rgba(255,255,248,1)');
coronaGradient.addColorStop(.45, 'rgba(255,247,226,.54)');
coronaGradient.addColorStop(.63, 'rgba(255,218,166,.09)');
coronaGradient.addColorStop(.84, 'rgba(168,190,220,.015)');
coronaGradient.addColorStop(1, 'rgba(0,0,0,0)');
coronaContext.fillStyle = coronaGradient;
coronaContext.fillRect(0, 0, 256, 256);
const coronaTexture = new THREE.CanvasTexture(coronaCanvas);
const sunCorona = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: coronaTexture, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false })
);
sunCorona.scale.set(sunRadius * 8, sunRadius * 8, 1);
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
const starburstCore = starburstContext.createRadialGradient(0, 0, 0, 0, 0, 104);
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
sunStarburst.scale.set(sunRadius * 18, sunRadius * 18, 1);
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
const cameraToSun = new THREE.Vector3();
const closestSunRayPoint = new THREE.Vector3();
let skyExposure = .1;

function radians(value: number) { return value * Math.PI / 180; }
function degrees(value: number) { return value * 180 / Math.PI; }
function wrap(value: number) { return ((value + 180) % 360 + 360) % 360 - 180; }
function julianDay(date: Date) { return date.getTime() / 86400000 + 2440587.5; }
function latLonVector(latitude: number, longitude: number, radius: number) {
  const phi = radians(90 - latitude); const theta = radians(longitude + 180);
  return new THREE.Vector3(-radius*Math.sin(phi)*Math.cos(theta),radius*Math.cos(phi),radius*Math.sin(phi)*Math.sin(theta));
}

function solarCoordinates(date: Date) {
  const d=julianDay(date)-2451545.0; const meanLongitude=(280.46+.9856474*d)%360;
  const meanAnomaly=radians((357.528+.9856003*d)%360);
  const eclipticLongitude=radians(meanLongitude+1.915*Math.sin(meanAnomaly)+.02*Math.sin(2*meanAnomaly));
  const obliquity=radians(23.439-.0000004*d);
  const rightAscension=degrees(Math.atan2(Math.cos(obliquity)*Math.sin(eclipticLongitude),Math.cos(eclipticLongitude)))/15;
  const latitude=degrees(Math.asin(Math.sin(obliquity)*Math.sin(eclipticLongitude)));
  const gmst=(18.697374558+24.06570982441908*d)%24;
  return { latitude, rightAscension, gmst, longitude: wrap((rightAscension-gmst)*15) };
}

function lunarCoordinates(date: Date) {
  const d=julianDay(date)-2451545.0;
  const meanLongitude=(218.316+13.176396*d)%360;
  const anomaly=(134.963+13.064993*d)%360;
  const elongation=(297.850+12.190749*d)%360;
  const latitudeArgument=(93.272+13.22935*d)%360;
  const longitude=radians(meanLongitude + 6.289*Math.sin(radians(anomaly)) + 1.274*Math.sin(radians(2*elongation-anomaly)) + .658*Math.sin(radians(2*elongation)) + .214*Math.sin(radians(2*anomaly)) - .186*Math.sin(radians((357.529+.98560028*d)%360)));
  const latitude=radians(5.128*Math.sin(radians(latitudeArgument)) + .280*Math.sin(radians(anomaly+latitudeArgument)) + .277*Math.sin(radians(anomaly-latitudeArgument)) + .173*Math.sin(radians(2*elongation-latitudeArgument)));
  const obliquity=radians(23.439-.0000004*d);
  const rightAscension=degrees(Math.atan2(Math.sin(longitude)*Math.cos(obliquity)-Math.tan(latitude)*Math.sin(obliquity),Math.cos(longitude)))/15;
  const declination=degrees(Math.asin(Math.sin(latitude)*Math.cos(obliquity)+Math.cos(latitude)*Math.sin(obliquity)*Math.sin(longitude)));
  const distanceKm=385000.56 - 20905.36*Math.cos(radians(anomaly)) - 3699.11*Math.cos(radians(2*elongation-anomaly)) - 2955.97*Math.cos(radians(2*elongation)) - 569.93*Math.cos(radians(2*anomaly));
  return { latitude: declination, rightAscension, distanceEarthRadii: distanceKm / earthRadiusKm };
}

let cameraTracksSun = true;
let pointerStart: { x: number; y: number } | undefined;
canvas.addEventListener('pointerdown', event => { pointerStart = { x: event.clientX, y: event.clientY }; }, { passive: true });
canvas.addEventListener('pointermove', event => {
  if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) cameraTracksSun = false;
}, { passive: true });
canvas.addEventListener('pointerup', () => { pointerStart = undefined; }, { passive: true });
canvas.addEventListener('pointercancel', () => { pointerStart = undefined; }, { passive: true });
canvas.addEventListener('wheel', () => { cameraTracksSun = false; }, { passive: true });
function updateCelestialScene(now: Date) {
  const solar=solarCoordinates(now);
  // Greenwich sidereal rotation turns Earth beneath the inertial Hipparcos/Gaia sky.
  planet.rotation.y=radians(solar.gmst*15);
  const sunDirection=latLonVector(solar.latitude,solar.rightAscension*15,1).normalize();
  if (cameraTracksSun) {
    // Place the observer just outside the Sun–Earth occultation cone. The real, 0.53° solar disc
    // sits beyond the atmospheric limb; the camera then remains still while Earth rotates below.
    const rightTangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDirection).normalize();
    const upTangent = new THREE.Vector3().crossVectors(sunDirection, rightTangent).normalize();
    const tangent = rightTangent.multiplyScalar(.72).addScaledVector(upTangent, .69).normalize();
    const observerDistance = 7;
    const solarSeparation = Math.asin(1 / observerDistance) + radians(.36);
    const observerDirection = sunDirection.clone().multiplyScalar(-Math.cos(solarSeparation)).addScaledVector(tangent, Math.sin(solarSeparation));
    camera.position.copy(observerDirection.multiplyScalar(observerDistance));
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
  }
  earthMaterial.uniforms.sunDirection.value.copy(sunDirection);
  cloudMaterial.uniforms.sunDirection.value.copy(sunDirection);
  (atmosphere.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirection);
  sun.position.copy(sunDirection).multiplyScalar(sunDistance);
  // Put camera optics just in front of the solar sphere so the sphere cannot depth-mask them;
  // Earth remains vastly nearer and therefore still occludes the complete optical effect.
  // A generous camera-space separation avoids far-plane depth quantization masking the
  // translucent glare sprites; Earth is still thousands of radii nearer and occludes them.
  sunOpticsPosition.copy(camera.position).sub(sun.position).normalize().multiplyScalar(sunRadius * 20).add(sun.position);
  sunCorona.position.copy(sunOpticsPosition);
  sunStarburst.position.copy(sunOpticsPosition);
  sunScreenPosition.copy(sun.position).project(camera);
  cameraToSun.copy(sun.position).sub(camera.position);
  const nearestFraction = THREE.MathUtils.clamp(-camera.position.dot(cameraToSun) / cameraToSun.lengthSq(), 0, 1);
  const sunEarthImpact = closestSunRayPoint.copy(camera.position).addScaledVector(cameraToSun, nearestFraction).length();
  const sunInFront = camera.getWorldDirection(flareDirection).dot(cameraToSun) > 0;
  const sunOcculted = nearestFraction > 0 && nearestFraction < 1 && sunEarthImpact < 1;
  const frameDistance = Math.max(Math.abs(sunScreenPosition.x), Math.abs(sunScreenPosition.y));
  const sunInFrame = sunInFront && sunScreenPosition.z > -1 && sunScreenPosition.z < 1 && frameDistance < 1.3;
  const flareStrength = sunInFrame && !sunOcculted ? 1 - THREE.MathUtils.smoothstep(frameDistance, .72, 1.3) : 0;
  sunCorona.visible = !sunOcculted && sunInFront;
  sunStarburst.visible = !sunOcculted && sunInFront;
  lensFlareGhosts.forEach(({ factor, scale, opacity, sprite }) => {
    const ndc = new THREE.Vector3(sunScreenPosition.x * factor, sunScreenPosition.y * factor, .2).unproject(camera);
    flareDirection.copy(ndc).sub(camera.position).normalize();
    sprite.position.copy(camera.position).addScaledVector(flareDirection, 30); sprite.scale.setScalar(scale);
    (sprite.material as THREE.SpriteMaterial).opacity = opacity * flareStrength; sprite.visible = flareStrength > .001;
  });
  // Human eyes and ordinary cameras cannot expose a direct Sun and a rich Milky Way at once.
  const targetSkyExposure = sunInFrame && !sunOcculted ? .09 : .72;
  skyExposure = THREE.MathUtils.lerp(skyExposure, targetSkyExposure, sunInFrame ? .045 : .012);
  milkyWayMaterial.uniforms.exposure.value = skyExposure;
  if (starMaterial) starMaterial.uniforms.exposure.value = THREE.MathUtils.lerp(.18, 1, skyExposure);
  const lunar=lunarCoordinates(now);
  const moonDirection=latLonVector(lunar.latitude,lunar.rightAscension*15,1).normalize();
  moon.position.copy(moonDirection).multiplyScalar(lunar.distanceEarthRadii);
  moon.lookAt(camera.position);
  moonMaterial.uniforms.sunDirection.value.copy(sunDirection);
  const zone=new Intl.DateTimeFormat(undefined,{timeZoneName:'short'}).formatToParts(now).find(part=>part.type==='timeZoneName')?.value ?? 'local';
  clock.textContent=new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'medium'}).format(now)+` ${zone}`;
  sunStatus.textContent=`Sun over ${Math.abs(solar.latitude).toFixed(1)}°${solar.latitude>=0?'N':'S'}, ${Math.abs(solar.longitude).toFixed(1)}°${solar.longitude>=0?'E':'W'} · ${weatherFeed} · Earth rotates beneath an inertial sky · Stars: ESA Hipparcos-2 · Sky: ESA/Gaia/DPAC · CDS HiPS/hips2fits`;
}

window.addEventListener('resize',()=>{camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);if(starMaterial)starMaterial.uniforms.pixelRatio.value=renderer.getPixelRatio();});
applyVerifiedLayer = (name, asset) => {
  const map = requireTexture(asset, name);
  if (name === 'surfaceAlbedo') earthMaterial.uniforms.dayMap.value = map;
  else if (name === 'nightLights') earthMaterial.uniforms.nightMap.value = map;
  else if (name === 'cloudOpacity') {
    earthMaterial.uniforms.cloudMap.value = map;
    cloudMaterial.uniforms.cloudMap.value = map;
  } else if (name === 'cloudDensity') {
    earthMaterial.uniforms.liveWeatherMap.value = map;
    cloudMaterial.uniforms.liveWeatherMap.value = map;
  }
};
applyVerifiedResource = (name, asset) => {
  if (name === 'moonAlbedo') moonMaterial.uniforms.moonMap.value = requireTexture(asset, name);
  else if (name === 'milkyWay') milkyWayMaterial.uniforms.map.value = requireTexture(asset, name);
  else if (name === 'starCatalog') loadHipparcosStars(requireStarCatalog(asset));
};
updateFrame = () => updateCelestialScene(new Date());
}
