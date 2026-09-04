// GMGSI carries no retrieved optical depth, so the renderer has to assume a
// thickness for every cloud it draws. Opacity cannot say how deep a deck is, but
// it does order decks correctly, so the assumption is expressed as a curve over
// observed opacity rather than as one flat constant: a flat constant would
// extinguish thin cirrus and a thunderstorm identically. Where a retrieval does
// exist (SatCORPS) it wins and this is never consulted.
//
// A fully opaque pixel is assumed to be a typical thick cloud deck. Stratus and
// above run 10-20 and deep convection well past 50; 18 sits in that band and is
// the value the shadow weighting is already scaled for.
export const ASSUMED_THICK_CLOUD_OPTICAL_DEPTH = 18;
// The curvature keeps thin cloud where the superseded -log(1 - alpha * .82)
// already had it -- the two agree within .01 optical depth up to alpha .2 --
// while letting overcast climb to the assumed deck. Measured against the served
// 2026-09-02T07:00Z GMGSI frame, observed opacity fills the whole [0, 1] range
// (area-weighted mean .17, 11.9% of the globe above .7, 7.5% above .9), so the
// spread across that range is what the eye actually sees and must be preserved.
export const ASSUMED_THICKNESS_CURVATURE = 5;

// A cloud at night is not black, and drawing it black is why an overcast city
// read as a hole in the map instead of a glowing deck. Three real sources light
// the night side of a cloud:
//
//   - Moonlight, which follows the Moon's real phase and is absent at new moon.
//   - Airglow, faint and always present, which is why cloud is still faintly
//     visible from orbit on a moonless night.
//   - City light scattered up into the cloud base. This is the diffuse term #21
//     asked for. Cloud scatters far more than it absorbs, so the light a deck
//     takes out of a city is not destroyed -- it leaves the deck spread out.
//     The city is genuinely hidden; the cloud above it glows in its place.
//
// The spread is the whole point, so the upwelling light is sampled over a disc
// rather than straight down. UV is equirectangular, so a v offset covers twice
// the angle of the same u offset; the pair below is about half a degree, near
// 60 km at the equator.
export const NIGHT_CLOUD_MOONLIGHT_TINT = Object.freeze([.62, .68, .85]);
export const NIGHT_CLOUD_MOONLIGHT_SCALE = .78;
export const NIGHT_CLOUD_AIRGLOW_TINT = Object.freeze([.16, .22, .30]);
export const NIGHT_CLOUD_AIRGLOW_SCALE = .62;
export const NIGHT_CLOUD_UPWELLING_SCALE = .50;
export const NIGHT_CLOUD_UPWELLING_SPREAD_UV = Object.freeze([.0015, .003]);

// The packaged night composite is not purely emitted light. It carries a blue wash over the
// surface whose brightness tracks albedo, so that continents read as continents on a printed
// map: measured on the bundled 13500x6750 lights image, open ocean sits at (5,5,15), Australia's
// interior at (26,22,45), the empty Sahara at (35,32,60) and Antarctica at (42,51,84). Once the
// renderer applies its tone curve that wash stops being invisible and becomes a violet glow over
// any cloud-free land, most obviously Australia.
//
// Brightness cannot separate wash from light: rural India measures (41,39,48), level with the
// Sahara's wash. Colour can. The wash is strongly blue-dominant; emitted city light is not,
// because sodium and LED both put more energy into red than into blue. Tokyo is (212,201,183)
// and Lagos (85,77,68) -- both have blue below their red, so neither loses anything here.
//
// So the wash is estimated from blue in excess of what a warm source could have, and removed in
// the wash's own colour. Anything already warm or neutral is left untouched.
export const NIGHT_SURFACE_WASH_TINT = Object.freeze([.55, .55, 1]);

