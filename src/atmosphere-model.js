// The atmosphere Terra actually integrates.
//
// The coefficients here were already right (they are Bruneton's Earth values, see
// docs/atmospheric-lighting-research.md). What was wrong was the integration: a ten-step
// uniform march against an 8 km scale height steps ~22 scale heights at a time near the limb,
// so the dense lower atmosphere — which holds nearly all the optical mass — fell between
// samples. The blue never accumulated, the broad ozone tent did, and the limb came out thin
// and magenta.
//
// This module owns the physics as data plus GLSL, with CPU mirrors of every shader function so
// the parametrisation and the integral can be tested without a GPU. It is deliberately free of
// three.js: main.ts owns the render targets, this owns what goes in them.
//
// Lengths are in Earth radii (1.0 = 6371 km) and coefficients are per that unit, which is why
// they look large: Rayleigh scattering at 440 nm is 33.1e-6 /m, and 33.1e-6 * 6.371e6 = 210.9.

const EARTH_RADIUS_KM = 6371;
const km = kilometres => kilometres / EARTH_RADIUS_KM;

export const GROUND_RADIUS = 1;
// 127 km. Above the Kármán line and well above the ozone tent, and — deliberately — below the
// ISS altitude the camera can descend to, so the shell is always marched from outside it.
export const ATMOSPHERE_RADIUS = 1.02;

export const RAYLEIGH_SCALE_HEIGHT = km(8);
export const MIE_SCALE_HEIGHT = km(1.2);
export const OZONE_PEAK_ALTITUDE = km(25);
export const OZONE_HALF_WIDTH = km(15);

/** Rayleigh scattering at 680 / 550 / 440 nm. */
export const BETA_RAYLEIGH = Object.freeze([36.96, 86.38, 210.88]);
export const BETA_MIE_SCATTERING = Object.freeze([25.46, 25.46, 25.46]);
export const BETA_MIE_EXTINCTION = Object.freeze([28.3, 28.3, 28.3]);
/** Ozone Chappuis absorption. Green-heavy, which is what tints twilight — it scatters nothing. */
export const BETA_OZONE = Object.freeze([4.14, 11.98, 0.54]);
export const MIE_ASYMMETRY = 0.8;

/**
 * Radiance from the scattering integral comes out in units of solar irradiance, while the
 * surface shader draws reflectance directly — a white Lambertian surface facing the Sun reads
 * 1.0. Multiplying by pi puts scattered light into that same space, which is what lets the
 * airlight over the ocean and the albedo of the ocean be compared at all.
 */
export const SOLAR_IRRADIANCE = Math.PI;

/**
 * Samples per shell march, and how hard they bunch toward the segment's lowest point.
 *
 * Uniform sampling is the defect this whole module exists to fix. A limb chord is ~0.28 long
 * against an 8 km (0.00126) scale height, so ten uniform steps span twenty-two scale heights
 * each and walk straight past the dense air that does nearly all the scattering. Clustering
 * toward the lowest point on the segment — the ground for a ray that lands, the tangent point
 * for a limb ray — puts the samples where the density actually is.
 */
export const ATMOSPHERE_MARCH_STEPS = 32;
export const ATMOSPHERE_MARCH_CURVATURE = 3;

export const TRANSMITTANCE_LUT_WIDTH = 256;
export const TRANSMITTANCE_LUT_HEIGHT = 64;
/** One-time cost, so it is sampled far past what a per-frame march could afford. */
export const TRANSMITTANCE_LUT_SAMPLES = 64;

// ------------------------------------------------------------------ CPU mirrors

export function rayleighDensity(altitude) {
  return Math.exp(-Math.max(altitude, 0) / RAYLEIGH_SCALE_HEIGHT);
}

export function mieDensity(altitude) {
  return Math.exp(-Math.max(altitude, 0) / MIE_SCALE_HEIGHT);
}

