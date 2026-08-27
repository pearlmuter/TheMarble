import assert from 'node:assert/strict';
import test from 'node:test';
import { selectEarthSurfaceForRendering } from '../src/earth-surface-selection.js';

test('renders the rolling top surface while retaining seasonal frames outside the active path', () => {
  const rollingTexture = { name: 'rolling surface' };
  const seasonalFrames = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, value: { month: index + 1 } }));
  const selection = selectEarthSurfaceForRendering({
    manifest: { layers: { surfaceAlbedo: { rollingComposite: { coverage: { rollingFraction: 0.8 } }, seasonalCycle: { frames: Array(12) } } } },
    layers: { surfaceAlbedo: rollingTexture },
    seasonalLayers: { surfaceAlbedo: seasonalFrames },
  });

  assert.deepEqual(selection, { mode: 'rolling', frames: [], fallbackAsset: rollingTexture });
});

test('continues to render the calendar pair for a seasonal-only bundle', () => {
  const frames = [{ month: 8, value: 'august' }, { month: 9, value: 'september' }];
  const selection = selectEarthSurfaceForRendering({
    manifest: { layers: { surfaceAlbedo: { seasonalCycle: { frames: Array(12) } } } },
    layers: { surfaceAlbedo: 'deferred' },
    seasonalLayers: { surfaceAlbedo: frames },
  });

  assert.deepEqual(selection, { mode: 'seasonal', frames, fallbackAsset: undefined });
});
