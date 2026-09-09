import * as THREE from 'three';
import recorded from './lightning-demo.json';
import { parseLightning, lightningSourceState, activeFlashes, lightningDirection, LIGHTNING_REFRESH_MS } from './lightning-model.js';
import type { LightningFeed, ActiveFlash } from './lightning-model.js';
import { createLightningLayer } from './lightning-render.js';

const SOURCE_URL=import.meta.env.VITE_LIGHTNING_URL || 'https://themarble.emildanielsen.no/lightning/latest.json';
const coverage:Record<string,string>={mtg:'EUMETSAT · Europe, Africa and Middle East; selected sector 30°W–80°E',goes19:'NOAA East · Americas, 105°W–30°W',goes18:'NOAA West · eastern Pacific and western Americas'};
const utc=(time:number)=>new Date(time).toISOString().replace('T',' ').replace('.000Z',' UTC');

export function createLightning({planet,cloudMaterial,transmittance,onView}:{planet:THREE.Group;cloudMaterial:THREE.ShaderMaterial;transmittance:THREE.Texture;onView(direction:number[]):void}){
  const layer=createLightningLayer(planet,cloudMaterial,transmittance);
  const demo=parseLightning(recorded), demoSource=demo.sources.find(s=>s.id==='goes19')!;
  const select=document.querySelector<HTMLSelectElement>('#lightning-mode')!;
  const status=document.querySelector<HTMLElement>('#lightning-status')!;
  const view=document.querySelector<HTMLButtonElement>('#lightning-view')!;
  let feed:LightningFeed|undefined,pending=false,error=false,lastStatus=-Infinity,demoStarted=performance.now();
  let latestSceneTime=Date.now(),previousNow=Date.now(),current:ActiveFlash[]=[];
  let replayFloor=-Infinity;
  const refresh=async()=>{
    if(pending || select.value!=='live')return;
    pending=true;
    try{
      const response=await fetch(SOURCE_URL,{signal:AbortSignal.timeout(20000),credentials:'omit',cache:'no-cache'});
      if(!response.ok)throw new Error('Download failed');
      const next=parseLightning(await response.json());
      if(!feed || next.publishedAt>=feed.publishedAt)feed=next;
      error=false;
    }catch{error=true;}finally{pending=false;lastStatus=-Infinity;}
  };
  select.addEventListener('change',()=>{demoStarted=performance.now();replayFloor=Date.now();lastStatus=-Infinity;if(select.value==='live')void refresh();});
  view.addEventListener('click',()=>{
    const candidates=select.value==='demo'?demoSource.events:feed?.sources.flatMap(source=>{
      const state=lightningSourceState(feed!,source,Date.now(),latestSceneTime);
      return state.enabled?source.events.filter(e=>Math.abs(e.time-state.clock)<60000):[];
    }) ?? [];
    // Prefer the night side, then a large measured footprint.
    const sun=cloudMaterial.uniforms.sunLocalDirection.value as THREE.Vector3;
    const best=[...candidates].sort((a,b)=>{
      const score=(f:typeof a)=>Math.log1p(f.area)*(new THREE.Vector3().fromArray(lightningDirection(f.latitude,f.longitude)).dot(sun)<0?10:1);
      return score(b)-score(a);
    })[0];
    if(best)onView(lightningDirection(best.latitude,best.longitude));
  });
  void refresh();window.setInterval(()=>void refresh(),LIGHTNING_REFRESH_MS);
  return {update(sceneTime:number,sun:THREE.Vector3,seconds:number){
    const now=Date.now();latestSceneTime=sceneTime;
    // A backwards system-clock jump must not replay observations already shown.
    if(now<previousNow-1000)replayFloor=previousNow;
    previousNow=now;
    current=[];
    if(select.value==='demo'){
      const [start,end]=demoSource.intervals[0];
      const clock=start+(performance.now()-demoStarted)%(end-start);
      current=activeFlashes(demoSource,clock);
    }else if(select.value==='live'&&feed&&now>=replayFloor){
      for(const source of feed.sources){const state=lightningSourceState(feed,source,now,sceneTime);if(state.enabled)current.push(...activeFlashes(source,state.clock));}
    }
    layer.update(current,sun);
    if(seconds-lastStatus<1)return;lastStatus=seconds;
    const sourceStates=feed?.sources.map(source=>{
      const state=lightningSourceState(feed!,source,now,sceneTime);
      const last=Math.max(0,...source.intervals.map(i=>i[1]));
      return `${coverage[source.id]}: ${source.status==='unconfigured'?'account not configured':source.status!=='available'?'source unavailable':state.enabled?'playing observed flashes':'waiting for matching fresh observations'}. Playback delay ${source.delayMs/60000} min.${last?' Latest observation window ends '+utc(last)+'.':''}`;
    }) ?? [];
    status.textContent=select.value==='off'?'Lightning is off.':select.value==='demo'
      ? `Recorded NOAA demonstration, ${utc(demoSource.intervals[0][0])}; repeats the same 20 seconds at original speed. Not current conditions. Cloud glow is reconstructed.`
      : `${error?'Refresh failed; only still-valid observations can play. ':''}${!feed?'Checking satellite observations…':sourceStates.join('\n')}${Math.abs(sceneTime-now)>60000?' Hidden: Earth clock does not match the current time.':''}`;
    view.disabled=select.value==='off'||(select.value==='live'&&!feed?.sources.some(s=>lightningSourceState(feed!,s,now,sceneTime).enabled && s.events.length>0));
    status.dataset.mode=select.value;status.dataset.active=String(current.length);
  }};
}
