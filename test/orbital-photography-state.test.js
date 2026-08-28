import assert from 'node:assert/strict';
import test from 'node:test';
import { orbitalPhotographyState } from '../src/orbital-photography-state.js';

const SUN_RADIUS = 109.2;
const MOON_RADIUS = 0.2727;

function state(overrides = {}) {
  return orbitalPhotographyState({
    cameraPosition: [0, 0, 7],
    sunPosition: [23_455, 0, 0],
    sunRadius: SUN_RADIUS,
    moonPosition: [0, 0, -60],
    moonRadius: MOON_RADIUS,
    sunNdc: [0, 0, 0.5],
    ...overrides,
  });
}

test('an unobscured on-axis Sun saturates the camera and suppresses the faint sky', () => {
  const photograph = state();

  assert.equal(photograph.sun.visibleFraction, 1);
  assert.equal(photograph.sun.inFrame, true);
  assert.ok(photograph.optics.bloomStrength > 0.9);
  assert.ok(photograph.optics.diffractionStrength > 0.7);
  assert.ok(photograph.optics.flareStrength > 0.8);
  assert.ok(photograph.exposure.milkyWay < 0.12);
  assert.ok(photograph.exposure.stars < 0.3);
});

test('Earth occultation continuously extinguishes every direct-Sun camera artifact', () => {
  const total = state({ sunPosition: [0, 0, -23_455] });
  assert.equal(total.sun.earthOcclusionFraction, 1);
  assert.equal(total.sun.visibleFraction, 0);
  assert.equal(total.optics.bloomStrength, 0);
  assert.equal(total.optics.diffractionStrength, 0);
  assert.equal(total.optics.flareStrength, 0);
  assert.ok(total.exposure.milkyWay > 0.65);

  const earthAngularRadius = Math.asin(1 / 7);
  const distance = 23_455;
  const halfCovered = state({
    sunPosition: [Math.sin(earthAngularRadius) * distance, 0, 7 - Math.cos(earthAngularRadius) * distance],
  });
  assert.ok(halfCovered.sun.visibleFraction > 0.42 && halfCovered.sun.visibleFraction < 0.58);
  assert.ok(halfCovered.optics.bloomStrength > 0 && halfCovered.optics.bloomStrength < 1);
  assert.ok(halfCovered.exposure.milkyWay < total.exposure.milkyWay);
});

test('the Moon can occult the geometric Sun without changing its physical source', () => {
  const eclipse = state({
    sunPosition: [23_455, 0, 7],
    moonPosition: [58, 0, 7],
  });

  assert.ok(eclipse.sun.moonOcclusionFraction > 0.98);
  assert.ok(eclipse.sun.visibleFraction < 0.02);
  assert.equal(eclipse.sun.geometricRadius, SUN_RADIUS);
});

test('Earth and Moon coverage is combined when their silhouettes cover different solar regions', () => {
  const cameraDistance = 7;
  const sunDistance = 23_455;
  const moonDistance = 58;
  const earthLimbAngle = Math.asin(1 / cameraDistance);
  const solarAngularRadius = Math.asin(SUN_RADIUS / sunDistance);
  const sunAngle = earthLimbAngle;
  const moonAngle = earthLimbAngle + solarAngularRadius * 0.5;
  const combined = state({
    sunPosition: [Math.sin(sunAngle) * sunDistance, 0, cameraDistance - Math.cos(sunAngle) * sunDistance],
    moonPosition: [Math.sin(moonAngle) * moonDistance, 0, cameraDistance - Math.cos(moonAngle) * moonDistance],
  });

  assert.ok(combined.sun.earthOcclusionFraction > 0.45 && combined.sun.earthOcclusionFraction < 0.55);
  assert.ok(combined.sun.moonOcclusionFraction > 0.65 && combined.sun.moonOcclusionFraction < 0.75);
  assert.ok(combined.sun.combinedOcclusionFraction > combined.sun.moonOcclusionFraction);
  assert.ok(combined.sun.combinedOcclusionFraction > 0.98);
  assert.ok(combined.sun.visibleFraction < 0.02);
  assert.ok(combined.optics.flareStrength < 0.06);
});

test('camera flare weakens smoothly toward the frame edge and vanishes behind the camera', () => {
  const center = state();
  const edge = state({ sunNdc: [1.05, 0, 0.5] });
  const behind = state({ sunNdc: [0, 0, 1.5] });

  assert.ok(edge.optics.flareStrength > 0);
  assert.ok(edge.optics.flareStrength < center.optics.flareStrength);
  assert.equal(behind.sun.inFrame, false);
  assert.equal(behind.optics.flareStrength, 0);
  assert.ok(behind.exposure.milkyWay > center.exposure.milkyWay);
});

test('a bright daylight Earth suppresses the faint sky even when the Sun is behind the camera', () => {
  const daylight = state({
    sunPosition: [0, 0, 23_455],
    sunNdc: [0, 0, 1.5],
  });

  assert.equal(daylight.sun.inFrame, false);
  assert.ok(daylight.earth.illuminatedFraction > 0.999);
  assert.ok(daylight.exposure.milkyWay < 0.2);
  assert.ok(daylight.exposure.stars < 0.4);
});
