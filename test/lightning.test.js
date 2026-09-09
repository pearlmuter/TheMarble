import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLightning, lightningSourceState, activeFlashes, flashEnvelope, lightningDirection } from '../src/lightning-model.js';
const now=Date.UTC(2026,8,9,12),delay=600000;
const packet=()=>({version:1,publishedAt:now,sources:['mtg','goes19','goes18'].map(id=>({id,status:'available',delayMs:delay,intervals:[[now-delay-20000,now-delay+20000]],events:[['one',now-delay-100,20,-80,500,100,1e-13]]}))});
test('observed timing survives refreshes and flashes are not re-triggered on arrival',()=>{
 const first=parseLightning(packet()), second=parseLightning(packet());
 const source=first.sources[1],clock=lightningSourceState(first,source,now,now).clock;
 assert.equal(clock,now-delay);assert.equal(activeFlashes(source,clock).length,1);
 assert.deepEqual(activeFlashes(source,clock),activeFlashes(second.sources[1],clock));
 assert.equal(activeFlashes(source,clock+1000).length,0);
});
test('stale publication, uncovered interval and a historical Earth clock hide live flashes',()=>{
 const feed=parseLightning(packet()),source=feed.sources[1];
 assert.equal(lightningSourceState(feed,source,now,now).enabled,true);
 assert.equal(lightningSourceState(feed,source,now+16*60000,now+16*60000).enabled,false);
 assert.equal(lightningSourceState(feed,source,now+30000,now+30000).enabled,false);
 assert.equal(lightningSourceState(feed,source,now,now-120000).enabled,false);
 assert.equal(lightningSourceState({...feed,publishedAt:now+120000},source,now,now).enabled,false);
});
test('duplicate ids collapse, while malformed observations and unavailable data are rejected',()=>{
 const p=packet();p.sources[1].events.push(p.sources[1].events[0]);assert.equal(parseLightning(p).sources[1].events.length,1);
 for(const mutate of [p=>p.sources[1].events[0][2]=NaN,p=>p.sources[1].events[0][3]=181,p=>p.sources[1].status='unavailable',p=>p.sources[1].events[0][1]=0,p=>p.sources[1].id='mtg']){
  const p=packet();mutate(p);assert.throws(()=>parseLightning(p));
 }
});
test('empty observed windows remain distinguishable from provider failures',()=>{
 const p=packet();p.sources[1].events=[];const f=parseLightning(p);assert.equal(lightningSourceState(f,f.sources[1],now,now).enabled,true);assert.deepEqual(activeFlashes(f.sources[1],now-delay),[]);
 p.sources[1].status='unavailable';p.sources[1].intervals=[];const bad=parseLightning(p);assert.equal(lightningSourceState(bad,bad.sources[1],now,now).enabled,false);
});
test('light has finite duration and geographic coordinates match the Earth frame',()=>{
 assert.equal(flashEnvelope(-1,500),0);assert.equal(flashEnvelope(1600,30000),0);assert.ok(flashEnvelope(250,500)>0);
 for(let age=0;age<1600;age++)assert.ok(flashEnvelope(age,1200)>=0&&flashEnvelope(age,1200)<=1);
 assert.deepEqual(lightningDirection(0,0),[1,0,-0]);assert.ok(Math.abs(lightningDirection(0,90)[2]+1)<1e-10);assert.equal(lightningDirection(90,0)[1],1);
});
