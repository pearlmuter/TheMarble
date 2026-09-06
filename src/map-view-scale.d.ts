export interface OrbitMapScale { zoom: number; metersPerPixel: number; altitudeKm: number }
export function orbitMapScale(input: { distanceEarthRadii: number; verticalFovDegrees: number; viewportHeightCssPixels: number; earthRadiusMeters?: number }): OrbitMapScale | undefined;
