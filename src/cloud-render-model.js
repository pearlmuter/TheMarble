export const CLOUD_RENDER_GLSL = `
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
  float cloudTransmission(float opticalDepth,float quality){ return exp(-opticalDepth*quality); }
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

export function cityLightTransmission(opticalDepth, quality) {
  return Math.exp(-Math.max(0, opticalDepth) * Math.max(0, Math.min(1, quality)));
}

export function cloudShadowStrength({ casterAlpha, casterOpticalDepth, casterQuality, casterDensity, daylight }) {
  const opticalWeight = .12 + (.34 - .12) * Math.max(0, Math.min(1, casterOpticalDepth / 18));
  return casterAlpha * casterDensity * opticalWeight * casterQuality * daylight;
}
