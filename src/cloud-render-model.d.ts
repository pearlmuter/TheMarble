export const CLOUD_RENDER_GLSL: string;
export const ASSUMED_THICK_CLOUD_OPTICAL_DEPTH: number;
export const ASSUMED_THICKNESS_CURVATURE: number;
export const NIGHT_CLOUD_MOONLIGHT_TINT: readonly [number, number, number];
export const NIGHT_CLOUD_MOONLIGHT_SCALE: number;
export const NIGHT_CLOUD_AIRGLOW_TINT: readonly [number, number, number];
export const NIGHT_CLOUD_AIRGLOW_SCALE: number;
export const NIGHT_CLOUD_UPWELLING_SCALE: number;
export const NIGHT_CLOUD_UPWELLING_SPREAD_UV: readonly [number, number];
export const CLOUD_ALTITUDE_PROBES_KM: readonly number[];
export const NIGHT_SURFACE_WASH_TINT: readonly [number, number, number];
export const ASSUMED_CLOUD_BASE_KM: number;
export const ASSUMED_CLOUD_RELIEF_KM: number;
export const ASSUMED_CLOUD_HEIGHT_CURVATURE: number;
export const CLOUD_RELIEF_SAMPLE_UV: number;
export const CLOUD_RELIEF_EXAGGERATION: number;
export const EARTH_RADIUS_KM: number;
export const CLOUD_RELIEF_WRAP: number;
export const MINIMUM_CLOUD_SHADOW: number;
export const MAXIMUM_CLOUD_SHADOW: number;
export function cloudTopHeightKm(opticalDepth: number, retrievedHeightKm?: number, retrieved?: number): number;
export function emittedNightLight(sampled: readonly number[]): number[];
export function sphereUv(direction: [number, number, number]): [number, number];
export function shadowCasterUv(surfaceDirection: [number, number, number], sunDirection: [number, number, number], heightKm: number): [number, number];
export function discoverCloudCaster(
  surfaceDirection: [number, number, number],
  sunDirection: [number, number, number],
  samplePhysics: (uv: [number, number]) => { heightKm: number; quality: number },
): { heightKm: number; quality: number; score: number };
export function assumedCloudOpticalDepth(alpha: number): number;
export function nightCloudIllumination(input: {
  moonLambert?: number; moonIllumination?: number; upwelling?: readonly number[];
}): number[];
export function cityLightTransmission(opticalDepth: number, quality: number): number;
export function cloudShadowStrength(input: { casterAlpha: number; casterOpticalDepth: number; casterQuality: number; casterDensity: number; daylight: number }): number;
