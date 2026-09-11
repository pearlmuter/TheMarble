import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAuroraForecast, auroraEmissionGrid, auroraLatitudeFloor, auroraForecastUsable, auroraGridUv, auroraViewDirection, AURORA_MAX_AGE_MS, auroraPatternNeedsUpdate } from '../src/aurora-model.js';
import { createAuroraController } from '../src/aurora-controller.js';
import { auroraRaySegments, AURORA_INNER_RADIUS, AURORA_OUTER_RADIUS } from '../src/aurora-shell.js';
const now = Date.parse('2026-09-06T13:00:00Z');
const recorded = JSON.parse(readFileSync(new URL('../src/aurora-demo.json', import.meta.url)));
function document() { return { 'Observation Time': recorded.observationTime, 'Forecast Time': recorded.forecastTime, coordinates: recorded.grid.map((p,i) => [i%360, Math.floor(i/360)-90,p]) }; }
const demo = parseAuroraForecast(document());

test('cached pattern holds through ordinary frames and refreshes after a minute or clock rewind', () => {
  assert.equal(auroraPatternNeedsUpdate(undefined, 0), true);
  for (let frame = 0; frame < 3600; frame++) assert.equal(auroraPatternNeedsUpdate(10, 10 + frame / 60), false);
  assert.equal(auroraPatternNeedsUpdate(10, 70), true);
  assert.equal(auroraPatternNeedsUpdate(10, 500), true);
  assert.equal(auroraPatternNeedsUpdate(10, 0), true);
});

test('finite emission layers preserve overhead column energy and finite limb brightening', () => {
  for (const [peak, sigma] of [[130, 17], [260, 60], [108, 8]]) {
    const thickness = Math.sqrt(12) * sigma;
    const inner = 1 + (peak - thickness / 2) / 6378.137;
    const outer = 1 + (peak + thickness / 2) / 6378.137;
    const column = segments => segments.reduce((sum, [a, b]) => sum + b - a, 0) * 6378.137 / thickness;
    const overhead = auroraRaySegments([0, 0, 3], [0, 0, -1], inner, outer);
    assert.equal(overhead.length, 1, 'Earth blocks the far layer');
    assert.ok(Math.abs(column(overhead) - 1) < 1e-10);
    const impact = inner + 1e-5;
    const limb = auroraRaySegments([impact, 0, 3], [0, 0, -1], inner, outer);
    const expected = 2 * Math.sqrt(outer * outer - impact * impact) * 6378.137 / thickness;
    assert.ok(Math.abs(column(limb) - expected) < 1e-9);
    assert.ok(expected > 10 && expected < 100);
    assert.deepEqual(auroraRaySegments([outer + .001, 0, 3], [0, 0, -1], inner, outer), []);
    assert.ok(Math.abs(thickness * thickness / 12 - sigma * sigma) < 1e-9);
  }
});

