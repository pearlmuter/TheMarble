import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATMOSPHERE_MARCH_STEPS,
  ATMOSPHERE_MODEL_GLSL,
  ATMOSPHERE_RADIUS,
  ATMOSPHERE_SKY_RADIANCE_GLSL,
  ATMOSPHERE_TRANSMITTANCE_GLSL,
  MULTIPLE_SCATTERING_LUT_FRAGMENT_SHADER,
  MULTIPLE_SCATTERING_LUT_SIZE,
  BETA_OZONE,
  BETA_RAYLEIGH,
  GROUND_RADIUS,
  MIE_SCALE_HEIGHT,
  OZONE_PEAK_ALTITUDE,
  RAYLEIGH_SCALE_HEIGHT,
  TRANSMITTANCE_LUT_HEIGHT,
  SKY_IRRADIANCE_LUT_FRAGMENT_SHADER,
  TRANSMITTANCE_LUT_FRAGMENT_SHADER,
  TRANSMITTANCE_LUT_SAMPLES,
  TRANSMITTANCE_LUT_WIDTH,
  closestApproach,
  distanceToGround,
  distanceToTopAtmosphere,
  marchDistance,
  multipleScatteringRMu,
  multipleScatteringUv,
  miePhase,
  opticalDepthToTopAtmosphere,
  ozoneDensity,
  rayIntersectsGround,
  rayleighDensity,
  rayleighPhase,
  transmittanceOverSegment,
  transmittanceRMu,
  transmittanceToTopAtmosphere,
  transmittanceUv,
} from '../src/atmosphere-model.js';

const EARTH_RADIUS_KM = 6371;
const km = kilometres => kilometres / EARTH_RADIUS_KM;

test('the scale heights are the published Earth values', () => {
  assert.ok(Math.abs(RAYLEIGH_SCALE_HEIGHT * EARTH_RADIUS_KM - 8) < 1e-9);
  assert.ok(Math.abs(MIE_SCALE_HEIGHT * EARTH_RADIUS_KM - 1.2) < 1e-9);
  assert.equal(rayleighDensity(RAYLEIGH_SCALE_HEIGHT).toFixed(6), Math.exp(-1).toFixed(6));
});

test('vertical transmittance from the ground matches measured sea-level atmosphere', () => {
  // The classic numbers: a vertical path loses about a quarter of its blue and almost none of
  // its red. If this drifts, the whole colour of the render has moved.
  const [red, green, blue] = transmittanceToTopAtmosphere(GROUND_RADIUS, 1, 512);
  assert.ok(red > 0.93 && red < 0.95, `red ${red}`);
  assert.ok(green > 0.85 && green < 0.88, `green ${green}`);
  assert.ok(blue > 0.75 && blue < 0.78, `blue ${blue}`);
  assert.ok(blue < green && green < red, 'blue must be extinguished hardest');
});

test('a grazing path extinguishes far more than a vertical one', () => {
  const vertical = transmittanceToTopAtmosphere(GROUND_RADIUS, 1, 512);
  const grazing = transmittanceToTopAtmosphere(GROUND_RADIUS, 0.02, 512);
  assert.ok(grazing[2] < vertical[2] * 0.15, 'the horizon must kill blue');
  // Which is the whole reason a low Sun is orange: red survives the path that blue does not.
  assert.ok(grazing[0] / grazing[2] > 6 * (vertical[0] / vertical[2]));
});

test('ozone is a tent at 25 km, so it colours twilight rather than the day limb', () => {
  assert.equal(ozoneDensity(OZONE_PEAK_ALTITUDE), 1);
  // Bruneton's tent spans 10 to 40 km and is half strength at 17.5 and 32.5. There is no
  // ozone at the ground in this model, which is why ozone cannot tint a face-on day limb --
  // only a path long enough to reach up into the layer.
  assert.equal(ozoneDensity(0), 0);
  assert.ok(ozoneDensity(km(10)) < 1e-12);
  assert.equal(ozoneDensity(km(41)), 0);
  assert.ok(Math.abs(ozoneDensity(km(17.5)) - 0.5) < 1e-6);
  assert.ok(Math.abs(ozoneDensity(km(32.5)) - 0.5) < 1e-6);
  // Green-absorbing, which is the Chappuis band. If red or blue ever exceeded green here the
  // limb would go magenta on purpose rather than by accident.
  assert.ok(BETA_OZONE[1] > BETA_OZONE[0] && BETA_OZONE[1] > BETA_OZONE[2]);
});

