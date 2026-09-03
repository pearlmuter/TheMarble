import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSUMED_THICK_CLOUD_OPTICAL_DEPTH,
  ASSUMED_THICKNESS_CURVATURE,
  CLOUD_RENDER_GLSL,
  NIGHT_CLOUD_AIRGLOW_SCALE,
  NIGHT_CLOUD_AIRGLOW_TINT,
  NIGHT_CLOUD_MOONLIGHT_SCALE,
  NIGHT_CLOUD_MOONLIGHT_TINT,
  NIGHT_CLOUD_UPWELLING_SCALE,
  NIGHT_CLOUD_UPWELLING_SPREAD_UV,
  assumedCloudOpticalDepth,
  cityLightTransmission,
  cloudShadowStrength,
  discoverCloudCaster,
  nightCloudIllumination,
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

test('solid cloud is assumed thick enough to extinguish a city, not the 1.71 the old curve saturated at', () => {
  // #21 measured 22.1% of city light surviving total cloud, because
  // -log(1 - alpha*.82) caps at 1.71 whatever the cloud.
  assert.equal(assumedCloudOpticalDepth(1), ASSUMED_THICK_CLOUD_OPTICAL_DEPTH);
  assert.ok(ASSUMED_THICK_CLOUD_OPTICAL_DEPTH >= 15 && ASSUMED_THICK_CLOUD_OPTICAL_DEPTH <= 20);
  assert.ok(cityLightTransmission(assumedCloudOpticalDepth(1), .88) < .001);
  assert.ok(cityLightTransmission(assumedCloudOpticalDepth(.9), .88) < .01);
});

test('thin cloud stays as thin as the curve it replaces, so cirrus still lets a city through', () => {
  const supersededCurve = alpha => -Math.log(Math.max(1 - alpha * .82, .01));
  for (const alpha of [0, .05, .1, .15, .2]) {
    assert.ok(Math.abs(assumedCloudOpticalDepth(alpha) - supersededCurve(alpha)) < .05);
  }
  assert.ok(cityLightTransmission(assumedCloudOpticalDepth(.1), .88) > .9);
  assert.ok(cityLightTransmission(assumedCloudOpticalDepth(.2), .88) > .8);
});

test('assumed thickness rescales the observed opacity range rather than flattening it', () => {
  let previous = -1;
  for (let alpha = 0; alpha <= 1.0001; alpha += .05) {
    const depth = assumedCloudOpticalDepth(alpha);
    assert.ok(depth > previous, `not increasing at alpha ${alpha}`);
    previous = depth;
  }
  // A thunderstorm and thin cirrus must not read alike.
  assert.ok(assumedCloudOpticalDepth(.95) / assumedCloudOpticalDepth(.25) > 20);
  assert.equal(assumedCloudOpticalDepth(0), 0);
  assert.equal(assumedCloudOpticalDepth(-1), 0);
  assert.equal(assumedCloudOpticalDepth(2), ASSUMED_THICK_CLOUD_OPTICAL_DEPTH);
});

test('assumed thickness lets a shadow reach the full weighting the expression is scaled for', () => {
  // #20: the old curve pinned the weighting at .141 of a possible .34.
  const solid = cloudShadowStrength({
    casterAlpha: 1, casterOpticalDepth: assumedCloudOpticalDepth(1), casterQuality: 1,
    casterDensity: 1, daylight: 1,
  });
  assert.ok(Math.abs(solid - .34) < .001);
  const thin = cloudShadowStrength({
    casterAlpha: 1, casterOpticalDepth: assumedCloudOpticalDepth(.15), casterQuality: 1,
    casterDensity: 1, daylight: 1,
  });
  assert.ok(thin < .14);
});