/** A tent peaking at 25 km, which is how Bruneton models the ozone layer. */
export function ozoneDensity(altitude) {
  return Math.max(0, 1 - Math.abs(Math.max(altitude, 0) - OZONE_PEAK_ALTITUDE) / OZONE_HALF_WIDTH);
}

/** Distance from radius `r` along a ray of zenith cosine `mu` to the top of the atmosphere. */
export function distanceToTopAtmosphere(r, mu) {
  const discriminant = r * r * (mu * mu - 1) + ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(discriminant, 0)));
}

export function rayIntersectsGround(r, mu) {
  return mu < 0 && r * r * (mu * mu - 1) + GROUND_RADIUS * GROUND_RADIUS >= 0;
}

/**
 * Bruneton's transmittance parametrisation. `xR` runs on the distance to the horizon and `xMu`
 * on the distance to the top of the atmosphere, which puts texel density where the function
 * actually bends — a plain (altitude, cosine) grid wastes most of its resolution on space.
 */
export function transmittanceUv(r, mu) {
  const H = Math.sqrt(ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS - GROUND_RADIUS * GROUND_RADIUS);
  const rho = Math.sqrt(Math.max(r * r - GROUND_RADIUS * GROUND_RADIUS, 0));
  const d = distanceToTopAtmosphere(r, mu);
  const dMin = ATMOSPHERE_RADIUS - r;
  const dMax = rho + H;
  return [unitToTexture((d - dMin) / (dMax - dMin), TRANSMITTANCE_LUT_WIDTH), unitToTexture(rho / H, TRANSMITTANCE_LUT_HEIGHT)];
}

export function transmittanceRMu(u, v) {
  const H = Math.sqrt(ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS - GROUND_RADIUS * GROUND_RADIUS);
  const rho = H * textureToUnit(v, TRANSMITTANCE_LUT_HEIGHT);
  const r = Math.sqrt(rho * rho + GROUND_RADIUS * GROUND_RADIUS);
  const dMin = ATMOSPHERE_RADIUS - r;
  const dMax = rho + H;
  const d = dMin + textureToUnit(u, TRANSMITTANCE_LUT_WIDTH) * (dMax - dMin);
  const mu = d === 0 ? 1 : clamp((H * H - rho * rho - d * d) / (2 * r * d), -1, 1);
  return { r, mu };
}

/** Optical depth from `r` along `mu` to the top of the atmosphere, per RGB channel. */
export function opticalDepthToTopAtmosphere(r, mu, samples = TRANSMITTANCE_LUT_SAMPLES) {
  const distance = distanceToTopAtmosphere(r, mu);
  const step = distance / samples;
  const depth = [0, 0, 0];
  for (let index = 0; index < samples; index += 1) {
    const along = (index + 0.5) * step;
    const radius = clamp(Math.sqrt(along * along + 2 * r * mu * along + r * r), GROUND_RADIUS, ATMOSPHERE_RADIUS);
    const altitude = radius - GROUND_RADIUS;
    const densityR = rayleighDensity(altitude);
    const densityM = mieDensity(altitude);
    const densityO = ozoneDensity(altitude);
    for (let channel = 0; channel < 3; channel += 1) {
      depth[channel] += (BETA_RAYLEIGH[channel] * densityR
        + BETA_MIE_EXTINCTION[channel] * densityM
        + BETA_OZONE[channel] * densityO) * step;
    }
  }
  return depth;
}

export function transmittanceToTopAtmosphere(r, mu, samples) {
  return opticalDepthToTopAtmosphere(r, mu, samples).map(depth => Math.exp(-depth));
}

/**
 * Transmittance between two points on one ray, as a ratio of two lookups. Which way round the
 * ratio goes depends on whether the ray is descending toward the ground, because the stored
 * quantity is always measured outward.
 */
