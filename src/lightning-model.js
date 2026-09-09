// Per-source delayed playback preserves observation timing across downloads.
export const LIGHTNING_REFRESH_MS = 60_000;
export const LIGHTNING_MAX_AGE_MS = 15 * 60_000;
export const LIGHTNING_SOURCES = ['mtg', 'goes19', 'goes18'];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function parseLightning(document) {
  if (document?.version !== 1 || !finite(document.publishedAt) || !Array.isArray(document.sources) || document.sources.length !== 3) throw new Error('Invalid lightning feed');
  const seen = new Set();
  const sources = document.sources.map(source => {
    if (!LIGHTNING_SOURCES.includes(source.id) || seen.has(source.id) || !['available','unavailable','unconfigured'].includes(source.status)) throw new Error('Invalid lightning source');
    seen.add(source.id);
    if (!finite(source.delayMs) || source.delayMs < 0 || source.delayMs > 3600000 || !Array.isArray(source.intervals) || source.intervals.length > 500 || !Array.isArray(source.events) || source.events.length > 200000) throw new Error('Invalid lightning window');
    const intervals = source.intervals.map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(finite) || pair[1] <= pair[0] || pair[1]-pair[0] > 1200000 || pair[1] > document.publishedAt+60000) throw new Error('Invalid observation interval');
      return [...pair];
    });
    const ids = new Set();
    const events = source.events.map(row => {
      if (!Array.isArray(row) || row.length !== 7 || typeof row[0] !== 'string' || row[0].length > 160 || !row.slice(1).every(finite)
        || Math.abs(row[2]) > 90 || Math.abs(row[3]) > 180 || row[4] < 0 || row[4] > 30000 || row[5] <= 0 || row[5] > 1e7 || row[6] < 0) throw new Error('Invalid lightning flash');
      if (!intervals.some(([start,end]) => row[1] >= start-30000 && row[1] <= end)) throw new Error('Flash outside observation window');
      return { id: row[0], time: row[1], latitude: row[2], longitude: row[3], duration: row[4], area: row[5], optical: row[6] };
    }).filter(event => { if (ids.has(event.id)) return false; ids.add(event.id); return true; }).sort((a,b) => a.time-b.time);
    if (source.status !== 'available' && (events.length || intervals.length)) throw new Error('Unavailable source contains observations');
    return { id: source.id, status: source.status, delayMs: source.delayMs, intervals, events };
  });
  return { publishedAt: document.publishedAt, sources };
}

export function lightningSourceState(feed, source, now, sceneTime) {
  const clock = now-source.delayMs;
  const current = now-feed.publishedAt >= -60000 && now-feed.publishedAt <= LIGHTNING_MAX_AGE_MS;
  const covered = source.intervals.some(([start,end]) => clock >= start && clock < end);
  return { clock, enabled: current && covered && source.status === 'available' && Math.abs(sceneTime-now) <= 60000 };
}

// A bounded reconstruction of the optical envelope, not invented extra strikes.
export function flashEnvelope(age, duration) {
  const span = Math.max(60, Math.min(1500, duration));
  if (age < 0 || age > span) return 0;
  const p = age/span;
  return Math.sin(Math.PI*p)**.65 * (.75+.25*Math.cos(p*Math.PI*6)**2);
}

export function activeFlashes(source, clock) {
  const events = source.events;
  let lo=0, hi=events.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(events[mid].time < clock-1500)lo=mid+1;else hi=mid;}
  const active=[];
  for(let i=lo;i<events.length && events[i].time<=clock;i++){
    const flash=events[i], strength=flashEnvelope(clock-flash.time,flash.duration);
    if(strength>0)active.push({...flash,strength,source:source.id});
  }
  return active;
}

export function lightningDirection(latitude, longitude) {
  const lat=latitude*Math.PI/180, lon=longitude*Math.PI/180;
  return [Math.cos(lat)*Math.cos(lon),Math.sin(lat),-Math.cos(lat)*Math.sin(lon)];
}
