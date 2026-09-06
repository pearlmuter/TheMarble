export interface OrbitMapScale { zoom: number; metersPerPixel: number; altitudeKm: number }
export const MAX_EARTH_MAP_ZOOM: number;
export function orbitDistanceForMapZoom(input: { zoom: number; verticalFovDegrees: number; viewportHeightCssPixels: number }): number | undefined;
export function orbitMapScale(input: { distanceEarthRadii: number; verticalFovDegrees: number; viewportHeightCssPixels: number; earthRadiusMeters?: number }): OrbitMapScale | undefined;
