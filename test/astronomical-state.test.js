import assert from 'node:assert/strict';
import test from 'node:test';
import { astronomicalStateAt, celestialSceneFrameAt } from '../src/astronomical-state.js';

const ECLIPSE_REFERENCE = new Date('2024-04-08T18:00:00.000Z');

function closeTo(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

test('astronomical state matches USNO and JPL Horizons at a fixed eclipse instant', () => {
  const state = astronomicalStateAt(ECLIPSE_REFERENCE);

  // USNO Greenwich apparent sidereal time: 07:09:56.1442.
  closeTo(state.earth.greenwichApparentSiderealDegrees, 107.483934, 0.01, 'GAST degrees');

  // JPL Horizons DE441 geocentric ICRF values, 2024-04-08 18:00 UTC.
  closeTo(state.sun.rightAscensionHours, 1.172219, 0.004, 'Sun right ascension hours');
  closeTo(state.sun.declinationDegrees, 7.46025, 0.05, 'Sun declination degrees');
  closeTo(state.sun.distanceAu, 1.001503576, 0.00005, 'Sun distance AU');
  closeTo(state.sun.angularDiameterDegrees, 0.532106, 0.002, 'Sun angular diameter degrees');

  closeTo(state.moon.rightAscensionHours, 1.151186, 0.004, 'Moon right ascension hours');
  closeTo(state.moon.declinationDegrees, 7.687917, 0.05, 'Moon declination degrees');
  closeTo(state.moon.distanceAu, 0.002404986, 0.000002, 'Moon distance AU');
  closeTo(state.moon.angularDiameterDegrees, 0.553371, 0.003, 'Moon angular diameter degrees');
  closeTo(state.moon.phaseAngleDegrees, 179.6121, 0.15, 'Moon phase angle degrees');
  closeTo(state.moon.illuminatedFraction, 0.0000113, 0.0002, 'Moon illuminated fraction');
  closeTo(Math.abs(state.moon.librationLongitudeDegrees), 1.951469, 0.2, 'Moon libration longitude degrees');
  closeTo(state.moon.librationLatitudeDegrees, -0.437737, 0.2, 'Moon libration latitude degrees');
  closeTo(state.moon.northPolePositionAngleDegrees, 339.2349, 0.5, 'Moon north-pole position angle degrees');
});

test('astronomical state matches USNO and JPL Horizons at the June solstice', () => {
  const state = astronomicalStateAt(new Date('2025-06-21T12:00:00.000Z'));

  // USNO Greenwich apparent sidereal time: 05:59:45.2590.
  closeTo(state.earth.greenwichApparentSiderealDegrees, 89.938579, 0.01, 'solstice GAST degrees');

  // JPL Horizons DE441 geocentric ICRF values, 2025-06-21 12:00 UTC.
  closeTo(state.sun.rightAscensionHours, 6.001378, 0.004, 'solstice Sun right ascension hours');
  closeTo(state.sun.declinationDegrees, 23.435972, 0.05, 'solstice Sun declination degrees');
  closeTo(state.sun.distanceAu, 1.016231612, 0.00005, 'solstice Sun distance AU');
  closeTo(state.sun.angularDiameterDegrees, 0.524394, 0.002, 'solstice Sun angular diameter degrees');

  closeTo(state.moon.rightAscensionHours, 2.150403, 0.004, 'solstice Moon right ascension hours');
  closeTo(state.moon.declinationDegrees, 16.73675, 0.05, 'solstice Moon declination degrees');
  closeTo(state.moon.distanceAu, 0.002439973, 0.000002, 'solstice Moon distance AU');
  closeTo(state.moon.angularDiameterDegrees, 0.545436, 0.003, 'solstice Moon angular diameter degrees');
  closeTo(state.moon.phaseAngleDegrees, 125.5661, 0.15, 'solstice Moon phase angle degrees');
  closeTo(state.moon.illuminatedFraction, 0.2091558, 0.002, 'solstice Moon illuminated fraction');
  closeTo(state.moon.librationLongitudeDegrees, -2.298946, 0.2, 'solstice Moon libration longitude degrees');
  closeTo(state.moon.librationLatitudeDegrees, -4.537606, 0.2, 'solstice Moon libration latitude degrees');
  closeTo(state.moon.northPolePositionAngleDegrees, 341.4902, 0.5, 'solstice Moon north-pole position angle degrees');
});

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
