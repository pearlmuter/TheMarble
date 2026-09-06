// Local nadir scale of a perspective camera looking at the centre of a unit Earth.
// CSS pixels make this independent of Retina/device pixel ratio. The equivalent
// tile zoom is normalized to the equator so rotating to a pole cannot change it.
export const MAX_EARTH_MAP_ZOOM = 5.35;

export function orbitMapScale({ distanceEarthRadii, verticalFovDegrees, viewportHeightCssPixels, earthRadiusMeters = 6378137 }) {
  if (![distanceEarthRadii, verticalFovDegrees, viewportHeightCssPixels, earthRadiusMeters].every(Number.isFinite)
    || distanceEarthRadii <= 1 || verticalFovDegrees <= 0 || verticalFovDegrees >= 180
    || viewportHeightCssPixels <= 0 || earthRadiusMeters <= 0) return undefined;
  const altitudeMeters = (distanceEarthRadii - 1) * earthRadiusMeters;
  const metersPerPixel = 2 * altitudeMeters * Math.tan(verticalFovDegrees * Math.PI / 360) / viewportHeightCssPixels;
  return {
    zoom: Math.log2(2 * Math.PI * earthRadiusMeters / (256 * metersPerPixel)),
    metersPerPixel,
    altitudeKm: altitudeMeters / 1000,
  };
}

export function orbitDistanceForMapZoom({ zoom, verticalFovDegrees, viewportHeightCssPixels }) {
  const reference = orbitMapScale({ distanceEarthRadii: 2, verticalFovDegrees, viewportHeightCssPixels });
  if (!reference || !Number.isFinite(zoom)) return undefined;
  return 1 + 2 ** (reference.zoom - zoom);
}