test('Rayleigh scattering is blue-dominated by roughly the fourth power of wavelength', () => {
  const ratio = BETA_RAYLEIGH[2] / BETA_RAYLEIGH[0];
  // (680/440)^4 = 5.7. This is the single fact that makes the sky blue.
  assert.ok(ratio > 5.4 && ratio < 6.0, `blue/red ${ratio}`);
});

test('the transmittance parametrisation round-trips through the texture', () => {
  for (let v = 0; v <= 1.0001; v += 0.125) {
    for (let u = 0; u <= 1.0001; u += 0.125) {
      const uv = [
        0.5 / TRANSMITTANCE_LUT_WIDTH + u * (1 - 1 / TRANSMITTANCE_LUT_WIDTH),
        0.5 / TRANSMITTANCE_LUT_HEIGHT + v * (1 - 1 / TRANSMITTANCE_LUT_HEIGHT),
      ];
      const { r, mu } = transmittanceRMu(uv[0], uv[1]);
      assert.ok(r >= GROUND_RADIUS - 1e-9 && r <= ATMOSPHERE_RADIUS + 1e-9, `r out of range ${r}`);
      assert.ok(mu >= -1.0000001 && mu <= 1.0000001, `mu out of range ${mu}`);
      const back = transmittanceUv(r, mu);
      assert.ok(Math.abs(back[0] - uv[0]) < 2e-3, `u ${uv[0]} -> ${back[0]}`);
      assert.ok(Math.abs(back[1] - uv[1]) < 2e-3, `v ${uv[1]} -> ${back[1]}`);
    }
  }
});

test('the parametrisation spends its resolution on the atmosphere, not on space', () => {
  // Half the texture width should cover the near-horizon rays where transmittance actually
  // bends. A plain cosine grid puts most of its texels on paths that barely differ.
  const nearHorizon = transmittanceUv(GROUND_RADIUS, 0)[0];
  assert.ok(nearHorizon > 0.9, `horizon ray should sit at the far end of u, got ${nearHorizon}`);
  assert.ok(transmittanceUv(GROUND_RADIUS, 1)[0] < 0.02, 'the zenith ray should sit at the near end of u');
});

test('geometry agrees about which rays reach the ground', () => {
  assert.ok(!rayIntersectsGround(ATMOSPHERE_RADIUS, 1));
  assert.ok(!rayIntersectsGround(ATMOSPHERE_RADIUS, 0));
  assert.ok(rayIntersectsGround(ATMOSPHERE_RADIUS, -1));
  assert.ok(!rayIntersectsGround(GROUND_RADIUS, 0.0001));
  // A ray leaving the top of the atmosphere straight down travels the shell thickness.
  assert.ok(Math.abs(distanceToTopAtmosphere(GROUND_RADIUS, 1) - (ATMOSPHERE_RADIUS - GROUND_RADIUS)) < 1e-9);
});

test('segment transmittance composes: splitting a path multiplies to the whole', () => {
  const sample = (r, mu) => transmittanceToTopAtmosphere(r, mu, 512);
  const r = ATMOSPHERE_RADIUS;
  // Grazing, but still a limb ray: |mu| must stay under sqrt(1 - Rg^2/Rt^2) = 0.197 to miss
  // the ground. Its tangent point sits near 9 km, so the segment covers real optical depth.
  const mu = -0.19;
  const total = distanceToTopAtmosphere(r, mu);
  assert.ok(!rayIntersectsGround(r, mu));
  const whole = transmittanceOverSegment(sample, r, mu, total, false);

  const half = total / 2;
  const first = transmittanceOverSegment(sample, r, mu, half, false);
  const midRadius = Math.sqrt(half * half + 2 * r * mu * half + r * r);
  const midMu = (r * mu + half) / midRadius;
  const second = transmittanceOverSegment(sample, midRadius, midMu, half, false);
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(
      Math.abs(whole[channel] - first[channel] * second[channel]) < 5e-3,
      `channel ${channel}: ${whole[channel]} vs ${first[channel] * second[channel]}`,
    );
  }
});

test('segment transmittance never exceeds one or reports gain', () => {
  const sample = (r, mu) => transmittanceToTopAtmosphere(r, mu, 128);
  for (const mu of [-0.9, -0.5, -0.1, 0.1, 0.5, 0.9]) {
    const hitsGround = rayIntersectsGround(ATMOSPHERE_RADIUS, mu);
    const distance = hitsGround
      ? -ATMOSPHERE_RADIUS * mu - Math.sqrt(ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS * (mu * mu - 1) + 1)
      : distanceToTopAtmosphere(ATMOSPHERE_RADIUS, mu);
    for (const fraction of [0.1, 0.5, 1]) {
      const result = transmittanceOverSegment(sample, ATMOSPHERE_RADIUS, mu, distance * fraction, hitsGround);
      for (const value of result) {
        assert.ok(value >= 0 && value <= 1, `mu ${mu} fraction ${fraction} gave ${value}`);
      }
    }
  }
});

