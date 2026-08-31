import assert from 'node:assert/strict';
import test from 'node:test';
import { celestialSceneFrameAt } from '../src/astronomical-state.js';
import { createOneTimeInertialCameraPlacement, initialInertialCameraPosition, ISS_ORBIT_RADII, cameraClippingForAltitude } from '../src/inertial-camera.js';

const START = new Date('2024-04-08T18:00:00.000Z');

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
}

test('initial camera placement is frozen in inertial space while Earth completes a sidereal day', () => {
  const initialFrame = celestialSceneFrameAt(START);
  const nextFrame = celestialSceneFrameAt(new Date(START.valueOf() + 86_164.0905 * 1_000));
  const takeInitialCameraPosition = createOneTimeInertialCameraPlacement();
  const cameraPosition = takeInitialCameraPosition(initialFrame);
  assert.ok(cameraPosition);

  // The next render frame gets no replacement position, leaving the camera inertial.
  assert.equal(takeInitialCameraPosition(nextFrame), null);
  assert.notDeepEqual(initialFrame.earth.bodyToSceneMatrix, nextFrame.earth.bodyToSceneMatrix);

  // Recomputing the old Sun-tracking placement would move the camera measurably.
  const trackedPosition = initialInertialCameraPosition(nextFrame);
  assert.ok(dot(normalize(cameraPosition), normalize(trackedPosition)) < 0.99999);
});

test('the closest approach is the ISS orbit, not an arbitrary limit', () => {
  // 408 km on a unit Earth of 6371 km.
  assert.ok(Math.abs(ISS_ORBIT_RADII - 1.064) < 0.001);
  assert.ok(ISS_ORBIT_RADII > 1.02, 'must stay above the atmosphere shell the ray-march assumes it is outside');
});

test('the near plane follows the camera down instead of clipping the surface', () => {
  // The old fixed 0.1 near plane cuts away everything below roughly 640 km.
  assert.ok(cameraClippingForAltitude(ISS_ORBIT_RADII).near < ISS_ORBIT_RADII - 1);
  assert.ok(cameraClippingForAltitude(6).near <= 0.1);
  // Depth precision still has to reach the Sun, so near never collapses.
  assert.ok(cameraClippingForAltitude(1.000001).near >= 2e-4);
});

test('the zoom step scales with altitude so it neither crawls nor lurches', () => {
  const high = cameraClippingForAltitude(18).zoomSpeed;
  const low = cameraClippingForAltitude(ISS_ORBIT_RADII).zoomSpeed;
  assert.ok(low < high, 'a step sized for orbit would overshoot the surface');
  assert.ok(low >= 0.25 && high <= 1);
});
