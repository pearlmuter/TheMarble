import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSUMED_CLOUD_BASE_KM,
  ASSUMED_CLOUD_RELIEF_KM,
  ASSUMED_THICKNESS_CURVATURE,
  ASSUMED_THICK_CLOUD_OPTICAL_DEPTH,
  CLOUD_RELIEF_MAX_STEP_UV,
  CLOUD_RELIEF_SAMPLE_UV,
  CLOUD_RELIEF_WRAP,
  CLOUD_RENDER_GLSL,
  EARTH_RADIUS_KM,
  MAXIMUM_CLOUD_SHADOW,
  MINIMUM_CLOUD_SHADOW,
  NIGHT_CLOUD_AIRGLOW_SCALE,
  NIGHT_CLOUD_AIRGLOW_TINT,
  NIGHT_CLOUD_MOONLIGHT_SCALE,
  NIGHT_CLOUD_MOONLIGHT_TINT,
  NIGHT_CLOUD_UPWELLING_SCALE,
  NIGHT_CLOUD_UPWELLING_SPREAD_UV,
  NIGHT_SURFACE_WASH_TINT,
  assumedCloudOpticalDepth,
  cityLightTransmission,
  cloudShadowStrength,
  cloudTopHeightKm,
  discoverCloudCaster,
  emittedNightLight,
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
  // #20: the old curve pinned the weighting at .141 of a possible .34. The ceiling has since
  // risen to MAXIMUM_CLOUD_SHADOW, because dimming the ground by a third under a convective
  // anvil was far too gentle; what the curve has to do is still reach it.
  const solid = cloudShadowStrength({
    casterAlpha: 1, casterOpticalDepth: assumedCloudOpticalDepth(1), casterQuality: 1,
    casterDensity: 1, daylight: 1,
  });
  assert.ok(Math.abs(solid - MAXIMUM_CLOUD_SHADOW) < .001);
  const thin = cloudShadowStrength({
    casterAlpha: 1, casterOpticalDepth: assumedCloudOpticalDepth(.15), casterQuality: 1,
    casterDensity: 1, daylight: 1,
  });
  assert.ok(thin < MAXIMUM_CLOUD_SHADOW * .42);
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
  const weights = [...upwellingBody.matchAll(/\.rgb\)?\*(\.\d+)/g)].map(match => Number(match[1]));
  assert.equal(weights.length, 9);
  assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9);
});

test('the night composite keeps city light and drops the surface wash it is painted on', () => {
  // Measured off the bundled 13500x6750 lights image. Brightness cannot tell these apart --
  // rural India and the empty Sahara sit at the same level -- so the separation has to be by
  // colour, and this is the check that it actually separates them.
  const keeps = ratio => ratio > 0.75;
  const removes = ratio => ratio < 0.25;
  // Judged on the warm channels, which are the emitted light. Judging on blue would measure
  // the wash itself.
  const strength = sample => {
    const before = Math.max(sample[0], sample[1]);
    const after = emittedNightLight(sample.map(v => v / 255));
    return before > 0 ? (Math.max(after[0], after[1]) * 255) / before : 0;
  };

  // Emitted light: warm or neutral, and must survive.
  assert.ok(keeps(strength([212, 201, 183])), `Tokyo lost too much: ${strength([212, 201, 183])}`);
  assert.ok(keeps(strength([177, 169, 168])), 'Cairo lost too much');
  assert.ok(keeps(strength([85, 77, 68])), 'Lagos lost too much');
  assert.ok(keeps(strength([41, 39, 48])), `rural India lost too much: ${strength([41, 39, 48])}`);

  // Surface wash: blue-dominant, and must go.
  assert.ok(removes(strength([5, 5, 15])), `open ocean survived: ${strength([5, 5, 15])}`);
  assert.ok(removes(strength([26, 22, 45])), `Australia's interior survived: ${strength([26, 22, 45])}`);
  assert.ok(removes(strength([35, 32, 60])), `the empty Sahara survived: ${strength([35, 32, 60])}`);
  assert.ok(removes(strength([42, 51, 84])), `Antarctica survived: ${strength([42, 51, 84])}`);
});