test('optical depth grows monotonically as a ray tips toward the horizon', () => {
  let previous = 0;
  for (const mu of [1, 0.8, 0.6, 0.4, 0.2, 0.05, 0]) {
    const depth = opticalDepthToTopAtmosphere(GROUND_RADIUS, mu, 256)[2];
    assert.ok(depth > previous, `mu ${mu} did not increase optical depth`);
    previous = depth;
  }
});

test('the phase functions are normalised and point the right way', () => {
  // Rayleigh is symmetric: forward and backward scattering are equal.
  assert.ok(Math.abs(rayleighPhase(1) - rayleighPhase(-1)) < 1e-12);
  // Mie is strongly forward, which is what makes a compact aureole toward the Sun.
  assert.ok(miePhase(1) > miePhase(-1) * 50);
  // Both integrate to one over the sphere.
  for (const phase of [rayleighPhase, mu => miePhase(mu)]) {
    let integral = 0;
    const steps = 20000;
    for (let index = 0; index < steps; index += 1) {
      const mu = -1 + (2 * (index + 0.5)) / steps;
      integral += phase(mu) * (2 / steps) * 2 * Math.PI;
    }
    assert.ok(Math.abs(integral - 1) < 0.02, `phase function integrates to ${integral}`);
  }
});

test('the GLSL is generated from the same constants the CPU mirror uses', () => {
  // Two copies of a coefficient is how the shader and the tests drift apart.
  assert.match(ATMOSPHERE_MODEL_GLSL, new RegExp(`BETA_RAYLEIGH=vec3\\(${BETA_RAYLEIGH[0]}`));
  assert.match(ATMOSPHERE_MODEL_GLSL, new RegExp(`ATMOSPHERE_RADIUS=${ATMOSPHERE_RADIUS}`));
  assert.match(ATMOSPHERE_MODEL_GLSL, /float RAYLEIGH_SCALE_HEIGHT=0\.0012556/);
  assert.match(ATMOSPHERE_MODEL_GLSL, /atmosphereTransmittanceUv/);
  assert.match(ATMOSPHERE_MODEL_GLSL, /atmosphereTransmittanceRMu/);
  assert.match(ATMOSPHERE_TRANSMITTANCE_GLSL, /atmosphereSunTransmittance/);
  assert.match(ATMOSPHERE_TRANSMITTANCE_GLSL, /atmosphereTransmittanceOverSegment/);
  // The shader must never grow its own copy of a coefficient.
  assert.doesNotMatch(ATMOSPHERE_TRANSMITTANCE_GLSL, /vec3\(\s*\d+\.\d+\s*,\s*\d+\.\d+\s*,\s*\d+\.\d+\s*\)/);
});

test('the march covers the whole segment and stays monotonic', () => {
  const cases = [
    [0, 0.02, 0.02], // a ray that lands: the lowest point is the ground end
    [0, 0.14, 0.28], // a limb ray: the lowest point is the tangent, mid-segment
    [0.3, 0.3, 0.9], // degenerate, closest approach clamped to the near end
    [0.3, 0.9, 0.9], // degenerate, clamped to the far end
  ];
  for (const [t0, tc, t1] of cases) {
    assert.ok(Math.abs(marchDistance(0, t0, tc, t1) - t0) < 1e-12, `start ${t0},${tc},${t1}`);
    assert.ok(Math.abs(marchDistance(1, t0, tc, t1) - t1) < 1e-12, `end ${t0},${tc},${t1}`);
    let previous = -Infinity;
    for (let step = 0; step <= 64; step += 1) {
      const value = marchDistance(step / 64, t0, tc, t1);
      assert.ok(value >= previous - 1e-12, `not monotonic at ${step} for ${t0},${tc},${t1}`);
      assert.ok(value >= t0 - 1e-12 && value <= t1 + 1e-12, `out of segment: ${value}`);
      previous = value;
    }
  }
});

