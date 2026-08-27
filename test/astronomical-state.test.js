import assert from 'node:assert/strict';
import test from 'node:test';
import { astronomicalStateAt, celestialSceneFrameAt } from '../src/astronomical-state.js';

const ECLIPSE_REFERENCE = new Date('2024-04-08T18:00:00.000Z');

function reference(expected, tolerance) {
  return { expected, tolerance };
}

const ASTRONOMICAL_REFERENCES = [
  {
    name: 'fixed eclipse instant',
    date: ECLIPSE_REFERENCE,
    // USNO GAST 07:09:56.1442; JPL Horizons DE441 geocentric ICRF values.
    earth: {
      greenwichApparentSiderealDegrees: reference(107.483934, 0.01),
    },
    sun: {
      rightAscensionHours: reference(1.172219, 0.004),
      declinationDegrees: reference(7.46025, 0.05),
      distanceAu: reference(1.001503576, 0.00005),
      angularDiameterDegrees: reference(0.532106, 0.002),
      subsolarLatitudeDegrees: reference(7.587028, 0.05),
      subsolarLongitudeDegrees: reference(-89.591267, 0.05),
    },
    moon: {
      rightAscensionHours: reference(1.151186, 0.004),
      declinationDegrees: reference(7.687917, 0.05),
      distanceAu: reference(0.002404986, 0.000002),
      angularDiameterDegrees: reference(0.553371, 0.003),
      phaseAngleDegrees: reference(179.6121, 0.15),
      illuminatedFraction: reference(0.0000113, 0.0002),
      librationLongitudeDegrees: reference(1.951469, 0.2),
      librationLatitudeDegrees: reference(-0.437737, 0.2),
      northPolePositionAngleDegrees: reference(339.2349, 0.5),
    },
  },
  {
    name: 'June solstice',
    date: new Date('2025-06-21T12:00:00.000Z'),
    // USNO GAST 05:59:45.2590; JPL Horizons DE441 geocentric ICRF values.
    earth: {
      greenwichApparentSiderealDegrees: reference(89.938579, 0.01),
    },
    sun: {
      rightAscensionHours: reference(6.001378, 0.004),
      declinationDegrees: reference(23.435972, 0.05),
      distanceAu: reference(1.016231612, 0.00005),
      angularDiameterDegrees: reference(0.524394, 0.002),
      subsolarLatitudeDegrees: reference(23.437833, 0.05),
      subsolarLongitudeDegrees: reference(0.464379, 0.05),
    },
    moon: {
      rightAscensionHours: reference(2.150403, 0.004),
      declinationDegrees: reference(16.73675, 0.05),
      distanceAu: reference(0.002439973, 0.000002),
      angularDiameterDegrees: reference(0.545436, 0.003),
      phaseAngleDegrees: reference(125.5661, 0.15),
      illuminatedFraction: reference(0.2091558, 0.002),
      librationLongitudeDegrees: reference(-2.298946, 0.2),
      librationLatitudeDegrees: reference(-4.537606, 0.2),
      northPolePositionAngleDegrees: reference(341.4902, 0.5),
    },
  },
];

function closeTo(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

for (const reference of ASTRONOMICAL_REFERENCES) {
  test(`astronomical state matches USNO and JPL Horizons at the ${reference.name}`, () => {
    const state = astronomicalStateAt(reference.date);
    for (const body of ['earth', 'sun', 'moon']) {
      for (const [property, expected] of Object.entries(reference[body])) {
        closeTo(state[body][property], expected.expected, expected.tolerance, `${reference.name} ${body} ${property}`);
      }
    }
  });
}

test('astronomical state rejects an invalid time instead of inventing a scene', () => {
  assert.throws(() => astronomicalStateAt(new Date(Number.NaN)), /valid date/i);
});

function transform(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function transpose(matrix) {
  return [matrix[0], matrix[3], matrix[6], matrix[1], matrix[4], matrix[7], matrix[2], matrix[5], matrix[8]];
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

test('one scene frame keeps the EQJ sky inertial while Earth completes one sidereal rotation', () => {
  const start = celestialSceneFrameAt(ECLIPSE_REFERENCE);
  const afterSiderealDay = celestialSceneFrameAt(new Date(ECLIPSE_REFERENCE.valueOf() + 86_164.0905 * 1_000));
  const afterQuarterDay = celestialSceneFrameAt(new Date(ECLIPSE_REFERENCE.valueOf() + 86_164.0905 * 250));
  const primeMeridian = [1, 0, 0];

  assert.deepEqual(afterSiderealDay.sky.inertialEqjToSceneMatrix, start.sky.inertialEqjToSceneMatrix);
  assert.deepEqual(afterQuarterDay.sky.inertialEqjToSceneMatrix, start.sky.inertialEqjToSceneMatrix);
  assert.ok(dot(
    transform(start.earth.bodyToSceneMatrix, primeMeridian),
    transform(afterSiderealDay.earth.bodyToSceneMatrix, primeMeridian),
  ) > 0.99999);
  assert.ok(Math.abs(dot(
    transform(start.earth.bodyToSceneMatrix, primeMeridian),
    transform(afterQuarterDay.earth.bodyToSceneMatrix, primeMeridian),
  )) < 0.001);
});

test('scene transforms preserve the fixed subsolar point and the observed lunar face', () => {
  const frame = celestialSceneFrameAt(ECLIPSE_REFERENCE);
  const sunLocal = frame.sun.earthFixedDirection;
  const subsolarLatitude = Math.asin(sunLocal[1]) * 180 / Math.PI;
  const subsolarLongitude = Math.atan2(-sunLocal[2], sunLocal[0]) * 180 / Math.PI;
  closeTo(subsolarLatitude, frame.astronomy.sun.subsolarLatitudeDegrees, 0.000001, 'scene subsolar latitude');
  closeTo(subsolarLongitude, frame.astronomy.sun.subsolarLongitudeDegrees, 0.000001, 'scene subsolar longitude');

  const earthFromMoon = frame.moon.inertialDirection.map(value => -value);
  const moonLocal = transform(transpose(frame.moon.bodyToSceneMatrix), earthFromMoon);
  const subobserverLatitude = Math.asin(moonLocal[1]) * 180 / Math.PI;
  const subobserverLongitude = Math.atan2(-moonLocal[2], moonLocal[0]) * 180 / Math.PI;
  closeTo(subobserverLongitude, 1.951469, 0.2, 'JPL lunar sub-observer longitude');
  closeTo(subobserverLatitude, -0.437737, 0.2, 'JPL lunar sub-observer latitude');
});
