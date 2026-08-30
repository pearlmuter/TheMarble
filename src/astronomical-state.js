import {
  Body,
  EquatorFromVector,
  GeoVector,
  Illumination,
  Libration,
  RotateVector,
  RotationAxis,
  Rotation_EQJ_EQD,
  Rotation_EQD_EQJ,
  SiderealTime,
} from 'astronomy-engine';

export const ASTRONOMICAL_UNIT_KM = 149_597_870.7;
export const EARTH_EQUATORIAL_RADIUS_KM = 6_378.137;
export const MOON_EQUATORIAL_RADIUS_KM = 1_737.4;
export const SUN_EQUATORIAL_RADIUS_KM = 695_700;

const radians = degrees => degrees * Math.PI / 180;
const degrees = radiansValue => radiansValue * 180 / Math.PI;
const normalizeDegrees = value => ((value % 360) + 360) % 360;
const wrapLongitude = value => ((value + 180) % 360 + 360) % 360 - 180;
const SCENE_FROM_EQJ = [
  1, 0, 0,
  0, 0, 1,
  0, -1, 0,
];

function normalizedVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return [vector.x / length, vector.y / length, vector.z / length];
}

function angularDiameterDegrees(radiusKm, distanceAu) {
  return degrees(2 * Math.asin(radiusKm / (distanceAu * ASTRONOMICAL_UNIT_KM)));
}

function northPolePositionAngleDegrees(target, pole) {
  const rightAscension = radians(target.ra * 15);
  const declination = radians(target.dec);
  const poleRightAscension = radians(pole.ra * 15);
  const poleDeclination = radians(pole.dec);
  const offset = poleRightAscension - rightAscension;
  return normalizeDegrees(degrees(Math.atan2(
    Math.sin(offset),
    Math.cos(declination) * Math.tan(poleDeclination) - Math.sin(declination) * Math.cos(offset),
  )));
}

function equatorOfDate(vector, date) {
  return EquatorFromVector(RotateVector(Rotation_EQJ_EQD(date), vector));
}

function matrixFromAstronomyRotation(rotation) {
  return [
    rotation.rot[0][0], rotation.rot[1][0], rotation.rot[2][0],
    rotation.rot[0][1], rotation.rot[1][1], rotation.rot[2][1],
    rotation.rot[0][2], rotation.rot[1][2], rotation.rot[2][2],
  ];
}

function multiplyMatrices(left, right) {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return left[row * 3] * right[column]
      + left[row * 3 + 1] * right[column + 3]
      + left[row * 3 + 2] * right[column + 6];
  });
}

function transposeMatrix(matrix) {
  return [matrix[0], matrix[3], matrix[6], matrix[1], matrix[4], matrix[7], matrix[2], matrix[5], matrix[8]];
}

function transformDirection(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function rotationAboutNorthPole(degreesValue) {
  const angle = radians(degreesValue);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine, -sine, 0, sine, cosine, 0, 0, 0, 1];
}

function lunarBodyToEqjMatrix(moon) {
  const rightAscension = radians(moon.northPoleRightAscensionHours * 15);
  const declination = radians(moon.northPoleDeclinationDegrees);
  const spin = radians(moon.primeMeridianAngleDegrees);
  const north = [Math.cos(declination) * Math.cos(rightAscension), Math.cos(declination) * Math.sin(rightAscension), Math.sin(declination)];
  const node = [-Math.sin(rightAscension), Math.cos(rightAscension), 0];
  const perpendicular = [
    node[1] * north[2] - node[2] * north[1],
    node[2] * north[0] - node[0] * north[2],
    node[0] * north[1] - node[1] * north[0],
  ];
  const prime = node.map((value, index) => Math.cos(spin) * value - Math.sin(spin) * perpendicular[index]);
  const west = node.map((value, index) => Math.sin(spin) * value + Math.cos(spin) * perpendicular[index]);
  return [
    prime[0], north[0], west[0],
    prime[1], north[1], west[1],
    prime[2], north[2], west[2],
  ];
}