export const CLOUD_RENDER_GLSL = `
  const vec3 NIGHT_SURFACE_WASH_TINT=vec3(${NIGHT_SURFACE_WASH_TINT[0]},${NIGHT_SURFACE_WASH_TINT[1]},${NIGHT_SURFACE_WASH_TINT[2]});
  vec3 emittedNightLight(vec3 sampled){
    float blueExcess=max(sampled.b-max(sampled.r,sampled.g),0.0);
    // Per unit of wash, blue exceeds the warmer channels by (1 - max(r,g)) of the tint.
    float wash=blueExcess/(1.0-max(NIGHT_SURFACE_WASH_TINT.r,NIGHT_SURFACE_WASH_TINT.g));
    return max(sampled-wash*NIGHT_SURFACE_WASH_TINT,vec3(0.0));
  }
  vec2 directionUv(vec3 direction){
    direction=normalize(direction);
    return vec2(fract(atan(direction.z,-direction.x)/(2.0*PI)),.5+asin(clamp(direction.y,-1.0,1.0))/PI);
  }
  vec2 sphericalCloudShadowUv(vec3 surfaceNormal,vec3 lightDirection,float heightKm){
    float radius=1.0+heightKm/6371.0; float b=dot(surfaceNormal,lightDirection);
    float travel=-b+sqrt(max(b*b+radius*radius-1.0,0.0));
    return directionUv(normalize(surfaceNormal+lightDirection*travel));
  }
  float decodeCloudOpticalDepth(float encoded){ return exp(encoded*log(151.0))-1.0; }
  float assumedCloudOpticalDepth(float alpha){ return ${ASSUMED_THICK_CLOUD_OPTICAL_DEPTH.toFixed(1)}*(exp(clamp(alpha,0.0,1.0)*${ASSUMED_THICKNESS_CURVATURE.toFixed(1)})-1.0)/(exp(${ASSUMED_THICKNESS_CURVATURE.toFixed(1)})-1.0); }
  float cloudTransmission(float opticalDepth,float quality){ return exp(-opticalDepth*quality); }
  vec3 upwellingCityLight(sampler2D nightMap,vec2 uv){
    vec2 e=vec2(${NIGHT_CLOUD_UPWELLING_SPREAD_UV[0]},${NIGHT_CLOUD_UPWELLING_SPREAD_UV[1]});
    vec3 total=emittedNightLight(texture2D(nightMap,uv).rgb)*.28;
    total+=emittedNightLight(texture2D(nightMap,uv+vec2(e.x,0.0)).rgb)*.09;
    total+=emittedNightLight(texture2D(nightMap,uv-vec2(e.x,0.0)).rgb)*.09;
    total+=emittedNightLight(texture2D(nightMap,uv+vec2(0.0,e.y)).rgb)*.09;
    total+=emittedNightLight(texture2D(nightMap,uv-vec2(0.0,e.y)).rgb)*.09;
    total+=emittedNightLight(texture2D(nightMap,uv+e*.7).rgb)*.09;
    total+=emittedNightLight(texture2D(nightMap,uv-e*.7).rgb)*.09;
    total+=emittedNightLight(texture2D(nightMap,uv+vec2(e.x,-e.y)*.7).rgb)*.09;
    total+=emittedNightLight(texture2D(nightMap,uv-vec2(e.x,-e.y)*.7).rgb)*.09;
    return total;
  }
  vec3 nightCloudIllumination(float moonLambert,float moonIllumination,vec3 upwelling){
    vec3 moonlight=vec3(${NIGHT_CLOUD_MOONLIGHT_TINT[0]},${NIGHT_CLOUD_MOONLIGHT_TINT[1]},${NIGHT_CLOUD_MOONLIGHT_TINT[2]})
      *max(moonLambert,0.0)*clamp(moonIllumination,0.0,1.0)*${NIGHT_CLOUD_MOONLIGHT_SCALE};
    vec3 airglow=vec3(${NIGHT_CLOUD_AIRGLOW_TINT[0]},${NIGHT_CLOUD_AIRGLOW_TINT[1]},${NIGHT_CLOUD_AIRGLOW_TINT[2]})*${NIGHT_CLOUD_AIRGLOW_SCALE};
    return moonlight+airglow+max(upwelling,vec3(0.0))*${NIGHT_CLOUD_UPWELLING_SCALE};
  }
  float cloudProbeScore(vec4 physics,float probeHeightKm){
    return physics.a*exp(-abs(physics.b*20.0-probeHeightKm)*0.45);
  }
`;

