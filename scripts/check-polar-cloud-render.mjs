// Repeatable captures against a local Vite server; hooks never ship in the app.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.argv[2]??'artifacts/polar-cloud-review/current';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=default','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});const errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/earth-state/latest-presentations.json',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.route('**/src/main.ts*',async route=>{
 const response=await route.fetch();const source=(await response.text()).replace('requestAnimationFrame(animate);','requestAnimationFrame(animate); if(window.__freeze) return;');
 const hook=`window.__polarTest={
 stop:()=>{window.__freeze=true;updateFrame=()=>{};},
 pose:(lat,lon,distance)=>{
   updateCelestialScene(new Date('2026-09-05T12:00:00Z'));
   const phi=lat*Math.PI/180,theta=lon*Math.PI/180;
   const direction=new THREE.Vector3(Math.cos(phi)*Math.cos(theta),Math.sin(phi),-Math.cos(phi)*Math.sin(theta));
   camera.position.copy(direction).applyQuaternion(planet.quaternion).multiplyScalar(distance);
   camera.up.set(0,1,0).applyQuaternion(planet.quaternion);controls.target.set(0,0,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();presentFrame();
 },
 clouds:(visible)=>{clouds.visible=visible;presentFrame();},
};`;
 await route.fulfill({response,body:source.replace('updateFrame = () => {',hook+'updateFrame = () => {')});
});
try {
 await page.goto(process.env.APP_URL??'http://127.0.0.1:5186');
 await page.waitForSelector('#loading[aria-hidden="true"]',{timeout:180000});
 await page.waitForFunction(()=>document.querySelector('#earth-state-summary')?.dataset.refresh==='current',undefined,{timeout:180000});
 await page.evaluate(()=>window.__polarTest.stop());
 const runtime=await page.locator('#earth-state-summary').evaluate(e=>({...e.dataset}));
 const samples=[];
 for(const [name,lat,lon,distance] of [['europe',52,12,2.25],['arctic',85,20,3.7],['svalbard',79,18,1.65],['global',45,12,7]]){
  await page.evaluate(([lat,lon,d])=>window.__polarTest.pose(lat,lon,d),[lat,lon,distance]);
  await page.screenshot({path:`${out}/${name}.png`});
  samples.push({name});
  if(name==='arctic'){await page.evaluate(()=>window.__polarTest.clouds(false));await page.screenshot({path:`${out}/arctic-ice.png`});await page.evaluate(()=>window.__polarTest.clouds(true));}
 }
 await writeFile(`${out}/report.json`,JSON.stringify({runtime,samples,errors},null,2));console.log(JSON.stringify({runtime,samples,errors}));assert.equal(errors.length,0);
}finally{await browser.close();}
