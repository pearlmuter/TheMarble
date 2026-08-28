import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { celestialSceneFrameAt } from '../src/astronomical-state.js';
import {
  ORBITAL_GOLDEN_SCENES,
  createOneTimeOrbitalGoldenCameraPlacement,
  orbitalGoldenCameraPose,
  orbitalGoldenScene,
} from '../src/orbital-golden-scenes.js';

const REQUIRED_SCENES = [
  'daylight',
  'crescent-earth',
  'terminator',
  'sunrise-limb',
  'visible-sun',
  'solar-occultation',
  'moon',
  'milky-way',
];

function normalize(vector) {
  const magnitude = Math.hypot(...vector);
  return vector.map(value => value / magnitude);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

test('golden orbital photographs cover every required lighting and exposure regime', () => {
  assert.deepEqual(ORBITAL_GOLDEN_SCENES.map(scene => scene.id), REQUIRED_SCENES);
  for (const scene of ORBITAL_GOLDEN_SCENES) {
    assert.equal(new Date(scene.time).toISOString(), scene.time);
    assert.ok(scene.description.length > 20);
    assert.ok(scene.fovDegrees >= 1 && scene.fovDegrees <= 55);
  }
});

test('every golden scene has a checked-in 1600 by 1000 PNG reference', async () => {
  const goldenDirectory = new URL('../docs/golden-scenes/', import.meta.url);
  const pngNames = (await readdir(goldenDirectory))
    .filter(name => name.endsWith('.png'))
    .sort();

  assert.deepEqual(pngNames, REQUIRED_SCENES.map(id => `${id}.png`).sort());

  for (const pngName of pngNames) {
    const png = await readFile(new URL(pngName, goldenDirectory));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 1600, `${pngName} width`);
    assert.equal(png.readUInt32BE(20), 1000, `${pngName} height`);
  }
});

test('golden scene lookup rejects unknown names instead of silently changing the camera', () => {
  assert.equal(orbitalGoldenScene('terminator').id, 'terminator');
  assert.equal(orbitalGoldenScene('decorative-space-scene'), null);
  assert.equal(orbitalGoldenScene(null), null);
});

test('golden camera phases deterministically frame daylight, terminator, crescent, and occultation', () => {
  const frame = celestialSceneFrameAt(new Date('2025-06-21T12:00:00.000Z'));
  const sun = normalize(frame.sun.inertialDirection);

  for (const [id, expectedPhase] of [
    ['daylight', 0],
    ['terminator', 90],
    ['crescent-earth', 145],
    ['solar-occultation', 180],
  ]) {
    const pose = orbitalGoldenCameraPose(orbitalGoldenScene(id), frame);
    const observer = normalize(pose.position);
    const phase = Math.acos(Math.max(-1, Math.min(1, dot(observer, sun)))) * 180 / Math.PI;
    assert.ok(Math.abs(phase - expectedPhase) < 0.000001, `${id} phase was ${phase}°`);
    assert.deepEqual(pose.target, [0, 0, 0]);
  }
});

test('Moon and Milky Way golden scenes use deliberate photographic framing', () => {
  const moonScene = orbitalGoldenScene('moon');
  const milkyWayScene = orbitalGoldenScene('milky-way');
  const moonFrame = celestialSceneFrameAt(new Date(moonScene.time));
  const moonPose = orbitalGoldenCameraPose(moonScene, moonFrame);

  assert.deepEqual(moonPose.target, moonFrame.moon.inertialDirection.map(value => value * moonFrame.moon.distanceEarthRadii));
  assert.ok(moonScene.fovDegrees < 3);
  assert.ok(milkyWayScene.fovDegrees > 40);
  assert.ok(milkyWayScene.cameraDistanceEarthRadii > 10);
});

test('a golden camera pose is applied once and cannot be replaced on the next render frame', () => {
  const scene = orbitalGoldenScene('daylight');
  const frame = celestialSceneFrameAt(new Date(scene.time));
  const takeGoldenPose = createOneTimeOrbitalGoldenCameraPlacement(scene);

  assert.deepEqual(takeGoldenPose(frame), orbitalGoldenCameraPose(scene, frame));
  assert.equal(takeGoldenPose(frame), null);
});
