import test from 'node:test';
import assert from 'node:assert/strict';
import {auroraMagneticField,auroraEnergyFlux,auroraRayleighLuminance,auroraResponse,auroraDipoleFootpoint,auroraFieldStrength,AURORA_REFERENCE_RADIUS} from '../src/aurora-physics.js';
const near=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} ≠ ${b}`);
test('IGRF dipole has the correct pole quadrant and field-strength scale',()=>{
 const field=auroraMagneticField(Date.UTC(2025,0,1));
 near(Math.hypot(...field.axis),1);
 const lat=Math.asin(field.axis[1])*180/Math.PI,lon=Math.atan2(-field.axis[2],field.axis[0])*180/Math.PI;
 assert.ok(lat>80 && lat<81);assert.ok(lon>-74 && lon<-71);
 assert.ok(field.equatorialNanoTesla>29000 && field.equatorialNanoTesla<31000);
 near(auroraFieldStrength(1,Math.PI/2,field.equatorialNanoTesla),2*field.equatorialNanoTesla);
 near(auroraFieldStrength(2,0,field.equatorialNanoTesla),field.equatorialNanoTesla/8);
 const velocity=.025/(auroraFieldStrength(AURORA_REFERENCE_RADIUS,70*Math.PI/180,field.equatorialNanoTesla)*1e-9);
 assert.ok(velocity>300 && velocity<700);
});
test('geomagnetic secular variation advances within its valid epoch and explicitly clamps outside',()=>{
 const a=auroraMagneticField(Date.UTC(2025,0,1)),b=auroraMagneticField(Date.UTC(2030,0,1));
 assert.notDeepEqual(a.axis,b.axis);assert.equal(a.epochClamped,false);
 assert.equal(auroraMagneticField(Date.UTC(2020,0,1)).epochClamped,true);
 assert.deepEqual(auroraMagneticField(Date.UTC(2040,0,1)).axis,b.axis);
});
test('field-aligned mapping preserves L-shell and longitude in both hemispheres',()=>{
 const axis=[0,1,0];const referenceLat=70*Math.PI/180;
 const L=AURORA_REFERENCE_RADIUS/Math.cos(referenceLat)**2;
 for(const sign of [-1,1])for(const height of [110,130,260,450]){
   const r=1+height/6378.137,lat=sign*Math.acos(Math.sqrt(r/L)),lon=.8;
   const p=[r*Math.cos(lat)*Math.cos(lon),r*Math.sin(lat),-r*Math.cos(lat)*Math.sin(lon)];
   const foot=auroraDipoleFootpoint(p,axis);
   near(Math.asin(foot[1]),sign*referenceLat);near(Math.atan2(-foot[2],foot[0]),lon);
   near(Math.hypot(...foot),1);
 }
 near(auroraDipoleFootpoint([0,1.05,0],axis)[1],1);
});
test('probability inversion respects the offset, mW/m² unit equivalence and saturation',()=>{
 near(auroraEnergyFlux(10),0);near(auroraEnergyFlux(18),1);near(auroraEnergyFlux(50),5);
 near(auroraEnergyFlux(100),11.25);near(auroraEnergyFlux(150),11.25);
 near(auroraEnergyFlux(12,8),10.75);near(auroraEnergyFlux(0,8),0);
});
test('557.7 nm physical luminance agrees with independently tabulated photon-energy calculation',()=>{
 const photonEnergy=3.5618e-19;
 const independent=1e13*photonEnergy/(4*Math.PI)*683*.995;
 near(auroraRayleighLuminance(1),independent,1e-8);
 assert.ok(independent>.00019 && independent<.00020);
 near(auroraRayleighLuminance(10),10*auroraRayleighLuminance(1));
});
test('green decays much faster than red and integration is independent of frame rate',()=>{
 for(const lifetime of [.7,30]){
  const one=auroraResponse(10,0,1,lifetime);
  let many=10;for(let i=0;i<120;i++)many=auroraResponse(many,0,1/120,lifetime);
  near(one,many);
 }
 assert.ok(auroraResponse(10,0,2,.7)<1);
 assert.ok(auroraResponse(10,0,2,30)>9);
 near(auroraResponse(10,0,-1,.7),10);
});
test('emission profiles fit inside the physical shell and limb columns brighten geometrically',()=>{
 // Independently integrate the documented normalized Gaussian profiles.
 const density=(h,p,w)=>Math.exp(-.5*((h-p)/w)**2)/(Math.sqrt(2*Math.PI)*w);
 for(const [peak,width] of [[130,17],[260,60],[108,8]]){
   let sum=0;for(let h=85.05;h<500;h+=.1)sum+=density(h,peak,width)*.1;
   assert.ok(sum>.995 && sum<=1.00001);
 }
 let tangent=0;const impact=6378.137+130;
 for(let distance=-2000;distance<2000;distance+=1)tangent+=density(Math.hypot(impact,distance)-6378.137,130,17);
 assert.ok(tangent>10 && tangent<60);
});
