import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cityLightTransmission,
  cloudShadowStrength,
  discoverCloudCaster,
  shadowCasterUv,
  sphereUv,
} from '../src/cloud-render-model.js';

test('CPU fixtures use the exact Three SphereGeometry longitude and latitude convention', () => {
  assert.deepEqual(sphereUv([-1, 0, 0]), [0, .5]);
  assert.equal(sphereUv([0, 1, 0])[1], 1);
  assert.equal(sphereUv([0, -1, 0])[1], 0);
});

test('the production probe search discovers a narrow low caster that an 11 km guess misses', () => {
  const surface = [1, 0, 0];
  const sun = [.08, 0, Math.sqrt(1 - .08 ** 2)];
  const lowUv = shadowCasterUv(surface, sun, 1.5);
  const elevenUv = shadowCasterUv(surface, sun, 11);
  assert.ok(Math.abs(lowUv[0] - elevenUv[0]) > .002);

  const caster = discoverCloudCaster(surface, sun, uv => (
    Math.abs(uv[0] - lowUv[0]) < .0005
      ? { heightKm: 1.5, quality: .96 }
      : { heightKm: 0, quality: 0 }
  ));
  assert.ok(Math.abs(caster.heightKm - 1.5) < .01);
  assert.ok(caster.score > .9);
});

test('high cloud shadows separate farther near the terminator than low cloud shadows', () => {
  const surface = [1, 0, 0];
  const nearTerminatorSun = [.08, 0, Math.sqrt(1 - .08 ** 2)];
  const low = shadowCasterUv(surface, nearTerminatorSun, 1.5);
  const high = shadowCasterUv(surface, nearTerminatorSun, 15.8);
  assert.ok(Math.abs(high[0] - .5) > Math.abs(low[0] - .5));
  assert.equal(low[1], .5);
  assert.equal(high[1], .5);
});

test('casting-cloud physics produces a terminator shadow even when the receiving surface is clear', () => {
  const strength = cloudShadowStrength({
    casterAlpha: .92, casterOpticalDepth: 24, casterQuality: .96,
    casterDensity: 1, daylight: .6,
  });
  assert.ok(strength > .15);
});

test('thin cirrus transmits city light while dense convection obscures it', () => {
  assert.ok(cityLightTransmission(.7, .9) > .45);
  assert.ok(cityLightTransmission(85, 1) < .001);
});
