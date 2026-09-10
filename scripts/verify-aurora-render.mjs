import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import * as physics from '../src/aurora-physics.js';
import * as atmosphere from '../src/atmosphere-model.js';
import * as shell from '../src/aurora-shell.js';
const baseline=process.argv[2];
if(!baseline)throw new Error('Usage: node scripts/verify-aurora-render.mjs <baseline-commit>');
const original=execFileSync('git',['show',baseline+':src/aurora-render.ts'],{encoding:'utf8'});
const url=process.env.RENDER_TEST_URL||'http://127.0.0.1:5186/';
await mkdir('artifacts/render-efficiency',{recursive:true});
const constants={...physics,...atmosphere,...shell};
const fragment=Function(...Object.keys(constants),'return `'+original.match(/fragmentShader: `([\s\S]*?)`,\n/)[1]+'`;')(...Object.values(constants));
const browser=await chromium.launch({headless:true,args:['--use-angle=default','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1000,height:800},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();let body=await response.text();assert.ok(body.includes('updateFrame = () => {'));body=body.replace('requestAnimationFrame(animate);','requestAnimationFrame(animate);if(window.__pauseRender)return;');body=body.replace('updateFrame = () => {',`window.__benchAurora=async(baseline)=>{
 window.__pauseRender=true;
 const mesh=planet.children.find(o=>o.renderOrder===10);const current=mesh.material;const old=current.clone();old.fragmentShader=baseline;old.uniforms=current.uniforms;
 const gl=renderer.getContext(),pixel=new Uint8Array(4),samples={before:[],after:[]};
 for(let i=0;i<16;i++)for(const key of (i%2?['after','before']:['before','after'])){
 await new Promise(requestAnimationFrame);mesh.material=key==='before'?old:current;const t=performance.now();presentFrame();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(i>1)samples[key].push(performance.now()-t);
 }
 mesh.material=current;old.dispose();window.__pauseRender=false;return samples;
 };
 window.__compareAurora=(baseline)=>{
 const mesh=planet.children.find(o=>o.renderOrder===10);const current=mesh.material;const old=current.clone();old.fragmentShader=baseline;old.uniforms=current.uniforms;
 const gl=renderer.getContext(),w=canvas.width,h=canvas.height;const a=new Uint8Array(w*h*4),b=new Uint8Array(w*h*4);
 mesh.material=old;presentFrame();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);
 mesh.material=current;presentFrame();gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);old.dispose();
 let maximum=0,sum=0,changed=0,overOne=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);maximum=Math.max(maximum,d);sum+=d;if(d)changed++;if(d>1)overOne++;}
 return {maximum,mean:sum/a.length,changed,overOne,channels:a.length,error:gl.getError()};
 };
 updateFrame = () => {`);await route.fulfill({response,body});});
 await page.goto(url+'?time=2026-09-09T09:20:00Z&view=night');await page.waitForSelector('#loading[aria-hidden="true"]',{timeout:180000});
 await page.locator('#provenance-trigger').click();await page.locator('#view-debug summary').click();await page.locator('#aurora-mode').selectOption('demo');
 const results=[];
 for(const hemisphere of ['1','-1']){
 await page.locator('[data-aurora-view="'+hemisphere+'"]').click();await page.waitForTimeout(1500);
 results.push({hemisphere,...await page.evaluate(f=>window.__compareAurora(f),fragment),timings:await page.evaluate(f=>window.__benchAurora(f),fragment)});
 }
 await page.keyboard.press('Escape');await page.screenshot({path:'artifacts/render-efficiency/aurora-after.png'});
 console.log({results,errors});await writeFile('artifacts/render-efficiency/image-comparison.json',JSON.stringify({results,errors},null,2));assert.deepEqual(errors,[]);for(const r of results){assert.equal(r.error,0);assert.ok(r.mean<.01);assert.ok(r.overOne/r.channels<.0001);}
}finally{await browser.close();}