export function astronomicalStateAt(date) {
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new TypeError('Astronomical state requires a valid Date.');
  }

  const sunVector = GeoVector(Body.Sun, date, true);
  const moonVector = GeoVector(Body.Moon, date, true);
  const sunEquatorial = EquatorFromVector(sunVector);
  const moonEquatorial = EquatorFromVector(moonVector);
  const sunOfDate = equatorOfDate(sunVector, date);
  const gastDegrees = SiderealTime(date) * 15;
  const moonLibration = Libration(date);
  const moonIllumination = Illumination(Body.Moon, date);
  const earthAxis = RotationAxis(Body.Earth, date);
  const moonAxis = RotationAxis(Body.Moon, date);

  return {
    time: date.toISOString(),
    earth: {
      greenwichApparentSiderealDegrees: normalizeDegrees(gastDegrees),
      northPoleInertialEqj: normalizedVector(earthAxis.north),
      primeMeridianAngleDegrees: normalizeDegrees(earthAxis.spin),
    },
    sun: {
      inertialDirectionEqj: normalizedVector(sunVector),
      rightAscensionHours: sunEquatorial.ra,
      declinationDegrees: sunEquatorial.dec,
      distanceAu: sunVector.Length(),
      angularDiameterDegrees: angularDiameterDegrees(SUN_EQUATORIAL_RADIUS_KM, sunVector.Length()),
      subsolarLatitudeDegrees: sunOfDate.dec,
      subsolarLongitudeDegrees: wrapLongitude(sunOfDate.ra * 15 - gastDegrees),
    },
    moon: {
      inertialDirectionEqj: normalizedVector(moonVector),
      rightAscensionHours: moonEquatorial.ra,
      declinationDegrees: moonEquatorial.dec,
      distanceAu: moonVector.Length(),
      angularDiameterDegrees: moonLibration.diam_deg,
      phaseAngleDegrees: moonIllumination.phase_angle,
      illuminatedFraction: moonIllumination.phase_fraction,
      librationLongitudeDegrees: moonLibration.elon,
      librationLatitudeDegrees: moonLibration.elat,
      northPoleRightAscensionHours: moonAxis.ra,
      northPoleDeclinationDegrees: moonAxis.dec,
      northPolePositionAngleDegrees: northPolePositionAngleDegrees(moonEquatorial, moonAxis),
      primeMeridianAngleDegrees: normalizeDegrees(moonAxis.spin),
    },
  };
}

export function celestialSceneFrameAt(date) {
  const astronomy = astronomicalStateAt(date);
  const eqdToEqj = matrixFromAstronomyRotation(Rotation_EQD_EQJ(date));
  const earthFixedToEqj = multiplyMatrices(
    eqdToEqj,
    rotationAboutNorthPole(astronomy.earth.greenwichApparentSiderealDegrees),
  );
  const earthBodyToScene = multiplyMatrices(
    multiplyMatrices(SCENE_FROM_EQJ, earthFixedToEqj),
    transposeMatrix(SCENE_FROM_EQJ),
  );
  const sunInertial = transformDirection(SCENE_FROM_EQJ, astronomy.sun.inertialDirectionEqj);
  const moonInertial = transformDirection(SCENE_FROM_EQJ, astronomy.moon.inertialDirectionEqj);
  const moonBodyToScene = multiplyMatrices(SCENE_FROM_EQJ, lunarBodyToEqjMatrix(astronomy.moon));

  return {
    time: astronomy.time,
    astronomy,
    sky: { inertialEqjToSceneMatrix: [...SCENE_FROM_EQJ] },
    earth: { bodyToSceneMatrix: earthBodyToScene },
    sun: {
      inertialDirection: sunInertial,
      earthFixedDirection: transformDirection(transposeMatrix(earthBodyToScene), sunInertial),
      distanceEarthRadii: astronomy.sun.distanceAu * ASTRONOMICAL_UNIT_KM / EARTH_EQUATORIAL_RADIUS_KM,
      angularDiameterDegrees: astronomy.sun.angularDiameterDegrees,
    },
    moon: {
      inertialDirection: moonInertial,
      distanceEarthRadii: astronomy.moon.distanceAu * ASTRONOMICAL_UNIT_KM / EARTH_EQUATORIAL_RADIUS_KM,
      angularDiameterDegrees: astronomy.moon.angularDiameterDegrees,
      bodyToSceneMatrix: moonBodyToScene,
    },
  };
}
