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
