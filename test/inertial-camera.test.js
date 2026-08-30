import assert from 'node:assert/strict';
import test from 'node:test';
import { celestialSceneFrameAt } from '../src/astronomical-state.js';
import { createOneTimeInertialCameraPlacement, initialInertialCameraPosition } from '../src/inertial-camera.js';

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
