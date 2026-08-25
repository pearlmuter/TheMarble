import { EARTH_STATE_REQUIRED_LAYERS } from './earth-state.js';

export function isHipparcosPayload(value) {
  if (typeof value !== 'object' || value === null || !('stars' in value) || !Array.isArray(value.stars)) return false;
  return value.stars.every(star => Array.isArray(star) && star.length === 4 && star.every(Number.isFinite));
}

export function validateEarthStateScene(activeEarthState, isTexture) {
  for (const name of EARTH_STATE_REQUIRED_LAYERS) {
    if (!isTexture(activeEarthState?.layers?.[name])) {
      throw new Error(`Earth-state scene asset ${name} is not a texture`);
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
  return activeEarthState;
}