test('the shader and its CPU mirror share one definition of assumed thickness', () => {
  const [, body] = CLOUD_RENDER_GLSL.match(/float assumedCloudOpticalDepth\(float alpha\)\{([^}]*)\}/);
  const constants = [...body.matchAll(/(?<![\w.])\d+\.\d+/g)].map(match => Number(match[0]));
  // Every number the shader spends on assumed thickness is either one of the two
  // shared constants or the identity terms of the same expression, so the GLSL
  // cannot drift away from the CPU mirror the tests above pin down.
  assert.deepEqual(
    [...new Set(constants)].sort((a, b) => a - b),
    [0.0, 1.0, ASSUMED_THICKNESS_CURVATURE, ASSUMED_THICK_CLOUD_OPTICAL_DEPTH].sort((a, b) => a - b),
  );
});

test('cloud at night is never black, even at new moon over empty ocean', () => {
  // Drawing it black is the defect: the cloud still hid city lights but never
  // appeared, so an overcast region read as a hole in the map.
  const [r, g, b] = nightCloudIllumination({ moonLambert: 0, moonIllumination: 0, upwelling: [0, 0, 0] });
  assert.ok(r > 0 && g > 0 && b > 0);
  // Airglow is cool, not neutral: blue exceeds red.
  assert.ok(b > r);
});

test('moonlight on cloud follows the real phase of the Moon', () => {
  const luminance = input => nightCloudIllumination(input).reduce((sum, channel) => sum + channel, 0) / 3;
  const newMoon = luminance({ moonLambert: 1, moonIllumination: 0 });
  const half = luminance({ moonLambert: 1, moonIllumination: .5 });
  const full = luminance({ moonLambert: 1, moonIllumination: 1 });

  assert.ok(full > half && half > newMoon);
  // A new moon leaves airglow alone, and half a Moon gives half the moonlight.
  assert.ok(Math.abs((half - newMoon) - (full - half)) < 1e-9);
  // The Moon below the horizon contributes nothing, however full it is.
  assert.equal(luminance({ moonLambert: -1, moonIllumination: 1 }), newMoon);
});

test('cloud over a city glows, which is where the light a city loses actually goes', () => {
  const luminance = input => nightCloudIllumination(input).reduce((sum, channel) => sum + channel, 0) / 3;
  const overOcean = luminance({ moonIllumination: .5, moonLambert: .5 });
  const overCity = luminance({ moonIllumination: .5, moonLambert: .5, upwelling: [.8, .7, .5] });
  const darkOcean = luminance({});
  const darkCity = luminance({ upwelling: [.8, .7, .5] });

  assert.ok(overCity > overOcean * 2);
  // With no Moon at all the city beneath is what makes the deck visible.
  assert.ok(darkCity > darkOcean * 3);
  // The city itself stays hidden: extinction is unchanged and still total.
  assert.ok(cityLightTransmission(assumedCloudOpticalDepth(1), .88) < .001);
});

test('the shader and its CPU mirror share one definition of night cloud light', () => {
  for (const name of ['nightCloudIllumination', 'upwellingCityLight']) {
    assert.match(CLOUD_RENDER_GLSL, new RegExp(`vec3 ${name}\\(`));
  }
  for (const constant of [
    NIGHT_CLOUD_MOONLIGHT_SCALE, NIGHT_CLOUD_AIRGLOW_SCALE, NIGHT_CLOUD_UPWELLING_SCALE,
    ...NIGHT_CLOUD_MOONLIGHT_TINT, ...NIGHT_CLOUD_AIRGLOW_TINT, ...NIGHT_CLOUD_UPWELLING_SPREAD_UV,
  ]) {
    assert.ok(CLOUD_RENDER_GLSL.includes(String(constant)), `GLSL does not use ${constant}`);
  }
  // The spread taps must preserve energy, or cloud brightness would depend on
  // how wide the sampling happens to be.
  const [, upwellingBody] = CLOUD_RENDER_GLSL.match(/vec3 upwellingCityLight\([^)]*\)\{([\s\S]*?)\n  \}/);
  const weights = [...upwellingBody.matchAll(/\.rgb\*(\.\d+)/g)].map(match => Number(match[1]));
  assert.equal(weights.length, 9);
  assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9);
});
