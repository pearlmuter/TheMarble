import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCloudGapSources } from '../src/cloud-gap-selection.js';

const polar = (product, validAt, overrides = {}) => ({
  product,
  validAt,
  observedFrom: new Date(Date.parse(validAt) - 18 * 60 * 1000).toISOString(),
  observedTo: new Date(Date.parse(validAt) - 2 * 60 * 1000).toISOString(),
  producedAt: new Date(Date.parse(validAt) + 25 * 60 * 1000).toISOString(),
  version: 'v2',
  href: `https://fixtures.test/${product}-${validAt}.npz`,
  coverage: { observedFraction: .24, latitudeRange: [-90, 90] },
  ...overrides,
});

const gfs = (runAt, forecastHour, overrides = {}) => ({
  product: 'gfs-total-cloud',
  runAt,
  forecastHour,
  validAt: new Date(Date.parse(runAt) + forecastHour * 60 * 60 * 1000).toISOString(),
  producedAt: new Date(Date.parse(runAt) + 55 * 60 * 1000).toISOString(),
  version: '0p25-v16',
  href: `https://fixtures.test/gfs-f${String(forecastHour).padStart(3, '0')}.npy`,
  coverage: { observedFraction: 1, latitudeRange: [-90, 90] },
  ...overrides,
});

test('fresh polar observations are selected ahead of matching GFS assistance', () => {
  const targetValidAt = '2026-08-25T16:00:00Z';
  const result = selectCloudGapSources({
    targetValidAt,
    retrievedAt: '2026-08-25T16:45:00Z',
    candidates: [
      gfs('2026-08-25T12:00:00Z', 4),
      polar('modis-cloud', '2026-08-25T15:20:00Z'),
      polar('viirs-cloud', '2026-08-25T15:50:00Z'),
    ],
    thresholds: { maxObservationAgeSeconds: 3 * 60 * 60, minObservationQuality: .72, seamBlendPixels: 3 },
  });

  assert.equal(result.polarObservation.product, 'viirs-cloud');
  assert.equal(result.model.runAt, '2026-08-25T12:00:00Z');
  assert.equal(result.model.forecastHour, 4);
  assert.deepEqual(result.thresholds, {
    maxObservationAgeSeconds: 10_800,
    minObservationQuality: .72,
    seamBlendPixels: 3,
  });
});

test('a polar mosaic whose valid time follows the target frame is not backfilled into the past', () => {
  const result = selectCloudGapSources({
    targetValidAt: '2026-08-25T16:00:00Z',
    retrievedAt: '2026-08-25T16:45:00Z',
    candidates: [polar('viirs-cloud', '2026-08-25T16:10:00Z', {
      observedFrom: '2026-08-25T15:55:00Z',
      observedTo: '2026-08-25T15:59:00Z',
      producedAt: '2026-08-25T16:20:00Z',
    })],
    thresholds: { maxObservationAgeSeconds: 10_800, minObservationQuality: .72, seamBlendPixels: 3 },
  });

  assert.equal(result.polarObservation, undefined);
});
