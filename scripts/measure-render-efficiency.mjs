import {chromium} from 'playwright';import{writeFile,mkdir}from'node:fs/promises';import assert from'node:assert/strict';
const label=process.argv[2]||'current';
const url=process.env.RENDER_TEST_URL||'http://127.0.0.1:5186/';
await mkdir('artifacts/render-efficiency',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=default','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1512,height:982},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();let body=await response.text();body=body.replace('function animate() {',`const probe={updates:[],presents:[],mutations:0}; window.__perf=probe;
  new MutationObserver(records=>{probe.mutations+=records.length;}).observe(provenancePanel,{childList:true,subtree:true,characterData:true});
  function animate() {`);
 body=body.replace('  updateFrame();','  const updateStart=performance.now(); updateFrame(); probe.updates.push(performance.now()-updateStart); if(probe.updates.length>1000)probe.updates.shift();');
 body=body.replace('  presentFrame();\n}',`  const presentStart=performance.now(); presentFrame(); probe.presents.push(performance.now()-presentStart);if(probe.presents.length>1000)probe.presents.shift();\n}`);
 // Readback forces completion where Metal lacks disjoint timer queries.
 // These timings include queued animation work and readback, not isolated GPU time.
 body=body.replace('startScene();',`window.__finishProbe=async()=>{const gl=renderer.getContext();const out=[];for(let i=0;i<30;i++){await new Promise(requestAnimationFrame);gl.finish();const t=performance.now();presentFrame();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));out.push(performance.now()-t);}return{samples:out,renderer:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),pixels:renderer.domElement.width*renderer.domElement.height};};startScene();`);
 await route.fulfill({response,body});});
 await page.goto(url+'?time=2026-09-09T09:20:00Z&view=night');await page.waitForSelector('#loading[aria-hidden="true"]',{timeout:180000});
 await page.waitForTimeout(1000);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const measure=async()=>{
  await page.evaluate(()=>{window.__perf.updates=[];window.__perf.presents=[];window.__perf.mutations=0;});const before=await cdp.send('Performance.getMetrics');await page.waitForTimeout(4000);const after=await cdp.send('Performance.getMetrics');
  const p=await page.evaluate(()=>window.__perf);const get=(m,n)=>m.metrics.find(v=>v.name===n)?.value;
  const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
  return {frames:p.updates.length,updateMs:mean(p.updates),presentSubmitMs:mean(p.presents),hudMutations:p.mutations,cpuTaskSeconds:get(after,'TaskDuration')-get(before,'TaskDuration'),jsHeapMb:get(after,'JSHeapUsedSize')/1e6};
 };
 const idle=await measure();const gpu=await page.evaluate(()=>window.__finishProbe());
 await page.locator('#provenance-trigger').click();await page.locator('#view-debug summary').click();await page.locator('#aurora-mode').selectOption('demo');await page.locator('[data-aurora-view="1"]').click();await page.mouse.move(1500,970);await page.keyboard.press('Escape');await page.waitForTimeout(1000);const aurora=await measure();const auroraGpu=await page.evaluate(()=>window.__finishProbe());
 await page.locator('#provenance-trigger').click();await page.locator('#aurora-mode').selectOption('off');await page.mouse.move(1500,970);await page.keyboard.press('Escape');await page.waitForTimeout(500);const polarOff=await measure();const polarOffGpu=await page.evaluate(()=>window.__finishProbe());
 const report={label,idle,gpu,aurora,auroraGpu,polarOff,polarOffGpu,errors};await writeFile(`artifacts/render-efficiency/${label}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(process.env.ASSERT_EFFICIENCY==='1')assert.equal(idle.hudMutations,0,'A closed HUD must not be rebuilt continuously');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