test('removing the night wash can never add light or drive a channel negative', () => {
  for (let red = 0; red <= 1; red += 0.25) {
    for (let green = 0; green <= 1; green += 0.25) {
      for (let blue = 0; blue <= 1; blue += 0.25) {
        const result = emittedNightLight([red, green, blue]);
        result.forEach((value, channel) => {
          assert.ok(value >= 0, `channel ${channel} went negative`);
          assert.ok(value <= [red, green, blue][channel] + 1e-12, `channel ${channel} gained light`);
        });
      }
    }
  }
});

test('the shader and the CPU mirror of the night wash share one tint', () => {
  assert.ok(CLOUD_RENDER_GLSL.includes(`NIGHT_SURFACE_WASH_TINT=vec3(${NIGHT_SURFACE_WASH_TINT.join(',')})`));
  assert.match(CLOUD_RENDER_GLSL, /vec3 emittedNightLight\(vec3 sampled\)/);
  // The upwelling read must go through it too, or the cloud would glow over a wash the surface
  // beneath it no longer has.
  assert.doesNotMatch(CLOUD_RENDER_GLSL, /total\+=texture2D\(nightMap/);
});

test('cloud top height rises with thickness where nothing retrieved one', () => {
  // Marine stratus near a kilometre, deep convection well above ten, and monotonic between.
  assert.ok(Math.abs(cloudTopHeightKm(0) - ASSUMED_CLOUD_BASE_KM) < 1e-9);
  assert.ok(cloudTopHeightKm(2) < 5, `thin cloud sat at ${cloudTopHeightKm(2)} km`);
  assert.ok(cloudTopHeightKm(40) > 10, `thick cloud only reached ${cloudTopHeightKm(40)} km`);
  assert.ok(cloudTopHeightKm(1e6) <= ASSUMED_CLOUD_BASE_KM + ASSUMED_CLOUD_RELIEF_KM + 1e-6);
  let previous = -Infinity;
  for (let depth = 0; depth <= 60; depth += 1) {
    const height = cloudTopHeightKm(depth);
    assert.ok(height >= previous, `height fell between ${depth - 1} and ${depth}`);
    previous = height;
  }
});

test('a retrieved cloud top wins over the assumed one', () => {
  // The assumption exists only where SatCORPS has nothing to say. Where it does, it is the truth.
  assert.equal(cloudTopHeightKm(30, 2.5, 1), 2.5);
  assert.equal(cloudTopHeightKm(1, 16, 1), 16);
  // And a partial weight interpolates rather than jumping.
  const half = cloudTopHeightKm(30, 2.5, 0.5);
  assert.ok(half > 2.5 && half < cloudTopHeightKm(30));
});

test('the cast shadow reaches a depth a thick deck actually casts', () => {
  // Ground under a convective anvil keeps roughly a fifth to a third of clear-sky irradiance,
  // so the darkening has to reach about .7. The superseded ceiling of .34 was far too gentle.
  assert.ok(MAXIMUM_CLOUD_SHADOW > 0.6 && MAXIMUM_CLOUD_SHADOW < 0.85);
  assert.ok(MINIMUM_CLOUD_SHADOW > 0 && MINIMUM_CLOUD_SHADOW < 0.25);
  // And the shader reads the same curve, so the two cannot drift.
  assert.match(CLOUD_RENDER_GLSL, /float cloudShadowOpticalWeight\(float opticalDepth\)/);
  assert.ok(CLOUD_RENDER_GLSL.includes(`mix(${MINIMUM_CLOUD_SHADOW},${MAXIMUM_CLOUD_SHADOW},`));
});

test('a cloud slope turned away from the Sun goes grey, never black', () => {
  // Cloud scatters far more than it absorbs. A plain cosine would render the shaded side of a
  // deck as a hole, which is the opposite of what Apollo's clouds show.
  const shade = relief => Math.min(Math.max((relief + CLOUD_RELIEF_WRAP) / (1 + CLOUD_RELIEF_WRAP), 0), 1);
  assert.ok(Math.abs(shade(1) - 1) < 1e-9, 'a slope facing the Sun must be fully lit');
  assert.ok(shade(0) > 0.25, `a slope edge-on went to ${shade(0)}`);
  assert.equal(shade(-1), 0);
  assert.match(CLOUD_RENDER_GLSL, /float cloudReliefShading\(float reliefSolar\)/);
  assert.ok(CLOUD_RENDER_GLSL.includes(`(reliefSolar+${CLOUD_RELIEF_WRAP})/(1.0+${CLOUD_RELIEF_WRAP})`));
});

test('the relief normal tilts toward the downhill side and stays a unit vector', () => {
  // Pure geometry, checked on the shader source: an east-west height difference has to scale by
  // cos(latitude), or every deck would tilt harder the closer it got to a pole.
  assert.match(CLOUD_RENDER_GLSL, /float eastKm=2\.0\*PI\*6371\.0\*max\(cos\(latitude\),1e-3\)\*cloudReliefStepU\(latitude\)/);
  // The u step widens by 1/cos so the samples stay a constant distance apart on the ground, and
  // the deck stops claiming relief where even the widened step has to be clamped. Without both,
  // the pole tears into a radial fan.
  assert.match(CLOUD_RENDER_GLSL, /float cloudReliefStepU\(float latitude\)/);
  assert.match(CLOUD_RENDER_GLSL, /float cloudReliefPolarConfidence\(float latitude\)/);
  assert.match(CLOUD_RENDER_GLSL, /float northKm=PI\*6371\.0/);
  assert.match(CLOUD_RENDER_GLSL, /return normalize\(up-east\*slopeEast-north\*slopeNorth\)/);
});

test('the relief sample step keeps a constant ground distance as latitude rises', () => {
  // The pole is where a fixed step in map coordinates stops meaning a fixed distance on the
  // ground. Two texels a step apart at 89 degrees are almost the same place, so a fixed step
  // turns a small height difference into an enormous slope -- which is what tore a radial fan
  // into the deck over the Arctic once sea ice made the pole bright enough to see it.
  const stepU = latitude => Math.min(
    CLOUD_RELIEF_SAMPLE_UV / Math.max(Math.cos((latitude * Math.PI) / 180), 1e-3),
    CLOUD_RELIEF_MAX_STEP_UV,
  );
  const groundKm = latitude =>
    2 * Math.PI * EARTH_RADIUS_KM * Math.max(Math.cos((latitude * Math.PI) / 180), 1e-3) * stepU(latitude);

  // Constant to within a percent everywhere the step is not clamped.
  const equator = groundKm(0);
  for (const latitude of [0, 30, 45, 60, 75, 85]) {
    assert.ok(
      Math.abs(groundKm(latitude) / equator - 1) < 0.01,
      `sample spacing drifted to ${groundKm(latitude)} km at ${latitude} degrees`,
    );
  }
  // And the step widens rather than staying put.
  assert.ok(stepU(60) > stepU(0) * 1.9);
  assert.ok(stepU(89) === CLOUD_RELIEF_MAX_STEP_UV, 'the step must be capped near the pole');
});

test('relief confidence falls to nothing at the pole', () => {
  const confidence = latitude => {
    const wanted = CLOUD_RELIEF_SAMPLE_UV / Math.max(Math.cos((latitude * Math.PI) / 180), 1e-3);
    const t = Math.min(Math.max((wanted - CLOUD_RELIEF_MAX_STEP_UV * 0.6) / (CLOUD_RELIEF_MAX_STEP_UV * 0.4), 0), 1);
    return 1 - t * t * (3 - 2 * t);
  };
  assert.ok(confidence(0) === 1 && confidence(60) === 1 && confidence(80) === 1);
  assert.equal(confidence(90), 0);
  assert.ok(confidence(88) < 1, 'relief must start fading before the pole');
});