export function transmittanceOverSegment(sample, r, mu, distance, intersectsGround) {
  const rd = clamp(Math.sqrt(distance * distance + 2 * r * mu * distance + r * r), GROUND_RADIUS, ATMOSPHERE_RADIUS);
  const muD = clamp((r * mu + distance) / rd, -1, 1);
  const [near, far] = intersectsGround
    ? [sample(rd, -muD), sample(r, -mu)]
    : [sample(r, mu), sample(rd, muD)];
  return near.map((value, channel) => Math.min(far[channel] > 0 ? value / far[channel] : 1, 1));
}

/**
 * Maps `u` in [0,1] to a distance along the segment [t0,t1], bunching samples toward `tc`.
 * Monotonic, and exact at both ends, so quadrature over consecutive boundaries still covers
 * the whole segment.
 */
export function marchDistance(u, t0, tc, t1, curvature = ATMOSPHERE_MARCH_CURVATURE) {
  const lengthA = tc - t0;
  const lengthB = t1 - tc;
  const total = lengthA + lengthB;
  const split = total > 0 ? lengthA / total : 1;
  if (u <= split) {
    const w = split > 0 ? u / split : 1;
    return tc - lengthA * Math.pow(1 - w, curvature);
  }
  const w = split < 1 ? (u - split) / (1 - split) : 0;
  return tc + lengthB * Math.pow(w, curvature);
}

/** The lowest point of the camera ray's segment, which is where the samples should bunch. */
export function closestApproach(origin, direction, t0, t1) {
  const along = -(origin[0] * direction[0] + origin[1] * direction[1] + origin[2] * direction[2]);
  return clamp(along, t0, t1);
}

export function rayleighPhase(mu) {
  return (3 / (16 * Math.PI)) * (1 + mu * mu);
}

