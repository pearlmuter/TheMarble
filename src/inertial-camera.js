const EARTH_RADIUS_KM = 6371;
// The International Space Station orbits near 408 km; on a unit Earth that is
// the closest a crewed viewpoint gets.
export const ISS_ORBIT_RADII = 1 + 408 / EARTH_RADIUS_KM;

/**
 * Near plane and zoom step for a camera that ranges from orbit to the ISS.
 *
 * A fixed near plane cannot serve both: 0.1 clips everything below about 640 km,
 * while a near small enough for the ISS collapses depth precision against a far
 * plane that has to reach the Sun. Scaling both to the altitude the camera
 * already holds keeps the surface visible and the zoom step proportionate.
 */
export function cameraClippingForAltitude(distanceFromCentre) {
  const altitude = Math.max(distanceFromCentre - 1, 1e-4);
  return {
    altitude,
    near: Math.min(.1, Math.max(altitude * .02, 2e-4)),
    zoomSpeed: Math.max(.25, Math.min(1, altitude * .6)),
  };
}

const DEFAULT_OBSERVER_DISTANCE = 7;
const DEFAULT_SOLAR_LIMB_CLEARANCE_DEGREES = 0.36;

function radians(degrees) {
  return degrees * Math.PI / 180;
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function scale(vector, factor) {
  return vector.map(value => value * factor);
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
}

export function initialInertialCameraPosition(frame, view = 'night') {
  const sunDirection = frame.sun.inertialDirection;
  const rightTangent = normalize(cross([0, 1, 0], sunDirection));
  const upTangent = normalize(cross(sunDirection, rightTangent));
  const tangent = normalize(add(scale(rightTangent, 0.72), scale(upTangent, 0.69)));
  const solarSeparation = Math.asin(1 / DEFAULT_OBSERVER_DISTANCE) + radians(DEFAULT_SOLAR_LIMB_CLEARANCE_DEGREES);
  const observerDirection = view === 'day'
    ? sunDirection
    : view === 'terminator'
      ? tangent
      : add(scale(sunDirection, -Math.cos(solarSeparation)), scale(tangent, Math.sin(solarSeparation)));
  return scale(normalize(observerDirection), DEFAULT_OBSERVER_DISTANCE);
}

export function createOneTimeInertialCameraPlacement(view = 'night') {
  let placed = false;
  return frame => {
    if (placed) return null;
    placed = true;
    return initialInertialCameraPosition(frame, view);
  };
}
