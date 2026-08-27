import assert from 'node:assert/strict';
import test from 'node:test';
import { rebaseEarthStateSourceAssets } from '../src/earth-state-source-assets.js';

test('a derived bundle preserves exact source locations for published and public-root assets', () => {
  const source = {
    layers: {
      surfaceAlbedo: {
        asset: { href: '../../assets/surface.jpg' },
        seasonalCycle: {
          frames: [{ month: 2, asset: { href: '../../assets/february.jpg' } }],
        },
      },
      cloudOpacity: { asset: { href: '../../assets/cloud-now.png' } },
    },
    resources: {
      moonAlbedo: { asset: { href: '/moon-1024.jpg' } },
    },
    cloudSequence: {
      frames: [{ layers: { cloudOpacity: { asset: { href: '../../assets/cloud-before.png' } } } }],
    },
  };

  const rebased = rebaseEarthStateSourceAssets(source, {
    sourceManifestUrl: 'file:///repo/public/earth-state/bundles/2026-08-26/manifest.json',
    publicRootUrl: 'file:///repo/public/',
  });

  assert.equal(rebased.manifest.layers.surfaceAlbedo.asset.href, 'file:///repo/public/earth-state/assets/surface.jpg');
  assert.equal(rebased.manifest.layers.surfaceAlbedo.seasonalCycle.frames[0].asset.href, 'file:///repo/public/earth-state/assets/february.jpg');
  assert.equal(rebased.manifest.layers.cloudOpacity.asset.href, 'file:///repo/public/earth-state/assets/cloud-now.png');
  assert.equal(rebased.manifest.resources.moonAlbedo.asset.href, 'file:///repo/public/moon-1024.jpg');
  assert.equal(rebased.manifest.cloudSequence.frames[0].layers.cloudOpacity.asset.href, 'file:///repo/public/earth-state/assets/cloud-before.png');
  assert.deepEqual(rebased.sourceUrls, new Set([
    'file:///repo/public/earth-state/assets/surface.jpg',
    'file:///repo/public/earth-state/assets/february.jpg',
    'file:///repo/public/earth-state/assets/cloud-now.png',
    'file:///repo/public/moon-1024.jpg',
    'file:///repo/public/earth-state/assets/cloud-before.png',
  ]));
  assert.equal(source.layers.surfaceAlbedo.asset.href, '../../assets/surface.jpg');
});
