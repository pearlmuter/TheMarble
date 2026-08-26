import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEarthStateScene } from '../src/earth-state-scene.js';

function activatedScene() {
  const texture = { kind: 'texture' };
  return {
    layers: {
      surfaceAlbedo: texture,
      nightLights: texture,
      cloudOpacity: texture,
      cloudDensity: texture,
    },
    resources: {
      moonAlbedo: texture,
      milkyWay: texture,
      starCatalog: { stars: [[0, 0, 1, 0.5]] },
    },
  };
}

test('scene semantics reject a checksum-valid bundle before any renderer mutation', () => {
  const active = activatedScene();
  active.resources.starCatalog = { kind: 'texture' };
  let rendererMutations = 0;

  assert.throws(
    () => {
      validateEarthStateScene(active, asset => asset?.kind === 'texture');
      rendererMutations += 1;
    },
    /starCatalog/,
  );
  assert.equal(rendererMutations, 0);
});

test('scene semantics allow a verified deferred surface only when the manifest supplies a seasonal cycle', () => {
  const active = activatedScene();
  active.manifest = { layers: { surfaceAlbedo: { seasonalCycle: { frames: Array(12).fill(null) } } } };
  active.layers.surfaceAlbedo = { kind: 'deferred-surface' };

  assert.equal(
    validateEarthStateScene(
      active,
      asset => asset?.kind === 'texture',
      { isSeasonalSurfaceSource: asset => asset?.kind === 'deferred-surface' },
    ),
    active,
  );

  delete active.manifest.layers.surfaceAlbedo.seasonalCycle;
  assert.throws(
    () => validateEarthStateScene(
      active,
      asset => asset?.kind === 'texture',
      { isSeasonalSurfaceSource: asset => asset?.kind === 'deferred-surface' },
    ),
    /surfaceAlbedo/,
  );
});

test('scene semantics reject a cloud sequence unless both complete frames contain textures', () => {
  const active = activatedScene();
  const texture = { kind: 'texture' };
  active.cloudSequence = {
    frames: [
      { layers: { cloudOpacity: texture, cloudDensity: { kind: 'decoded-json' } } },
      { layers: { cloudOpacity: texture, cloudDensity: texture } },
    ],
  };

  assert.throws(
    () => validateEarthStateScene(active, asset => asset?.kind === 'texture'),
    /cloudSequence\.frames\.0\.layers\.cloudDensity/,
  );
});
