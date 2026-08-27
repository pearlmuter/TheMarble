export const CLOUD_RENDER_GLSL: string;
export const CLOUD_ALTITUDE_PROBES_KM: readonly number[];
export function sphereUv(direction: [number, number, number]): [number, number];
export function shadowCasterUv(surfaceDirection: [number, number, number], sunDirection: [number, number, number], heightKm: number): [number, number];
export function discoverCloudCaster(
  surfaceDirection: [number, number, number],
  sunDirection: [number, number, number],
  samplePhysics: (uv: [number, number]) => { heightKm: number; quality: number },
): { heightKm: number; quality: number; score: number };
export function cityLightTransmission(opticalDepth: number, quality: number): number;
export function cloudShadowStrength(input: { casterAlpha: number; casterOpticalDepth: number; casterQuality: number; casterDensity: number; daylight: number }): number;
