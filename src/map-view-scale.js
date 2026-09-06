// Local nadir scale of a perspective camera looking at the centre of a unit Earth.
// CSS pixels make this independent of Retina/device pixel ratio. The equivalent
// tile zoom is normalized to the equator so rotating to a pole cannot change it.
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
