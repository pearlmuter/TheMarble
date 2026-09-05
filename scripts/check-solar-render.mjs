// Browser regression: inspect actual HDR output with only solar contributors visible.
// Test instrumentation is injected by Playwright; it is never shipped in the app.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
// Run against a local Vite server (the test injects hooks into its unbundled entrypoint).
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5184';
const out = process.argv[2] ?? 'artifacts/solar-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=default', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().includes('net::')) errors.push(message.text()); });
await page.route('**/src/main.ts*', async route => {
  const response = await route.fetch();
  const source = (await response.text()).replace('requestAnimationFrame(animate);', 'requestAnimationFrame(animate); if (window.__freeze) return;');
  const hook = `
  window.__solarTest = { THREE, camera, controls, planet, scene, renderer, sceneTarget, sun, atmosphere,
    updateCelestialScene, presentFrame, celestialSceneFrameAt,
    stop: () => { updateFrame = () => {}; window.__freeze = true; },
    pose: (phase, distance = 7) => {
      const now = new Date('2025-06-21T12:00:00Z');
      const frame = celestialSceneFrameAt(now);
      const s = new THREE.Vector3(...frame.sun.inertialDirection);
      const t = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),s).normalize();
      camera.position.copy(s).multiplyScalar(Math.cos(phase*Math.PI/180)*distance).addScaledVector(t,Math.sin(phase*Math.PI/180)*distance);
      camera.up.set(0,1,0); controls.target.set(0,0,0); camera.lookAt(0,0,0); controls.update(); camera.updateMatrixWorld();
      updateCelestialScene(now); presentFrame();
    },
  };
  `;
  await route.fulfill({ response, body: source.replace('updateFrame = () => {', hook + 'updateFrame = () => {') });
});
try {
  await page.goto(`${appUrl}/?golden=sunrise-limb`);
  await page.waitForFunction(() => window.__solarTest, { timeout: 120000 });
  await page.waitForSelector('#loading[aria-hidden="true"]', { timeout: 120000 });
  await page.evaluate(() => window.__solarTest.stop());
  await page.waitForTimeout(900);
  const performance = await page.evaluate(() => {
    const t=window.__solarTest;
    t.pose(170.8);
    for(let i=0;i<5;i++) t.presentFrame();
    const pixel=new Uint16Array(4);
    t.renderer.readRenderTargetPixels(t.sceneTarget,0,0,1,1,pixel);
    const start=window.performance.now();
    for(let i=0;i<30;i++) t.presentFrame();
    t.renderer.readRenderTargetPixels(t.sceneTarget,0,0,1,1,pixel);
    return {frameMs:(window.performance.now()-start)/30};
  });
  const reports = [];
  for (const [name, phase] of [['clear',170.8],['partial',171.9],['hidden',173]]) {
    await page.evaluate(phase => window.__solarTest.pose(phase),phase);
    await page.screenshot({path:`${out}/${name}.png`});
    reports.push(await page.evaluate(({name}) => {
      const {THREE,camera,scene,renderer,sceneTarget,sun} = window.__solarTest;
      const saved = [];
      scene.traverse(object => { if (object.material && object !== sun && !(object instanceof THREE.Sprite)) { saved.push([object,object.visible]); object.visible=false; } });
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene,camera);
      renderer.setRenderTarget(null);
      // Inspect direct light before the optical blur: a real lens can spill glare
      // across an edge, but the photosphere must never shine through the Earth.
      const pixels = new Uint16Array(sceneTarget.width*sceneTarget.height*4);
      renderer.readRenderTargetPixels(sceneTarget,0,0,sceneTarget.width,sceneTarget.height,pixels);
      const centre = sun.position.clone().project(camera);
      const x=Math.round((centre.x*.5+.5)*sceneTarget.width), y=Math.round((centre.y*.5+.5)*sceneTarget.height);
      const flux=[0,0,0];
      for(let i=0;i<pixels.length;i+=4) for(let c=0;c<3;c++) flux[c]+=THREE.DataUtils.fromHalfFloat(pixels[i+c]);
      let leaked=0;
      for(let dy=-8;dy<=8;dy++) for(let dx=-8;dx<=8;dx++) {
        const px=x+dx,py=y+dy;
        const ray=new THREE.Vector3((px+.5)/sceneTarget.width*2-1,(py+.5)/sceneTarget.height*2-1,.5).unproject(camera).sub(camera.position).normalize();
        const closest=-camera.position.dot(ray), impact=camera.position.clone().addScaledVector(ray,closest).length();
        if(closest>0 && impact<.997) {
          const offset=(py*sceneTarget.width+px)*4;
          leaked=Math.max(leaked,...[0,1,2].map(c=>THREE.DataUtils.fromHalfFloat(pixels[offset+c])));
        }
      }
      for(const [object,visible] of saved) object.visible=visible;
      return {name,leaked,flux};
    },{name}));
  }
  await page.evaluate(() => {
    const t=window.__solarTest;
    const distance=1+408/6371;
    const phase=180-Math.asin(1/distance)*180/Math.PI;
    t.pose(phase,distance);
    t.controls.target.copy(t.camera.position).add(t.sun.position.clone().sub(t.camera.position).normalize());
    t.camera.lookAt(t.controls.target); t.camera.updateMatrixWorld(); t.presentFrame();
  });
  await page.screenshot({path:`${out}/iss-sunrise.png`});
  const toggle=page.locator('#follow-place');
  assert.equal(await toggle.count(),1);
  {
    await page.locator('#provenance-trigger').focus();
    assert.equal(await toggle.isVisible(),true);
    await toggle.focus(); await page.keyboard.press('Space');
    assert.equal(await toggle.isChecked(),true);
    await page.screenshot({path:`${out}/menu.png`});
    await page.keyboard.press('Escape');
    assert.equal(await toggle.isVisible(),false);
    await page.evaluate(() => window.__solarTest.pose(90));
    const result=await page.evaluate(() => {
      const t=window.__solarTest;
      t.updateCelestialScene(new Date('2025-06-21T12:00:00Z'));
      const local=t.camera.position.clone().applyQuaternion(t.planet.quaternion.clone().invert());
      t.updateCelestialScene(new Date('2025-06-21T18:00:00Z'));
      return local.distanceTo(t.camera.position.clone().applyQuaternion(t.planet.quaternion.clone().invert()));
    });
    assert.ok(result<1e-8,'menu toggle must actually follow Earth');
    await page.locator('#provenance-trigger').focus();
    await toggle.uncheck();
    const drift=await page.evaluate(() => {
      const t=window.__solarTest; const previous=t.camera.position.clone();
      t.updateCelestialScene(new Date('2025-06-22T00:00:00Z'));
      return previous.distanceTo(t.camera.position);
    });
    assert.ok(drift<1e-8,'switching off must restore the stationary camera');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#provenance-trigger').focus();
    await toggle.check();
    assert.equal(await toggle.isChecked(),true);
    const box=await toggle.boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=390, 'the toggle fits a phone screen');
    await page.screenshot({path:`${out}/menu-mobile.png`});
  }
  await writeFile(`${out}/report.json`,JSON.stringify({reports,errors,performance},null,2));
  console.log(JSON.stringify({reports,errors,performance},null,2));
  assert.deepEqual(errors,[]);
  {
    assert.ok(reports[1].flux[0] < reports[0].flux[0] * .6, 'partial occultation must reduce the source that generates glare');
    assert.ok(reports[2].flux.every(value=>value===0), 'the fully hidden Sun must supply no light or glare');
  }
  assert.ok(reports.every(r=>r.leaked<.01),'Solar light appears inside the opaque Earth');
} finally { await browser.close(); }