/** Cornette–Shanks, which is the aerosol lobe the research note calls for. */
export function miePhase(mu, g = MIE_ASYMMETRY) {
  const numerator = (1 - g * g) * (1 + mu * mu);
  const denominator = (2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5);
  return (3 / (8 * Math.PI)) * (numerator / denominator);
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

/** Half-texel inset, so the ends of the range land on texel centres rather than off the edge. */
function unitToTexture(value, size) {
  return 0.5 / size + clamp(value, 0, 1) * (1 - 1 / size);
}

function textureToUnit(value, size) {
  return (value - 0.5 / size) / (1 - 1 / size);
}

// ------------------------------------------------------------------ GLSL

const f = value => {
  const text = value.toPrecision(9);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};
const v3 = ([x, y, z]) => `vec3(${f(x)},${f(y)},${f(z)})`;

/**
 * Constants and parametrisation, shared verbatim by the LUT builder and every consumer so a
 * lookup can never disagree with what was baked.
 */
export const ATMOSPHERE_MODEL_GLSL = `
  const float ATMOSPHERE_PI=3.14159265359;
  const float GROUND_RADIUS=${f(GROUND_RADIUS)};
  const float ATMOSPHERE_RADIUS=${f(ATMOSPHERE_RADIUS)};
  const float RAYLEIGH_SCALE_HEIGHT=${f(RAYLEIGH_SCALE_HEIGHT)};
  const float MIE_SCALE_HEIGHT=${f(MIE_SCALE_HEIGHT)};
  const float OZONE_PEAK_ALTITUDE=${f(OZONE_PEAK_ALTITUDE)};
  const float OZONE_HALF_WIDTH=${f(OZONE_HALF_WIDTH)};
  const vec3 BETA_RAYLEIGH=${v3(BETA_RAYLEIGH)};
  const vec3 BETA_MIE_SCATTERING=${v3(BETA_MIE_SCATTERING)};
  const vec3 BETA_MIE_EXTINCTION=${v3(BETA_MIE_EXTINCTION)};
  const vec3 BETA_OZONE=${v3(BETA_OZONE)};
  const float MIE_ASYMMETRY=${f(MIE_ASYMMETRY)};
  const vec2 TRANSMITTANCE_LUT_SIZE=vec2(${f(TRANSMITTANCE_LUT_WIDTH)},${f(TRANSMITTANCE_LUT_HEIGHT)});
  const float SOLAR_IRRADIANCE=${f(SOLAR_IRRADIANCE)};
  const float ATMOSPHERE_MARCH_CURVATURE=${f(ATMOSPHERE_MARCH_CURVATURE)};
  const float ATMOSPHERE_MARCH_STEPS_F=${f(ATMOSPHERE_MARCH_STEPS)};

  float atmosphereRayleighDensity(float altitude){ return exp(-max(altitude,0.0)/RAYLEIGH_SCALE_HEIGHT); }
  float atmosphereMieDensity(float altitude){ return exp(-max(altitude,0.0)/MIE_SCALE_HEIGHT); }
  float atmosphereOzoneDensity(float altitude){ return max(0.0,1.0-abs(max(altitude,0.0)-OZONE_PEAK_ALTITUDE)/OZONE_HALF_WIDTH); }
  vec3 atmosphereExtinction(float altitude){
    return BETA_RAYLEIGH*atmosphereRayleighDensity(altitude)
      +BETA_MIE_EXTINCTION*atmosphereMieDensity(altitude)
      +BETA_OZONE*atmosphereOzoneDensity(altitude);
  }
  float atmosphereDistanceToTop(float r,float mu){
    float discriminant=r*r*(mu*mu-1.0)+ATMOSPHERE_RADIUS*ATMOSPHERE_RADIUS;
    return max(0.0,-r*mu+sqrt(max(discriminant,0.0)));
  }
  bool atmosphereRayHitsGround(float r,float mu){
    return mu<0.0&&r*r*(mu*mu-1.0)+GROUND_RADIUS*GROUND_RADIUS>=0.0;
  }
  float atmosphereUnitToTexture(float value,float size){ return 0.5/size+clamp(value,0.0,1.0)*(1.0-1.0/size); }
  float atmosphereTextureToUnit(float value,float size){ return (value-0.5/size)/(1.0-1.0/size); }
  vec2 atmosphereTransmittanceUv(float r,float mu){
    float H=sqrt(ATMOSPHERE_RADIUS*ATMOSPHERE_RADIUS-GROUND_RADIUS*GROUND_RADIUS);
    float rho=sqrt(max(r*r-GROUND_RADIUS*GROUND_RADIUS,0.0));
    float d=atmosphereDistanceToTop(r,mu);
    float dMin=ATMOSPHERE_RADIUS-r; float dMax=rho+H;
    return vec2(atmosphereUnitToTexture((d-dMin)/(dMax-dMin),TRANSMITTANCE_LUT_SIZE.x),
                atmosphereUnitToTexture(rho/H,TRANSMITTANCE_LUT_SIZE.y));
  }
  void atmosphereTransmittanceRMu(vec2 uv,out float r,out float mu){
    float H=sqrt(ATMOSPHERE_RADIUS*ATMOSPHERE_RADIUS-GROUND_RADIUS*GROUND_RADIUS);
    float rho=H*atmosphereTextureToUnit(uv.y,TRANSMITTANCE_LUT_SIZE.y);
    r=sqrt(rho*rho+GROUND_RADIUS*GROUND_RADIUS);
    float dMin=ATMOSPHERE_RADIUS-r; float dMax=rho+H;
    float d=dMin+atmosphereTextureToUnit(uv.x,TRANSMITTANCE_LUT_SIZE.x)*(dMax-dMin);
    mu=d==0.0?1.0:clamp((H*H-rho*rho-d*d)/(2.0*r*d),-1.0,1.0);
  }
`;

/** Lookups against the baked transmittance texture. Requires ATMOSPHERE_MODEL_GLSL first. */
export const ATMOSPHERE_TRANSMITTANCE_GLSL = `
  vec3 atmosphereTransmittanceToTop(sampler2D lut,float r,float mu){
    return texture2D(lut,atmosphereTransmittanceUv(clamp(r,GROUND_RADIUS,ATMOSPHERE_RADIUS),clamp(mu,-1.0,1.0))).rgb;
  }
  // Between two points on one ray, as a ratio of two outward lookups. The order flips when the
  // ray is descending, because the stored quantity is always measured outward.
  vec3 atmosphereTransmittanceOverSegment(sampler2D lut,float r,float mu,float distanceAlong,bool hitsGround){
    float rd=clamp(sqrt(distanceAlong*distanceAlong+2.0*r*mu*distanceAlong+r*r),GROUND_RADIUS,ATMOSPHERE_RADIUS);
    float muD=clamp((r*mu+distanceAlong)/rd,-1.0,1.0);
    vec3 near=hitsGround?atmosphereTransmittanceToTop(lut,rd,-muD):atmosphereTransmittanceToTop(lut,r,mu);
    vec3 far=hitsGround?atmosphereTransmittanceToTop(lut,r,-mu):atmosphereTransmittanceToTop(lut,rd,muD);
    return clamp(near/max(far,vec3(1e-6)),vec3(0.0),vec3(1.0));
  }
  // Direct sunlight reaching a point: zero where the solid Earth is in the way, and otherwise
  // the transmittance out along the Sun vector. This is what makes the terminator warm without
  // anyone painting an orange band.
  vec3 atmosphereSunTransmittance(sampler2D lut,vec3 position,vec3 sunDirection){
    float r=max(length(position),GROUND_RADIUS);
    float muSun=dot(position/r,sunDirection);
    if(atmosphereRayHitsGround(r,muSun)) return vec3(0.0);
    return atmosphereTransmittanceToTop(lut,r,muSun);
  }
  // Bunches samples toward the lowest point of the segment. See ATMOSPHERE_MARCH_STEPS.
  float atmosphereMarchDistance(float u,float t0,float tc,float t1){
    float lengthA=tc-t0; float lengthB=t1-tc; float total=lengthA+lengthB;
    float split=total>0.0?lengthA/total:1.0;
    if(u<=split){
      float w=split>0.0?u/split:1.0;
      return tc-lengthA*pow(1.0-w,ATMOSPHERE_MARCH_CURVATURE);
    }
    float w=split<1.0?(u-split)/(1.0-split):0.0;
    return tc+lengthB*pow(w,ATMOSPHERE_MARCH_CURVATURE);
  }
  float atmosphereRayleighPhase(float mu){ return 3.0/(16.0*ATMOSPHERE_PI)*(1.0+mu*mu); }
  float atmosphereMiePhase(float mu){
    float g=MIE_ASYMMETRY;
    return 3.0/(8.0*ATMOSPHERE_PI)*((1.0-g*g)*(1.0+mu*mu))/((2.0+g*g)*pow(max(1.0+g*g-2.0*g*mu,1e-4),1.5));
  }
`;

/** Fragment shader that bakes the transmittance LUT. Rendered once into a float target. */
export const TRANSMITTANCE_LUT_FRAGMENT_SHADER = `
  varying vec2 vUv;
  ${ATMOSPHERE_MODEL_GLSL}
  void main(){
    float r; float mu;
    atmosphereTransmittanceRMu(vUv,r,mu);
    float distance=atmosphereDistanceToTop(r,mu);
    float step=distance/${f(TRANSMITTANCE_LUT_SAMPLES)};
    vec3 depth=vec3(0.0);
    for(int index=0;index<${TRANSMITTANCE_LUT_SAMPLES};index++){
      float along=(float(index)+0.5)*step;
      float radius=clamp(sqrt(along*along+2.0*r*mu*along+r*r),GROUND_RADIUS,ATMOSPHERE_RADIUS);
      depth+=atmosphereExtinction(radius-GROUND_RADIUS)*step;
    }
    gl_FragColor=vec4(exp(-depth),1.0);
  }
`;
