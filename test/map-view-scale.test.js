import assert from 'node:assert/strict';
import test from 'node:test';
import { orbitMapScale } from '../src/map-view-scale.js';
const input = { distanceEarthRadii: 3, verticalFovDegrees: 22, viewportHeightCssPixels: 1000 };
const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

test('map zoom uses the 256-pixel equatorial tile convention', () => {
  const scale = orbitMapScale({ distanceEarthRadii: 1 + Math.PI, verticalFovDegrees: 90, viewportHeightCssPixels: 256 });
  near(scale.zoom, 0);
  near(scale.metersPerPixel, 156543.03392804097, 1e-7);
});

test('halving altitude or doubling CSS viewport height advances one zoom level', () => {
  const base = orbitMapScale(input);
  near(orbitMapScale({ ...input, distanceEarthRadii: 2 }).zoom, base.zoom + 1);
  near(orbitMapScale({ ...input, viewportHeightCssPixels: 2000 }).zoom, base.zoom + 1);
  near(orbitMapScale({ ...input, distanceEarthRadii: 2 }).metersPerPixel, base.metersPerPixel / 2);
});

test('centre ground scale agrees with independent ray/sphere geometry', () => {
  const halfPixelRayAngle = Math.atan(Math.tan(22 * Math.PI / 360) / 1000);
  for (const distance of [1.064, 3, 18]) {
    const arc = Math.asin(distance * Math.sin(halfPixelRayAngle)) - halfPixelRayAngle;
    const exactPixelArcMetres = 2 * 6378137 * arc;
    const scale = orbitMapScale({ ...input, distanceEarthRadii: distance });
    assert.ok(Math.abs(scale.metersPerPixel / exactPixelArcMetres - 1) < .00001);
  }
});

test('a narrower field of view increases map zoom and invalid geometry is unavailable', () => {
  assert.ok(orbitMapScale({ ...input, verticalFovDegrees: 11 }).zoom > orbitMapScale(input).zoom);
  for (const invalid of [{ distanceEarthRadii: 1 }, { distanceEarthRadii: NaN }, { verticalFovDegrees: 180 }, { viewportHeightCssPixels: 0 }]) {
    assert.equal(orbitMapScale({ ...input, ...invalid }), undefined);
  }
});
