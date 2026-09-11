import {installBundledEarthFixture,waitForBundledEarth} from './lib/render-test-fixture.mjs';
import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import * as physics from '../src/aurora-physics.js';
import * as atmosphere from '../src/atmosphere-model.js';
import * as shell from '../src/aurora-shell.js';
const baseline=process.argv[2];
if(!baseline)throw new Error('Usage: node scripts/verify-simple-aurora.mjs <baseline-commit>');
const original=execFileSync('git',['show',baseline+':src/aurora-render.ts'],{encoding:'utf8'});
const url=process.env.RENDER_TEST_URL||'http://127.0.0.1:5186/';
await mkdir('artifacts/simple-aurora',{recursive:true});
const constants={...physics,...atmosphere,...shell};
const fragment=Function(...Object.keys(constants),'return `'+original.match(/fragmentShader: `([\s\S]*?)`,\n/)[1]+'`;')(...Object.values(constants));
const browser=await chromium.launch({headless:true,args:['--use-angle=default','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1000,height:800},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
 // Keep asynchronous production-feed arrivals out of this fixed-input regression.
 await installBundledEarthFixture(page,url);
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();let body=await response.text();assert.ok(body.includes('updateFrame = () => {'));body=body.replace('requestAnimationFrame(animate);','requestAnimationFrame(animate);if(window.__pauseRender)return;');body=body.replace('updateFrame = () => {',`window.__benchAurora=async(baseline)=>{
 window.__pauseRender=true;
 const mesh=planet.children.find(o=>o.renderOrder===10);const current=mesh.material;const old=current.clone();old.fragmentShader=baseline;old.uniforms=current.uniforms;
 const gl=renderer.getContext(),pixel=new Uint8Array(4),samples={before:[],after:[]};
 for(let i=0;i<16;i++)for(const key of (i%2?['after','before']:['before','after'])){
 await new Promise(requestAnimationFrame);mesh.material=key==='before'?old:current;const t=performance.now();presentFrame();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(i>1)samples[key].push(performance.now()-t);
 }
 mesh.material=current;old.dispose();window.__pauseRender=false;return samples;
 };
 window.__checkAuroraCache=async()=>{
 window.__pauseRender=true;
 const {createAuroraLayer}=await import('/src/aurora-render.ts');
 const group=new THREE.Group(),layer=createAuroraLayer(group,transmittanceLookup);
 const source={observationTime:0,forecastTime:0,grid:new Uint8Array(360*181).fill(50)};
 const sun=new THREE.Vector3(1,0,0),calls=[];
 const update=(time,forecast=source,gain=1)=>{
 renderer.info.reset();layer.update(renderer,sun,time,Date.UTC(2026,8,9),forecast,gain);
 calls.push(renderer.info.render.calls);
 };
 update(0);update(1);update(59.99);update(60);update(60,{...source});
 update(60,source,2);update(61,source,0);update(62);update(0);
 return calls;
 };
 window.__auroraView=(view)=>{
 if(view==='close')window.__auroraDirection=camera.position.clone().normalize();
 const direction=window.__auroraDirection.clone();
 const right=new THREE.Vector3().crossVectors(direction,camera.up).normalize();
 if(view==='limb')direction.applyAxisAngle(right,1.25);
 controls.enableDamping=false;controls.target.set(0,0,0);
 camera.position.copy(direction).multiplyScalar(view==='close'?camera.position.length():7);
 camera.lookAt(0,0,0);controls.update();camera.updateMatrixWorld();presentFrame();
 return {camera:camera.position.toArray(),local:camera.position.clone().applyQuaternion(planet.quaternion.clone().invert()).toArray()};
 };
 window.__snapshotAurora=(baseline,before)=>{
 window.__pauseRender=true;
 const mesh=planet.children.find(o=>o.renderOrder===10);
 if(!window.__auroraCurrent)window.__auroraCurrent=mesh.material;
 if(!window.__auroraOld){window.__auroraOld=window.__auroraCurrent.clone();window.__auroraOld.fragmentShader=baseline;window.__auroraOld.uniforms=window.__auroraCurrent.uniforms;}
 mesh.material=before?window.__auroraOld:window.__auroraCurrent;camera.updateMatrixWorld();presentFrame();
 };
 updateFrame = () => {`);await route.fulfill({response,body});});
 await page.goto(url+'?time=2026-09-09T09:20:00Z&view=night');await waitForBundledEarth(page);
 await page.locator('#provenance-trigger').click();await page.locator('#view-debug summary').click();await page.locator('#aurora-mode').selectOption('demo');
 const results=[];
 for(const hemisphere of ['1','-1']){
 await page.locator('[data-aurora-view="'+hemisphere+'"]').click();await page.waitForTimeout(1500);
 results.push({hemisphere,timings:await page.evaluate(f=>window.__benchAurora(f),fragment)});
 await page.keyboard.press('Escape');
 for(const view of ['close','globe','limb']){
   console.log(hemisphere,view,await page.evaluate(view=>window.__auroraView(view),view));
   for(const before of [true,false]){
     await page.evaluate(({f,b})=>window.__snapshotAurora(f,b),{f:fragment,b:before});
     await page.screenshot({path:'artifacts/simple-aurora/'+hemisphere+'-'+view+(before?'-before':'-after')+'.png'});
   }
 }
 await page.evaluate(()=>{window.__pauseRender=false;});
 await page.locator('#provenance-trigger').click();

 }
 await page.keyboard.press('Escape');
 const cacheCalls=await page.evaluate(()=>window.__checkAuroraCache());assert.deepEqual(cacheCalls,[1,0,0,1,1,1,0,1,1]);
 console.log({results,cacheCalls,errors});await writeFile('artifacts/simple-aurora/comparison.json',JSON.stringify({results,cacheCalls,errors},null,2));assert.deepEqual(errors,[]);for(const r of results){const mean=a=>a.reduce((x,y)=>x+y)/a.length;assert.ok(mean(r.timings.after)<mean(r.timings.before)*.65);}
}finally{await browser.close();}
