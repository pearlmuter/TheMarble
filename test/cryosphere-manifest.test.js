import assert from 'node:assert/strict';
import test from 'node:test';
import { addCryosphereAnalysis } from '../src/cryosphere-manifest.js';

const asset = href => ({
  href,
  mediaType: 'image/png',
  byteLength: 12,
  immutable: true,
  checksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
});

function baseManifest() {
  return {
    bundleId: 'base',
    datasets: [{ id: 'surface', version: '2004', attribution: 'NASA' }],
    layers: { cloudOpacity: { datasetId: 'clouds' }, cloudDensity: { datasetId: 'clouds' } },
  };
}

test('a daily analysis adds paired GPU layers and complete per-layer provenance without disturbing clouds', () => {
  const manifest = baseManifest();
  const result = addCryosphereAnalysis(manifest, {
    selection: {
      validAt: '2026-08-25T00:00:00Z',
      retrievedAt: '2026-08-26T03:00:00Z',
      analysis: {
        northernPrimary: { product: 'ims-snow-ice', version: 'IMS v3' },
        globalFallback: {
          snow: { product: 'amsr2-snow', version: 'AU_DySno V1' },
          seaIce: { product: 'amsr2-sea-ice', version: 'AU_SI12 V1' },
        },
      },
      refinement: { product: 'viirs-snow', version: 'VNP10_NRT V2' },
      fallback: { ims: false },
    },
    metadata: {
      validAt: '2026-08-25T00:00:00Z', producedAt: '2026-08-25T18:00:00Z', retrievedAt: '2026-08-26T03:00:00Z',
      dimensions: { width: 4096, height: 2048 },
      layers: {
        snowCover: {
          sourceVersion: 'IMS v3 + AU_DySno V1 + VNP10_NRT V2',
          coverage: { observedFraction: .96, latitudeRange: [-90, 90], fallbackFraction: .5 },
          fallback: 'AMSR2 fills the Southern Hemisphere and any IMS gap.',
          attribution: 'USNIC IMS; NASA/JAXA AMSR2; NASA VIIRS, modified by TheMarble',
        },
        seaIce: {
          sourceVersion: 'IMS v3 + AU_SI12 V1',
          coverage: { observedFraction: .94, latitudeRange: [-90, 90], fallbackFraction: .5 },
          fallback: 'AMSR2 fills the Southern Hemisphere and any IMS gap.',
          attribution: 'USNIC IMS; NASA/JAXA AMSR2, modified by TheMarble',
        },
      },
    },
    snowAsset: asset('./snow.png'),
    seaIceAsset: asset('./sea-ice.png'),
  });

  assert.equal(result.layers.cloudOpacity, manifest.layers.cloudOpacity);
  assert.equal(result.layers.snowCover.units, 'snow-covered land fraction');
  assert.equal(result.layers.seaIce.units, 'sea-ice concentration fraction');
  assert.match(result.layers.snowCover.provenance.sourceVersion, /VNP10/);
  assert.doesNotMatch(result.layers.seaIce.provenance.sourceVersion, /VNP10/);
  assert.doesNotMatch(result.layers.seaIce.provenance.attribution, /VIIRS/);
  assert.equal(result.layers.seaIce.provenance.coverage.observedFraction, .94);
  assert.match(result.datasets.at(-1).attribution, /IMS.*AMSR2.*VIIRS/);
  assert.equal(result.layers.snowCover.channels.r, 'snow-covered land fraction');
  assert.equal(result.layers.seaIce.channels.r, 'sea-ice concentration fraction');
});

test('manifest construction rejects compositor metadata that disagrees with daily selection', () => {
  assert.throws(() => addCryosphereAnalysis(baseManifest(), {
    selection: { validAt: '2026-08-25T00:00:00Z', retrievedAt: '2026-08-26T03:00:00Z' },
    metadata: { validAt: '2026-08-24T00:00:00Z', retrievedAt: '2026-08-26T03:00:00Z', layers: {} },
    snowAsset: asset('./snow.png'),
    seaIceAsset: asset('./sea-ice.png'),
  }), /validAt/);
});