test('the Sun march the old shell ran undercounted its column by a third', () => {
  // Measured, not assumed. This was the largest integration error in the superseded shell: five
  // uniform samples spread over the whole path to the top of the atmosphere put the first
  // sample 1.6 scale heights up, so most of the column below it was never sampled. Too little
  // optical depth means too much transmittance, which is why the old atmosphere needed hand
  // multipliers to look right.
  const distance = ATMOSPHERE_RADIUS - GROUND_RADIUS;
  const column = samples => {
    let total = 0;
    for (let index = 0; index < samples; index += 1) total += rayleighDensity(((index + 0.5) * distance) / samples) * (distance / samples);
    return total;
  };
  const analytic = RAYLEIGH_SCALE_HEIGHT * (1 - Math.exp(-distance / RAYLEIGH_SCALE_HEIGHT));
  assert.ok(column(5) / analytic < 0.7, `five samples recovered ${column(5) / analytic} of the column`);
  // The LUT is baked once, so it can afford to be right.
  assert.ok(Math.abs(column(TRANSMITTANCE_LUT_SAMPLES) / analytic - 1) < 0.01);
});

test('the importance march is accurate where a uniform march is not: rays that land', () => {
  // A tangent chord is the easy case — the geometry stretches the density into something a
  // coarse march handles well. A ray that reaches the ground is the hard one, because density
  // rises to a cusp at the endpoint rather than a smooth bump in the middle.
  const [t0, t1] = [0, ATMOSPHERE_RADIUS - GROUND_RADIUS];
  const analytic = RAYLEIGH_SCALE_HEIGHT * (1 - Math.exp(-(t1 - t0) / RAYLEIGH_SCALE_HEIGHT));

  let uniform = 0;
  const step = (t1 - t0) / 10;
  for (let index = 0; index < 10; index += 1) uniform += rayleighDensity(t1 - (t0 + (index + 0.5) * step)) * step;

  let importance = 0;
  for (let index = 0; index < ATMOSPHERE_MARCH_STEPS; index += 1) {
    const a = marchDistance(index / ATMOSPHERE_MARCH_STEPS, t0, t1, t1);
    const b = marchDistance((index + 1) / ATMOSPHERE_MARCH_STEPS, t0, t1, t1);
    importance += rayleighDensity(t1 - (a + b) / 2) * (b - a);
  }

  assert.ok(Math.abs(importance / analytic - 1) < 0.02, `importance march off by ${importance / analytic - 1}`);
  assert.ok(uniform / analytic < 0.95, `the uniform march should undercount, got ${uniform / analytic}`);
  assert.ok(
    Math.abs(importance / analytic - 1) < Math.abs(uniform / analytic - 1) / 4,
    'the importance march must be several times more accurate than the uniform one',
  );
});

test('the importance march puts most of its samples in the bottom scale height', () => {
  const [t0, t1] = [0, ATMOSPHERE_RADIUS - GROUND_RADIUS];
  const bottom = t1 - RAYLEIGH_SCALE_HEIGHT;
  const uniform = Array.from({ length: 10 }, (_, index) => t0 + ((index + 0.5) * (t1 - t0)) / 10)
    .filter(value => value >= bottom).length;
  const importance = Array.from({ length: ATMOSPHERE_MARCH_STEPS }, (_, index) => {
    const a = marchDistance(index / ATMOSPHERE_MARCH_STEPS, t0, t1, t1);
    const b = marchDistance((index + 1) / ATMOSPHERE_MARCH_STEPS, t0, t1, t1);
    return (a + b) / 2;
  }).filter(value => value >= bottom).length;
  // As a fraction, so the assertion stays true of the distribution rather than of one step
  // count: the curve puts roughly two fifths of its samples in the bottom scale height, where a
  // uniform march puts one tenth.
  assert.equal(uniform, 1);
  assert.ok(
    importance / ATMOSPHERE_MARCH_STEPS > 0.3,
    `only ${importance} of ${ATMOSPHERE_MARCH_STEPS} samples reached the dense air`,
  );
});

test('closest approach is where the ray comes nearest the centre, clamped into the segment', () => {
  // A ray aimed at the centre from six radii out: closest approach is the ground, so the
  // clamp must land on the far end of the segment.
  assert.equal(closestApproach([0, 0, 6], [0, 0, -1], 4.98, 5), 5);
  // A limb ray passing to one side keeps its tangent point inside the segment.
  const tangent = closestApproach([0, 0, 6], [0, 0.1, -1].map((v, _, a) => v / Math.hypot(...a)), 0, 12);
  assert.ok(tangent > 0 && tangent < 12);
});

test('the multiple-scattering table round-trips its parametrisation', () => {
  for (let v = 0; v <= 1.0001; v += 0.1) {
    for (let u = 0; u <= 1.0001; u += 0.1) {
      const uv = [
        0.5 / MULTIPLE_SCATTERING_LUT_SIZE + u * (1 - 1 / MULTIPLE_SCATTERING_LUT_SIZE),
        0.5 / MULTIPLE_SCATTERING_LUT_SIZE + v * (1 - 1 / MULTIPLE_SCATTERING_LUT_SIZE),
      ];
      const { r, muSun } = multipleScatteringRMu(uv[0], uv[1]);
      assert.ok(r >= GROUND_RADIUS - 1e-9 && r <= ATMOSPHERE_RADIUS + 1e-9, `r ${r}`);
      assert.ok(muSun >= -1.0000001 && muSun <= 1.0000001, `muSun ${muSun}`);
      const back = multipleScatteringUv(r, muSun);
      assert.ok(Math.abs(back[0] - uv[0]) < 1e-9 && Math.abs(back[1] - uv[1]) < 1e-9);
    }
  }
});

