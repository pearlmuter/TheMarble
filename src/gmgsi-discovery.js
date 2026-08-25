const KEY_PATTERN = /^GMGSI_(VIS|LW)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\/(GLOBCOMP(?:VIS|LIR)_v[^/]+_blend_s(\d{15})_e(\d{15})_c(\d{15})\.nc)$/;

function noaaTimestamp(value) {
  const digits = value.slice(0, 14);
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}Z`;
  if (Number.isNaN(Date.parse(iso))) throw new Error(`Invalid GMGSI timestamp: ${value}`);
  return iso;
}

function parseKey(key) {
  const match = KEY_PATTERN.exec(key);
  if (!match) return undefined;
  const [, band, year, month, day, hour, , start, end, created] = match;
  const validAt = `${year}-${month}-${day}T${hour}:00:00Z`;
  const observedFrom = noaaTimestamp(start);
  const observedTo = noaaTimestamp(end);
  if (!observedFrom.startsWith(`${year}-${month}-${day}T${hour}:`)) return undefined;
  return { band, key, validAt, observedFrom, observedTo, producedAt: noaaTimestamp(created) };
}

function newestByProduction(entries) {
  return entries.reduce((latest, entry) => (
    !latest || Date.parse(entry.producedAt) > Date.parse(latest.producedAt) ? entry : latest
  ), undefined);
}

export function selectGmgsiCloudSequence({ keys, retrievedAt, lastPublishedValidAt }) {
  if (Number.isNaN(Date.parse(retrievedAt))) throw new Error('Invalid GMGSI retrieval time');
  const byHour = new Map();
  for (const key of keys) {
    const parsed = parseKey(key);
    if (!parsed || Date.parse(parsed.producedAt) > Date.parse(retrievedAt)) continue;
    const hour = byHour.get(parsed.validAt) ?? { VIS: [], LW: [] };
    hour[parsed.band].push(parsed);
    byHour.set(parsed.validAt, hour);
  }

  const complete = [...byHour.entries()].flatMap(([validAt, bands]) => {
    const visible = newestByProduction(bands.VIS);
    const longwave = newestByProduction(bands.LW);
    if (!visible || !longwave) return [];
    if (visible.observedFrom !== longwave.observedFrom || visible.observedTo !== longwave.observedTo) return [];
    return [{
      validAt,
      observedFrom: visible.observedFrom,
      observedTo: visible.observedTo,
      producedAt: Date.parse(visible.producedAt) >= Date.parse(longwave.producedAt) ? visible.producedAt : longwave.producedAt,
      retrievedAt,
      visibleKey: visible.key,
      longwaveKey: longwave.key,
    }];
  }).sort((left, right) => Date.parse(left.validAt) - Date.parse(right.validAt));

  let frames;
  for (let index = complete.length - 1; index > 0; index -= 1) {
    if (Date.parse(complete[index].validAt) - Date.parse(complete[index - 1].validAt) === 60 * 60 * 1000) {
      frames = [complete[index - 1], complete[index]];
      break;
    }
  }
  if (!frames) throw new Error('GMGSI discovery did not find two adjacent complete GMGSI hours');
  const newestValidAt = frames[1].validAt;
  return {
    frames,
    publish: !lastPublishedValidAt || Date.parse(newestValidAt) > Date.parse(lastPublishedValidAt),
  };
}
