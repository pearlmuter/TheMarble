import { EARTH_STATE_REQUIRED_LAYERS } from './earth-state.js';

export function isHipparcosPayload(value) {
  if (typeof value !== 'object' || value === null || !('stars' in value) || !Array.isArray(value.stars)) return false;
  return value.stars.every(star => Array.isArray(star) && star.length === 4 && star.every(Number.isFinite));
}

export function validateEarthStateScene(activeEarthState, isTexture, { isSeasonalSurfaceSource = () => false } = {}) {
  for (const name of EARTH_STATE_REQUIRED_LAYERS) {
    const asset = activeEarthState?.layers?.[name];
    const isDeferredSeasonalSurface = name === 'surfaceAlbedo'
      && activeEarthState?.manifest?.layers?.surfaceAlbedo?.seasonalCycle
      && isSeasonalSurfaceSource(asset);
    if (!isTexture(asset) && !isDeferredSeasonalSurface) {
      throw new Error(`Earth-state scene asset ${name} is not a texture`);
    }
  }
  const hasSnow = Object.hasOwn(activeEarthState?.layers ?? {}, 'snowCover');
  const hasSeaIce = Object.hasOwn(activeEarthState?.layers ?? {}, 'seaIce');
  if (hasSnow !== hasSeaIce) {
    throw new Error(`Earth-state scene asset ${hasSnow ? 'seaIce' : 'snowCover'} is missing`);
  }
  if (hasSnow) {
    for (const name of ['snowCover', 'seaIce']) {
      if (!isTexture(activeEarthState.layers[name])) {
        throw new Error(`Earth-state scene asset ${name} is not a texture`);
      }
    }
  }
  for (const name of ['moonAlbedo', 'milkyWay']) {
    if (!isTexture(activeEarthState?.resources?.[name])) {
      throw new Error(`Earth-state scene asset ${name} is not a texture`);
    }
  }
  if (!isHipparcosPayload(activeEarthState?.resources?.starCatalog)) {
    throw new Error('Earth-state scene asset starCatalog is invalid');
  }
  for (const [frameIndex, frame] of (activeEarthState?.cloudSequence?.frames ?? []).entries()) {
    for (const name of ['cloudOpacity', 'cloudDensity']) {
      if (!isTexture(frame?.layers?.[name])) {
        throw new Error(`Earth-state scene asset cloudSequence.frames.${frameIndex}.layers.${name} is not a texture`);
      }
    }
  }
  return activeEarthState;
}