test('recorded NOAA grid survives compaction and preserves both hemispheres', () => {
  assert.equal(demo.grid.length, 65160);
  assert.match(recorded.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(Math.max(...demo.grid), 12);
  const reversed = document(); reversed.coordinates.reverse();
  assert.deepEqual(parseAuroraForecast(reversed).grid, demo.grid);
  assert.ok(demo.grid.slice(0, 90*360).some(p=>p>0));
  assert.ok(demo.grid.slice(91*360).some(p=>p>0));
});
test('rejects missing, duplicated, invalid probability and out-of-range coordinate cells', () => {
  for (const mutate of [d=>d.coordinates.pop(), d=>d.coordinates[1]=d.coordinates[0], d=>d.coordinates[0][2]=101, d=>d.coordinates[0][0]=360, d=>d.coordinates[0][1]=-91, d=>d.coordinates[0][2]=NaN]) {
    const d=document(); mutate(d); assert.throws(()=>parseAuroraForecast(d));
  }
});
test('rejects missing, reversed and excessively long forecast times', () => {
  for (const time of [undefined, 'not a time', '2026-09-06T12:00:00Z', '2026-09-07T12:00:00Z']) {
    const d=document(); d['Forecast Time']=time; assert.throws(()=>parseAuroraForecast(d));
  }
});
test('texture centres register Greenwich, east longitude, dateline and poles', () => {
  assert.deepEqual(auroraGridUv([1,0,0]), [.5/360,90.5/181]);
  assert.deepEqual(auroraGridUv([0,0,-1]), [90.5/360,90.5/181]);
  assert.deepEqual(auroraGridUv([-1,0,0]), [180.5/360,90.5/181]);
  assert.equal(auroraGridUv([0,1,0])[1],180.5/181);
  assert.equal(auroraGridUv([0,-1,0])[1],.5/181);
});
test('fresh forecast overlay hides when expired, future dated or unrelated to a historical scene', () => {
  assert.equal(auroraForecastUsable(demo,now),true);
  assert.equal(auroraForecastUsable(demo,demo.observationTime+AURORA_MAX_AGE_MS),true);
  assert.equal(auroraForecastUsable(demo,demo.observationTime+AURORA_MAX_AGE_MS+1),false);
  assert.equal(auroraForecastUsable(demo,demo.observationTime-300001),false);
  assert.equal(auroraForecastUsable(demo,now,now-86400000),false);
  assert.equal(auroraForecastUsable(demo,now,demo.forecastTime),true);
});
test('pending forecast cannot replace selected demo or off modes; downloads deduplicate', async () => {
  let resolve; let calls=0;
  const c=createAuroraController({demo,now:()=>now,loadForecast:()=>{calls++;return new Promise(r=>resolve=r);}});
  const pending=c.refresh(); assert.equal(c.refresh(),pending);
  await Promise.resolve(); c.setMode('demo'); resolve(demo); await pending;
  assert.equal(calls,1); assert.equal(c.state().mode,'demo'); assert.equal(c.state().gain,8);
  c.setMode('off'); assert.equal(c.state().enabled,false);
  c.setMode('forecast'); assert.equal(c.state().enabled,true);
});
test('failed refresh retains only fresh data, cannot roll back, and synchronous errors can retry', async () => {
  let time=now; let next=demo;
  const c=createAuroraController({demo,now:()=>time,loadForecast:()=>{if(next instanceof Error)throw next;return Promise.resolve(next);}});
  next=new Error('offline'); await c.refresh(); assert.equal(c.state().enabled,false);
  next=demo; await c.refresh(); assert.equal(c.state().enabled,true);
  next={...demo,observationTime:demo.observationTime-60000}; await c.refresh(); assert.match(c.state().error,/older/);
  assert.equal(c.state().forecast,demo);
  next=new Error('offline'); await c.refresh(); assert.equal(c.state().enabled,true);
  time+=AURORA_MAX_AGE_MS; assert.equal(c.state().enabled,false);
  c.setMode('demo'); assert.equal(c.state().enabled,true);
});
test('camera shortcuts choose the requested night hemisphere even for a zero-activity grid', () => {
  for(const hemisphere of [-1,1]){
    const p=auroraViewDirection({...demo,grid:new Uint8Array(65160)},hemisphere,[1,0,0]);
    assert.ok(p[1]*hemisphere>0); assert.ok(p[0]<0); assert.ok(Math.abs(Math.hypot(...p)-1)<1e-12);
  }
});
test('solid Earth blocks the far aurora shell', () => {
  const segments=auroraRaySegments([0,0,3],[0,0,-1]);
  assert.equal(segments.length,1);
  assert.ok(Math.abs(segments[0][0]-(3-AURORA_OUTER_RADIUS))<1e-12);
  assert.ok(Math.abs(segments[0][1]-(3-AURORA_INNER_RADIUS))<1e-12);
});
test('grazing rays retain both emitting intervals, sky misses and outward rays emit nothing', () => {
  assert.equal(auroraRaySegments([1.005,0,3],[0,0,-1]).length,2);
  assert.deepEqual(auroraRaySegments([2,0,3],[0,0,-1]),[]);
  assert.deepEqual(auroraRaySegments([0,0,3],[0,0,1]),[]);
  const inside=auroraRaySegments([0,0,1.02],[0,0,1]);
  assert.equal(inside[0][0],0);
});
test('all sampled emitting segments stay above 85 km and before any ground crossing', () => {
  for(let x=0;x<1.1;x+=.003){
    for(const [a,b] of auroraRaySegments([x,0,3],[0,0,-1])){
      assert.ok(b>a && a>=0);
      for(let i=0;i<=10;i++){
        const z=3-(a+(b-a)*i/10), r=Math.hypot(x,z);
        assert.ok(r>=AURORA_INNER_RADIUS-1e-10 && r<=AURORA_OUTER_RADIUS+1e-10);
        if(x<1)assert.ok(z>0);
      }
    }
  }
});

test('display removes the detached equatorial strip without altering the recorded grid', () => {
  const grid = auroraEmissionGrid(demo);
  assert.ok(demo.grid.slice(90*360,91*360).some(p=>p>0));
  assert.ok(grid.slice(89*360,91*360).every(p=>p===0));
  assert.deepEqual(grid.slice(100*360),demo.grid.slice(100*360));
  assert.deepEqual(grid.slice(0,80*360),demo.grid.slice(0,80*360));
});
test('display keeps continuous equatorward expansion including across the longitude seam', () => {
  const grid = new Uint8Array(65160);
  for(let lat=0;lat<=10;lat++)grid[(lat+90)*360+(lat%2?359:0)]=42;
  assert.deepEqual(auroraEmissionGrid({...demo,grid}),grid);
});

test('latitude culling preserves a retreating or vanished forecast while its afterglow survives',()=>{
 const grid=new Uint8Array(65160);grid[150*360]=50;
 const first=auroraLatitudeFloor(undefined,grid);
 const empty=new Uint8Array(65160);
 assert.equal(auroraLatitudeFloor(first,empty),first);
 empty[170*360]=50;
 assert.equal(auroraLatitudeFloor(first,empty),first);
 assert.ok(auroraLatitudeFloor(undefined,empty)>first);
 grid[140*360]=50;
 assert.ok(auroraLatitudeFloor(first,grid)<first);
});
