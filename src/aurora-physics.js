// Degree-one IGRF-14 (nT, nT/year), epoch 2025. Higher harmonics are omitted.
export function auroraMagneticField(time) {
  const date = new Date(time), year = date.getUTCFullYear();
  const decimalYear = year + (time - Date.UTC(year,0,1)) / (Date.UTC(year+1,0,1)-Date.UTC(year,0,1));
  const dt = Math.max(0,Math.min(5,decimalYear-2025));
  const g10=-29350+12.6*dt, g11=-1410.3+10*dt, h11=4545.5-21.5*dt;
  const strength=Math.hypot(g10,g11,h11);
  return { axis: [-g11/strength,-g10/strength,h11/strength], equatorialNanoTesla: strength, epochClamped: decimalYear<2025 || decimalYear>2030 };
}
export const AURORA_REFERENCE_RADIUS = 1 + 110 / 6378.137;
export const AURORA_GREEN_RESPONSE_SECONDS = .7;
export const AURORA_RED_RESPONSE_SECONDS = 30;
export const AURORA_GREEN_KR_PER_MW = 1.23;
// Scene units per cd/m² for the existing night-view display, not physical exposure of the entire globe.
export const AURORA_NIGHT_EXPOSURE = 180;
export function auroraEnergyFlux(probability, gain=1) { return Math.max(0,(Math.min(100,Math.max(0,probability*gain))-10)/8); }
export function auroraRayleighLuminance(kiloRayleigh, wavelengthNm=557.7, photopicEfficiency=.995) {
  return kiloRayleigh*1e13*6.62607015e-34*299792458/(wavelengthNm*1e-9)/(4*Math.PI)*683*photopicEfficiency;
}
export function auroraResponse(previous, target, seconds, lifetime) { return target+(previous-target)*Math.exp(-Math.max(0,seconds)/lifetime); }
export function auroraDipoleFootpoint(point, axis) {
  const radius=Math.hypot(...point), normal=point.map(v=>v/radius);
  const mu=normal.reduce((s,v,i)=>s+v*axis[i],0), c=Math.sqrt(Math.max(0,1-mu*mu));
  if(c<1e-8)return axis.map(v=>v*Math.sign(mu));
  const c0=Math.sqrt(Math.min(1,AURORA_REFERENCE_RADIUS/radius*c*c)), m0=(mu>=0?1:-1)*Math.sqrt(1-c0*c0);
  return normal.map((v,i)=>(v-axis[i]*mu)/c*c0+axis[i]*m0);
}
export function auroraFieldStrength(radius, magneticLatitude, equatorialNanoTesla) {
  return equatorialNanoTesla*Math.sqrt(1+3*Math.sin(magneticLatitude)**2)/radius**3;
}
export const AURORA_PHYSICS_GLSL = `
const float AURORA_REFERENCE=${AURORA_REFERENCE_RADIUS.toFixed(12)};
vec3 auroraFootpoint(vec3 point,vec3 axis){
  float radius=length(point);vec3 n=point/radius;float mu=dot(n,axis);
  float c=sqrt(max(0.0,1.0-mu*mu));if(c<.00001)return axis*sign(mu);
  float c0=sqrt(clamp(AURORA_REFERENCE/radius*c*c,0.0,1.0));
  return (n-axis*mu)/c*c0+axis*(mu>=0.0?1.0:-1.0)*sqrt(max(0.0,1.0-c0*c0));
}
float auroraFlux(float p,float gain){return max(0.0,(clamp(p*gain,0.0,100.0)-10.0)/8.0);}
float auroraProfile(float height,float peak,float width){
  float x=(height-peak)/width;return exp(-.5*x*x)/(2.50662827463*width);
}
`;
