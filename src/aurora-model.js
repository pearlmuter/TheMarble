export const AURORA_SOURCE_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
export const AURORA_WIDTH = 360;
export const AURORA_HEIGHT = 181;
export const AURORA_REFRESH_MS = 5 * 60_000;
export const AURORA_MAX_AGE_MS = 2 * 60 * 60_000;

export function parseAuroraForecast(document) {
  const observationTime = Date.parse(document?.['Observation Time']);
  const forecastTime = Date.parse(document?.['Forecast Time']);
  if (!Number.isFinite(observationTime) || !Number.isFinite(forecastTime)
    || forecastTime < observationTime || forecastTime - observationTime > 180 * 60_000) {
    throw new Error('Invalid aurora forecast times');
  }
  const grid = new Uint8Array(AURORA_WIDTH * AURORA_HEIGHT);
  const seen = new Uint8Array(grid.length);
  if (!Array.isArray(document.coordinates) || document.coordinates.length !== grid.length) throw new Error('Incomplete aurora grid');
  for (const coordinate of document.coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length !== 3) throw new Error('Invalid aurora coordinate');
    const [longitude, latitude, probability] = coordinate;
    if (!Number.isInteger(longitude) || longitude < 0 || longitude >= 360
      || !Number.isInteger(latitude) || latitude < -90 || latitude > 90
      || !Number.isInteger(probability) || probability < 0 || probability > 100) throw new Error('Invalid aurora grid value');
    const index = (latitude + 90) * 360 + longitude;
    if (seen[index]) throw new Error('Duplicate aurora coordinate');
    seen[index] = 1;
    grid[index] = probability;
  }
  return { observationTime, forecastTime, grid };
}

export function auroraForecastUsable(forecast, now, sceneTime = now) {
  if (!forecast || !Number.isFinite(now) || !Number.isFinite(sceneTime)) return false;
  const age = now - forecast.observationTime;
  return age >= -5 * 60_000 && age <= AURORA_MAX_AGE_MS
    && (Math.abs(sceneTime - now) <= 15 * 60_000 || Math.abs(sceneTime - forecast.forecastTime) <= 15 * 60_000);
}

// The provider uses east-positive 0..359 longitude; the renderer has +X at 0°
// and -Z at 90°E. DataTexture row zero is the south pole (flipY=false).
export function auroraGridUv(direction) {
  const length = Math.hypot(...direction);
  const longitude = ((Math.atan2(-direction[2], direction[0]) / (2 * Math.PI)) + 1) % 1;
  const latitude = Math.asin(Math.max(-1, Math.min(1, direction[1] / length))) / Math.PI + .5;
  return [(longitude * 360 + .5) / 360, (latitude * 180 + .5) / 181];
}

export function auroraViewDirection(forecast, hemisphere, sun) {
  let best = -1;
  let direction = [0, hemisphere * .94, -.34];
  for (let latitude = 45; latitude <= 82; latitude++) {
    const lat = hemisphere * latitude * Math.PI / 180;
    for (let longitude = 0; longitude < 360; longitude++) {
      const lon = longitude * Math.PI / 180;
      const point = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
      const darkness = Math.max(0, -point.reduce((sum, component, i) => sum + component * sun[i], 0));
      const probability = forecast?.grid[(hemisphere * latitude + 90) * 360 + longitude] ?? 1;
      const score = (probability + .0001) * darkness;
      if (score > best) { best = score; direction = point; }
    }
  }
  return direction;
}

// Both inspected NOAA responses contain a detached band at -1°/0° surrounded
// by zero activity. Preserve raw probabilities; suppress only equatorial cells
// without an eight-neighbour path to activity outside ±10° in the display grid.
// A continuous equatorward expansion remains intact, without a hard latitude cap.
export function auroraEmissionGrid(forecast) {
  const grid = forecast.grid.slice();
  const connected = new Uint8Array(grid.length);
  const queue = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > 0 && Math.abs(Math.floor(i / 360) - 90) >= 10) {
      connected[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], x = index % 360, y = Math.floor(index / 360);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const row = y + dy;
      if (row < 0 || row >= 181) continue;
      const neighbour = row * 360 + (x + dx + 360) % 360;
      if (grid[neighbour] > 0 && !connected[neighbour]) { connected[neighbour] = 1; queue.push(neighbour); }
    }
  }
  for (let i = 0; i < grid.length; i++) if (!connected[i]) grid[i] = 0;
  return grid;
}
