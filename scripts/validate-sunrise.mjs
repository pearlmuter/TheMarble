import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { referenceRadiance,limbCase,transmission } from './sunrise-reference.mjs';
const appUrl=process.env.APP_URL??'http://127.0.0.1:5184';
const out=process.argv[2]??'artifacts/sunrise-validation'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=default','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1400,height:1100}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('net::'))errors.push(m.text());});
await page.route('**/src/main.ts*',async route=>{
  const response=await route.fetch(); let source=await response.text();
  source=source.replace('requestAnimationFrame(animate);','requestAnimationFrame(animate); if(window.__freeze) return;');
  source=source.replace('updateFrame = () => {', `
    const validationDense=atmosphere.material.clone();
    validationDense.uniforms=atmosphere.material.uniforms;
    validationDense.fragmentShader=validationDense.fragmentShader.replace('index<24;', 'index<96;').replace('float viewMarchSteps=hitsGround?12.0:24.0;', 'float viewMarchSteps=96.0;');
    if(!validationDense.fragmentShader.includes('float viewMarchSteps=96.0;'))throw new Error('Dense reference shader was not configured');
    window.__validation={
      transmission:(h)=>{
        const m=new THREE.ShaderMaterial({
          uniforms:{lut:{value:transmittanceLookup},r:{value:1+h/6371}},
          vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
          fragmentShader:ATMOSPHERE_MODEL_GLSL+ATMOSPHERE_TRANSMITTANCE_GLSL+'uniform sampler2D lut;uniform float r;void main(){vec3 t=atmosphereTransmittanceToTop(lut,r,0.);gl_FragColor=vec4(t*t,1.);}'
        });
        const scene=new THREE.Scene(),g=new THREE.PlaneGeometry(2,2);scene.add(new THREE.Mesh(g,m));
        const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});
        renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());
        const data=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,data);renderer.setRenderTarget(null);
        target.dispose();g.dispose();m.dispose();return Array.from(data).slice(0,3);
      },
      stop:()=>{window.__freeze=true;},
      sample:({origin,ray,sun:light},multiple,dense=false)=>{
        const originalMaterial=atmosphere.material;
        if(dense)atmosphere.material=validationDense;
        const saved=[];
        scene.traverse(o=>{if(o.material&&o!==atmosphere){saved.push([o,o.visible]);o.visible=false;}});
        const probe=new THREE.PerspectiveCamera(.0001,1,.0001,30000);
        probe.position.fromArray(origin); probe.lookAt(new THREE.Vector3(...origin).add(new THREE.Vector3(...ray)));probe.updateMatrixWorld();
        const material=atmosphere.material, oldSun=material.uniforms.sunDirection.value.clone();
        const oldMultiple=material.uniforms.multipleScatteringLut.value;
        material.uniforms.sunDirection.value.fromArray(light);
        const zero=solidTexture(0,0,0);
        if(!multiple)material.uniforms.multipleScatteringLut.value=zero;
        const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});
        renderer.setRenderTarget(target);renderer.render(scene,probe);
        const pixels=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,pixels);
        renderer.setRenderTarget(null);target.dispose();zero.dispose();
        material.uniforms.sunDirection.value.copy(oldSun);material.uniforms.multipleScatteringLut.value=oldMultiple;
        atmosphere.material=originalMaterial;
        for(const [o,v]of saved)o.visible=v;
        return Array.from(pixels).slice(0,3);
      },
      pose:(clearance)=>{
        const now=new Date('2025-06-21T12:00:00Z');
        const frame=celestialSceneFrameAt(now),s=new THREE.Vector3(...frame.sun.inertialDirection);
        const t=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),s).normalize();
        const a=Math.asin(1/7)+clearance*Math.PI/180;
        camera.position.copy(s).multiplyScalar(-Math.cos(a)*7).addScaledVector(t,Math.sin(a)*7);
        camera.lookAt(0,0,0);controls.target.set(0,0,0);controls.update();camera.updateMatrixWorld();
        updateCelestialScene(now);presentFrame();
      }
    };
    updateFrame = () => {`);
  await route.fulfill({response,body:source});
});
try{
  await page.goto(appUrl+'/?golden=sunrise-limb');
  await page.waitForSelector('#loading[aria-hidden="true"]',{timeout:120000});
  await page.waitForFunction(()=>window.__validation); await page.evaluate(()=>window.__validation.stop());
  const rows=[];
  for(const distance of [7,1+408/6371])for(const clearance of [-.6,-.3,0,.3])for(const h of [1,5,10,20,40,60]) {
    const params=limbCase(h,clearance,distance);
    const gpu=await page.evaluate(p=>window.__validation.sample(p,false),params);
    const dense=await page.evaluate(p=>window.__validation.sample(p,false,true),params);
    const full=await page.evaluate(p=>window.__validation.sample(p,true),params);
    const reference=referenceRadiance(params);
    const relative=gpu.map((v,c)=>Math.abs(v-reference[c])/Math.max(reference[c],1e-5));
    rows.push({h,clearance,distance,gpu,dense,full,reference,relative});
    console.log(JSON.stringify(rows.at(-1)));
  }
  for(const clearance of [-.6,-.3,0,.3]){
    await page.evaluate(c=>window.__validation.pose(c),clearance);
    await page.screenshot({path:out+'/sequence-'+clearance+'.png'});
  }
  const transmissionRows=[];
  for(const h of [.01,2,5,10,20,30,40,60]) {
    const p=limbCase(h,0);
    const gpu=await page.evaluate(h=>window.__validation.transmission(h),h);
    const reference=transmission(p.origin,p.ray,4096);
    const absolute=gpu.map((v,c)=>Math.abs(v-reference[c]));
    transmissionRows.push({h,gpu,reference,absolute});
  }
  const convergence=[];
  for(const h of [5,20,40]) {
    const p=limbCase(h,-.3);
    const fine=referenceRadiance({...p,viewSteps:4096,lightSteps:1024});
    const coarse=referenceRadiance(p);
    const disc=referenceRadiance({...p,viewSteps:1024,lightSteps:256,finiteDisc:true});
    convergence.push({h,coarse,fine,disc});
  }
  const report={checkedAt:new Date().toISOString(),rows,transmissionRows,convergence,errors,checks:{passed:false}};
  try {
    assert.deepEqual(errors,[]);
    for(const row of rows) {
      assert.ok(row.relative.every(v=>v<.02), 'runtime single scattering must match the independent integral within 2% (1e-5 denominator floor)');
      assert.ok(row.gpu.every(v=>Number.isFinite(v)&&v>=0));
      if(row.h>=20 && row.h<=40) assert.ok(row.full[2]>row.full[0], 'upper atmosphere must be blue-dominant even before emergence');
      if(row.h<=5) assert.ok(row.full[0]>row.full[2], 'long lower paths should be red-dominant for these cases');
    }
    for(const row of transmissionRows) assert.ok(row.absolute.every(v=>v<.01),'tangent-path transmission must agree within one percentage point');
    for(const row of convergence)for(let c=0;c<3;c++) assert.ok(Math.abs(row.coarse[c]-row.fine[c])/Math.max(row.fine[c],1e-5)<.001);
    report.checks.passed=true;
  } catch(error) { report.checks.failure=error.message; throw error; }
  finally {
    await writeFile(out+'/report.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify({convergence,errors,checks:report.checks},null,2));
  }
}finally{await browser.close();}
