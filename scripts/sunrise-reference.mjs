// Independent straight-ray single-scattering reference. No runtime LUT or march helpers.
// Double precision; uniform midpoint quadrature; imports only the physical coefficients.
import {
  ATMOSPHERE_RADIUS as RT, BETA_RAYLEIGH as BR, BETA_MIE_SCATTERING as BM,
  BETA_MIE_EXTINCTION as BE, BETA_OZONE as BO,
  RAYLEIGH_SCALE_HEIGHT as HR, MIE_SCALE_HEIGHT as HM,
  OZONE_PEAK_ALTITUDE as HO, OZONE_HALF_WIDTH as WO, MIE_ASYMMETRY as G,
} from '../src/atmosphere-model.js';
export const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const at = (p,d,t) => p.map((v,i)=>v+d[i]*t);
const length = p => Math.hypot(...p);
function interval(p,d,r) {
  const b=dot(p,d), h=b*b-dot(p,p)+r*r;
  return h<0 ? null : [-b-Math.sqrt(h),-b+Math.sqrt(h)];
}
function density(p) {
  const h=Math.max(length(p)-1,0);
  return [Math.exp(-h/HR),Math.exp(-h/HM),Math.max(0,1-Math.abs(h-HO)/WO)];
}
function extinction(d,c) { return BR[c]*d[0]+BE[c]*d[1]+BO[c]*d[2]; }
export function transmission(p,d,steps=512) {
  const ground=interval(p,d,1);
  if(ground && ground[0]>1e-9) return [0,0,0];
  const top=interval(p,d,RT);
  if(!top || top[1]<=0) return [1,1,1];
  const start=Math.max(0,top[0]), step=(top[1]-start)/steps, tau=[0,0,0];
  for(let i=0;i<steps;i++) {
    const rho=density(at(p,d,start+(i+.5)*step));
    for(let c=0;c<3;c++) tau[c]+=extinction(rho,c)*step;
  }
  return tau.map(v=>Math.exp(-v));
}
function solarTransmission(p,s,steps,finiteDisc) {
  if(finiteDisc) {
    // Equal-area samples of the apparent solar disc, integrated per ray.
    const n=37, a=.00465, reference=Math.abs(s[1])<.9?[0,1,0]:[1,0,0];
    const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const x=cross(reference,s), scale=length(x); for(let c=0;c<3;c++)x[c]/=scale;
    const y=cross(s,x), sum=[0,0,0];
    for(let i=0;i<n;i++) {
      const r=a*Math.sqrt((i+.5)/n), phi=i*2.399963229728653;
      const ray=s.map((v,c)=>v*Math.cos(r)+(x[c]*Math.cos(phi)+y[c]*Math.sin(phi))*Math.sin(r));
      const t=transmission(p,ray,steps); for(let c=0;c<3;c++) sum[c]+=t[c]/n;
    }
    return sum;
  }
  // Match runtime finite-disc horizon approximation, but integrate its column directly.
  const r=length(p), normal=p.map(v=>v/r), mu=dot(normal,s), horizon=-Math.sqrt(Math.max(0,1-1/(r*r)));
  const w=.00465/r, q=Math.max(0,Math.min(1,(mu-horizon+w)/(2*w))), visible=q*q*(3-2*q);
  if(!visible)return [0,0,0];
  let ray=s;
  if(mu<horizon) {
    const tangent=s.map((v,c)=>v-normal[c]*mu), n=length(tangent);
    ray=normal.map((v,c)=>v*horizon+tangent[c]/n*Math.sqrt(1-horizon*horizon));
  }
  return transmission(p,ray,steps).map(v=>v*visible);
}
export function referenceRadiance({origin,ray,sun,viewSteps=2048,lightSteps=512,finiteDisc=false}) {
  const top=interval(origin,ray,RT); if(!top || top[1]<=0) return [0,0,0];
  const ground=interval(origin,ray,1), start=Math.max(0,top[0]);
  const end=ground&&ground[0]>0?Math.min(top[1],ground[0]):top[1];
  const step=(end-start)/viewSteps, tau=[0,0,0], radiance=[0,0,0], mu=dot(ray,sun);
  const pr=3/(16*Math.PI)*(1+mu*mu);
  const pm=3/(8*Math.PI)*(1-G*G)*(1+mu*mu)/((2+G*G)*(1+G*G-2*G*mu)**1.5);
  for(let i=0;i<viewSteps;i++) {
    const p=at(origin,ray,start+(i+.5)*step), rho=density(p), light=solarTransmission(p,sun,lightSteps,finiteDisc);
    for(let c=0;c<3;c++) {
      const optical=extinction(rho,c)*step;
      radiance[c]+=Math.exp(-tau[c]-.5*optical)*light[c]*(BR[c]*rho[0]*pr+BM[c]*rho[1]*pm)*step*Math.PI;
      tau[c]+=optical;
    }
  }
  return radiance;
}
export function limbCase(heightKm,clearanceDegrees,distance=7) {
  const angle=Math.asin((1+heightKm/6371)/distance);
  const solarAngle=Math.asin(1/distance)+clearanceDegrees*Math.PI/180;
  return {heightKm,clearanceDegrees,distance,origin:[0,0,distance],ray:[Math.sin(angle),0,-Math.cos(angle)],sun:[Math.sin(solarAngle),0,-Math.cos(solarAngle)]};
}
