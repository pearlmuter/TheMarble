export const GROUND_RADIUS: number;
export const ATMOSPHERE_RADIUS: number;
export const RAYLEIGH_SCALE_HEIGHT: number;
export const MIE_SCALE_HEIGHT: number;
export const OZONE_PEAK_ALTITUDE: number;
export const OZONE_HALF_WIDTH: number;
export const BETA_RAYLEIGH: readonly [number, number, number];
export const BETA_MIE_SCATTERING: readonly [number, number, number];
export const BETA_MIE_EXTINCTION: readonly [number, number, number];
export const BETA_OZONE: readonly [number, number, number];
export const MIE_ASYMMETRY: number;
export const SOLAR_IRRADIANCE: number;
export const ATMOSPHERE_MARCH_STEPS: number;
export const ATMOSPHERE_MARCH_CURVATURE: number;
export const TRANSMITTANCE_LUT_WIDTH: number;
export const TRANSMITTANCE_LUT_HEIGHT: number;
export const TRANSMITTANCE_LUT_SAMPLES: number;

export function rayleighDensity(altitude: number): number;
export function mieDensity(altitude: number): number;
export function ozoneDensity(altitude: number): number;
export function distanceToTopAtmosphere(r: number, mu: number): number;
export function rayIntersectsGround(r: number, mu: number): boolean;
export function transmittanceUv(r: number, mu: number): [number, number];
export function transmittanceRMu(u: number, v: number): { r: number; mu: number };
export function opticalDepthToTopAtmosphere(r: number, mu: number, samples?: number): number[];
export function transmittanceToTopAtmosphere(r: number, mu: number, samples?: number): number[];
export function transmittanceOverSegment(
  sample: (r: number, mu: number) => number[],
  r: number,
  mu: number,
  distance: number,
  intersectsGround: boolean,
): number[];
export function marchDistance(u: number, t0: number, tc: number, t1: number, curvature?: number): number;
export function closestApproach(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  t0: number,
  t1: number,
): number;
export function rayleighPhase(mu: number): number;
export function miePhase(mu: number, g?: number): number;

export const ATMOSPHERE_MODEL_GLSL: string;
export const ATMOSPHERE_TRANSMITTANCE_GLSL: string;
export const TRANSMITTANCE_LUT_FRAGMENT_SHADER: string;
