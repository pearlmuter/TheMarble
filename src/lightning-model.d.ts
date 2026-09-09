export interface LightningFlash { id:string; time:number; latitude:number; longitude:number; duration:number; area:number; optical:number; }
export interface LightningSource { id:string; status:string; delayMs:number; intervals:number[][]; events:LightningFlash[]; }
export interface LightningFeed { publishedAt:number; sources:LightningSource[]; }
export interface ActiveFlash extends LightningFlash { strength:number; source:string; }
export const LIGHTNING_REFRESH_MS:number;
export const LIGHTNING_MAX_AGE_MS:number;
export const LIGHTNING_SOURCES:string[];
export function parseLightning(document:unknown):LightningFeed;
export function lightningSourceState(feed:LightningFeed,source:LightningSource,now:number,sceneTime:number):{clock:number;enabled:boolean};
export function flashEnvelope(age:number,duration:number):number;
export function activeFlashes(source:LightningSource,clock:number):ActiveFlash[];
export function lightningDirection(latitude:number,longitude:number):number[];