export const CLOUD_ALTITUDE_PROBES_KM = Object.freeze([1.5, 6.5, 11.5, 16.5]);

function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

export function sphereUv(direction) {
  const [x, y, z] = normalize(direction);
  const rawU = Math.atan2(z, -x) / (2 * Math.PI);
  return [((rawU % 1) + 1) % 1, .5 + Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI];
}

export function shadowCasterUv(surfaceDirection, sunDirection, heightKm) {
  const surface = normalize(surfaceDirection);
  const sun = normalize(sunDirection);
  const radius = 1 + Math.max(0, heightKm) / 6371;
  const b = surface[0] * sun[0] + surface[1] * sun[1] + surface[2] * sun[2];
  const travel = -b + Math.sqrt(Math.max(0, b * b + radius * radius - 1));
  return sphereUv(surface.map((value, index) => value + sun[index] * travel));
}

export function discoverCloudCaster(surfaceDirection, sunDirection, samplePhysics) {
  let selected = { heightKm: 11, quality: 0, score: 0 };
  for (const probeHeightKm of CLOUD_ALTITUDE_PROBES_KM) {
    const physics = samplePhysics(shadowCasterUv(surfaceDirection, sunDirection, probeHeightKm));
    const quality = Math.max(0, Math.min(1, physics?.quality ?? 0));
    const heightKm = Math.max(0, Math.min(20, physics?.heightKm ?? 0));
    const score = quality * Math.exp(-Math.abs(heightKm - probeHeightKm) * .45);
    if (score > selected.score) selected = { heightKm, quality, score };
  }
  return selected;
}

/**
 * The CPU mirror of the shader's `assumedCloudOpticalDepth`. Both are generated
 * from the same two constants above so they cannot drift apart.
 */
export function assumedCloudOpticalDepth(alpha) {
  const opacity = Math.max(0, Math.min(1, alpha));
  return ASSUMED_THICK_CLOUD_OPTICAL_DEPTH
    * (Math.exp(opacity * ASSUMED_THICKNESS_CURVATURE) - 1)
    / (Math.exp(ASSUMED_THICKNESS_CURVATURE) - 1);
}

/**
 * The CPU mirror of the shader's `nightCloudIllumination`, generated from the
 * same constants. `upwelling` is the already-spread city light arriving at the
 * cloud base.
 */
export function nightCloudIllumination({ moonLambert = 0, moonIllumination = 0, upwelling = [0, 0, 0] }) {
  const moon = Math.max(0, moonLambert) * Math.max(0, Math.min(1, moonIllumination)) * NIGHT_CLOUD_MOONLIGHT_SCALE;
  return NIGHT_CLOUD_MOONLIGHT_TINT.map((tint, channel) => tint * moon
    + NIGHT_CLOUD_AIRGLOW_TINT[channel] * NIGHT_CLOUD_AIRGLOW_SCALE
    + Math.max(0, upwelling[channel] ?? 0) * NIGHT_CLOUD_UPWELLING_SCALE);
}

/**
 * The CPU mirror of the shader's `emittedNightLight`, generated from the same tint. Estimates
 * how much of a night-map sample is the composite's surface wash rather than emitted light, and
 * removes it.
 */
export function emittedNightLight([red, green, blue]) {
  const warmest = Math.max(red, green);
  const blueExcess = Math.max(blue - warmest, 0);
  const wash = blueExcess / (1 - Math.max(NIGHT_SURFACE_WASH_TINT[0], NIGHT_SURFACE_WASH_TINT[1]));
  return [red, green, blue].map((value, channel) => Math.max(value - wash * NIGHT_SURFACE_WASH_TINT[channel], 0));
}

export function cityLightTransmission(opticalDepth, quality) {
  return Math.exp(-Math.max(0, opticalDepth) * Math.max(0, Math.min(1, quality)));
}

export function cloudShadowStrength({ casterAlpha, casterOpticalDepth, casterQuality, casterDensity, daylight }) {
  const opticalWeight = .12 + (.34 - .12) * Math.max(0, Math.min(1, casterOpticalDepth / 18));
  return casterAlpha * casterDensity * opticalWeight * casterQuality * daylight;
}
