import { ATMOSPHERE_MODEL_GLSL, ATMOSPHERE_TRANSMITTANCE_GLSL } from './atmosphere-model.js';

// The photosphere is geometry; glare is produced later from its visible HDR pixels.
// No solar billboard can paint a second disc across the terrestrial silhouette.
export const SOLAR_DISC_FRAGMENT_SHADER = `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  uniform sampler2D transmittanceLut;
  uniform vec3 moonPosition;
  uniform float moonRadius;
  ${ATMOSPHERE_MODEL_GLSL}
  ${ATMOSPHERE_TRANSMITTANCE_GLSL}
  bool solarRayBlocked(vec3 origin,vec3 ray,float radius){
    float along=-dot(origin,ray);
    return along>0.0 && length(origin+ray*along)<radius;
  }
  void main(){
    vec3 ray=normalize(vWorldPosition-cameraPosition);
    if(solarRayBlocked(cameraPosition,ray,GROUND_RADIUS)) discard;
    if(solarRayBlocked(cameraPosition-moonPosition,ray,moonRadius)) discard;
    float along=-dot(cameraPosition,ray);
    float impact=length(cameraPosition+ray*along);
    vec3 transmission=vec3(1.0);
    if(along>0.0 && impact<ATMOSPHERE_RADIUS){
      // At closest approach the outward column is half the full atmospheric chord.
      // Squaring the shared LUT includes molecular, aerosol AND ozone extinction,
      // with no discontinuous 60 km cutoff or duplicate coefficients.
      vec3 halfChord=atmosphereTransmittanceToTop(transmittanceLut,impact,0.0);
      transmission=halfChord*halfChord;
    }
    vec3 towardObserver=normalize(cameraPosition-vWorldPosition);
    float mu=max(dot(normalize(vWorldNormal),towardObserver),0.0);
    float limbDarkening=.4+.6*mu;
    // Display-calibrated HDR radiance: the photosphere saturates a daylight exposure.
    // Bloom is computed from this attenuated, occulted signal before tone mapping.
    gl_FragColor=vec4(vec3(80.0)*limbDarkening*transmission,1.0);
  }
`;
