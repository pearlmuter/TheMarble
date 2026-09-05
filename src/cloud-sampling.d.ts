export const CLOUD_SAMPLING_GLSL: string;
export function cloudRenderCoverage(coverage?: { latitudeRange?: [number, number]; modelAssistedFraction?: number; fallbackFraction?: number }): [number, number];
export function cloudCoverageWeight(latitude: number, band: readonly [number, number]): number;
