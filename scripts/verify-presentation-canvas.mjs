import {chromium} from 'playwright';import assert from 'node:assert/strict';import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('artifacts/render-efficiency',{recursive:true});
const url=process.env.RENDER_TEST_URL||'http://127.0.0.1:5186/';
const browser=await chromium.launch({headless:true,args:['--use-angle=default','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
try{const page=await browser.newPage();await page.route('**/canvas-fixture',r=>r.fulfill({contentType:'text/html',body:`<script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
const results=[];const width=3024,height=1964;
const data=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=x%256;data[i+1]=(x+y)%256;data[i+2]=((x^y)%2)*255;data[i+3]=255;}
for(const antialias of [true,false]){
 const renderer=new THREE.WebGLRenderer({antialias,alpha:true});renderer.setSize(width,height);const texture=new THREE.DataTexture(data,width,height);texture.needsUpdate=true;texture.minFilter=texture.magFilter=THREE.LinearFilter;
 const material=new THREE.ShaderMaterial({uniforms:{map:{value:texture}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D map;varying vec2 v;void main(){gl_FragColor=texture2D(map,v);}'});
 const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);renderer.render(scene,camera);const gl=renderer.getContext();const out=new Uint8Array(data.length);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,out);results.push({out,samples:gl.getParameter(gl.SAMPLES),error:gl.getError()});texture.dispose();material.dispose();renderer.dispose();
}
let maximum=0,changed=0;for(let i=0;i<data.length;i++){maximum=Math.max(maximum,Math.abs(results[0].out[i]-results[1].out[i]));if(results[0].out[i]!==results[1].out[i])changed++;}window.result={maximum,changed,samples:results.map(r=>r.samples),channels:data.length,nonzero:results[0].out.some(v=>v>0),errors:results.map(r=>r.error)};
</script>`}));await page.goto(url+'canvas-fixture');await page.waitForFunction(()=>window.result);const result=await page.evaluate(()=>window.result);console.log(result);assert.ok(result.samples[0]>0,'Browser did not grant MSAA: comparison unsupported');assert.equal(result.samples[1],0);assert.equal(result.nonzero,true);assert.deepEqual(result.errors,[0,0]);assert.equal(result.changed,0);await writeFile('artifacts/render-efficiency/canvas-comparison.json',JSON.stringify(result,null,2));}finally{await browser.close();}
