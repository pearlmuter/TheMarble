import {chromium} from 'playwright';import {writeFile,mkdir} from 'node:fs/promises';import {installBundledEarthFixture,waitForBundledEarth} from './lib/render-test-fixture.mjs';
await mkdir('artifacts/production-render-diagnostics',{recursive:true});
const baseUrl=process.env.RENDER_TEST_URL||'http://127.0.0.1:5186/';
const live=process.argv.includes('--live');
const browser=await chromium.launch({headless:true,args:['--use-angle=default','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const errors=[];
try{const page=await browser.newPage({viewport:{width:1512,height:982},deviceScaleFactor:2});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|Shader Error/.test(m.text()))errors.push(m.text());});if(!live)await installBundledEarthFixture(page,baseUrl);
await page.route('**/src/main.ts*',async r=>{const response=await r.fetch();let body=await response.text();if(live)body=body.replace(/const latestEarthStateUrl = [^;\n]+;/,'const latestEarthStateUrl = "https://themarble.emildanielsen.no/latest.json";');body=body.replace('requestAnimationFrame(animate);','requestAnimationFrame(animate);if(window.__paused)return;');body=body.replace('updateFrame = () => {',`window.__layers=async()=>{
 window.__paused=true;const gl=renderer.getContext(),pixel=new Uint8Array(4),results={};
 const layers={atmosphere,clouds,aurora:planet.children.find(o=>o.renderOrder===10),sky:celestialSky};
 const conditions=['all',...Object.keys(layers),'bloom','surfaceShading'];
 const originalEarth=earth.material;const depthOnly=new THREE.MeshBasicMaterial({color:0x000000});
 for(let round=0;round<12;round++)for(const condition of (round%2?[...conditions].reverse():conditions)){
 await new Promise(requestAnimationFrame);const layer=layers[condition],visible=layer?.visible,bloom=solarBloom.enabled;
 if(layer)layer.visible=false;if(condition==='bloom')solarBloom.enabled=false;if(condition==='surfaceShading')earth.material=depthOnly;
 const t=performance.now();presentFrame();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);const cost=performance.now()-t;
 if(round>1)(results[condition]??=[]).push(cost);if(layer)layer.visible=visible;solarBloom.enabled=bloom;earth.material=originalEarth;
 }
 depthOnly.dispose();window.__paused=false;return{results,pixels:canvas.width*canvas.height,renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)};
 };updateFrame = () => {`);await r.fulfill({response,body});});
const reports=[];for(const view of ['day','night','terminator']){await page.goto(baseUrl+'?time=2026-09-10T10:00:00Z&view='+view);if(live){await page.waitForSelector('#loading[aria-hidden="true"]',{timeout:180000});await page.waitForSelector('#earth-state-summary[data-runtime-source="remote"][data-refresh="current"]',{state:'attached',timeout:300000});}else await waitForBundledEarth(page);await page.waitForTimeout(1200);reports.push({view,...await page.evaluate(()=>window.__layers())});}
await page.locator('#provenance-trigger').click();await page.locator('#view-debug summary').click();await page.locator('#aurora-mode').selectOption('demo');await page.locator('[data-aurora-view="1"]').click();await page.keyboard.press('Escape');await page.waitForTimeout(1500);reports.push({view:'polar-aurora',...await page.evaluate(()=>window.__layers())});
if(errors.length)throw new Error(errors.join('\n'));
await writeFile('artifacts/production-render-diagnostics/layers'+(live?'-live':'')+'.json',JSON.stringify(reports,null,2));for(const r of reports)console.log(r.view,Object.fromEntries(Object.entries(r.results).map(([k,v])=>[k,v.sort((a,b)=>a-b)[5]])));
}finally{await browser.close();}