test('multiple scattering carries no view direction, because it has forgotten one', () => {
  // The whole approximation is that after the first bounce direction is lost. If a view angle
  // ever entered this table it would no longer be the thing the shell is allowed to add
  // without a phase function.
  assert.equal(multipleScatteringUv.length, 2);
  // Only the bake's own body: the shared GLSL it includes defines the phase functions for
  // other callers, and their presence there says nothing about this shader.
  const bakeBody = MULTIPLE_SCATTERING_LUT_FRAGMENT_SHADER.slice(
    MULTIPLE_SCATTERING_LUT_FRAGMENT_SHADER.lastIndexOf('void main()'),
  );
  assert.doesNotMatch(bakeBody, /atmosphereRayleighPhase\(|atmosphereMiePhase\(/);
  assert.match(bakeBody, /uniformPhase=1\.0\/\(4\.0\*ATMOSPHERE_PI\)/);
  // The remaining orders close as a geometric series rather than being marched.
  assert.match(bakeBody, /secondOrder\/max\(vec3\(1\.0\)-transfer/);
  // Ground bounce is part of what lights the air above it.
  assert.match(bakeBody, /GROUND_ALBEDO/);
});

test('distance to ground and to the top of atmosphere agree at the horizon', () => {
  // A ray that grazes the ground has both roots meeting, so the two distances coincide there.
  const r = ATMOSPHERE_RADIUS;
  const horizon = -Math.sqrt(1 - (GROUND_RADIUS * GROUND_RADIUS) / (r * r));
  assert.ok(Math.abs(distanceToGround(r, horizon) - -r * horizon) < 1e-6);
  assert.equal(distanceToGround(r, 1), 0);
});

test('every atmosphere function a bake shader calls is one the shared GLSL defines', () => {
  // A GLSL compile failure is silent from the outside: the scene still renders, just without
  // whatever that shader contributed. Renaming a shared helper and missing one call site cost a
  // whole multiple-scattering table once already, so the reference is checked without a GPU.
  const shared = ATMOSPHERE_MODEL_GLSL + ATMOSPHERE_TRANSMITTANCE_GLSL + ATMOSPHERE_SKY_RADIANCE_GLSL;
  const defined = new Set([...shared.matchAll(/(?:^|\s)(?:float|vec2|vec3|vec4|bool|void)\s+(atmosphere\w+)\s*\(/g)].map(match => match[1]));
  assert.ok(defined.size > 8, `only found ${defined.size} shared atmosphere helpers`);

  for (const [name, source] of [
    ['transmittance bake', TRANSMITTANCE_LUT_FRAGMENT_SHADER],
    ['multiple scattering bake', MULTIPLE_SCATTERING_LUT_FRAGMENT_SHADER],
    ['sky irradiance bake', SKY_IRRADIANCE_LUT_FRAGMENT_SHADER],
    ['sky radiance helper', ATMOSPHERE_SKY_RADIANCE_GLSL],
  ]) {
    const called = new Set([...source.matchAll(/\b(atmosphere\w+)\s*\(/g)].map(match => match[1]));
    for (const callee of called) {
      assert.ok(defined.has(callee), `${name} calls ${callee}, which nothing defines`);
    }
  }
});

test('sunrise illumination changes continuously across the finite solar disc', async () => {
  const { solarHorizonVisibility } = await import('../src/atmosphere-model.js');
  for (const radius of [1, 1.001, 1.01, 1.02]) {
    const horizon = -Math.sqrt(1 - 1 / (radius * radius));
    assert.ok(Math.abs(solarHorizonVisibility(radius, horizon) - .5) < 1e-10);
    assert.equal(solarHorizonVisibility(radius, horizon - .006), 0);
    assert.equal(solarHorizonVisibility(radius, horizon + .006), 1);
    let previous = 0;
    for (let offset = -.006; offset <= .006; offset += .0001) {
      const value = solarHorizonVisibility(radius, horizon + offset);
      assert.ok(value >= previous);
      assert.ok(value - previous < .025, 'no point-source flash at the horizon');
      previous = value;
    }
  }
});
