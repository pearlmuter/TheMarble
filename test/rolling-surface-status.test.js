import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRollingSurfaceStatus } from '../src/rolling-surface-status.js';

test('discloses rolling age, contributing window, and seasonal fallback without calling it live', () => {
  assert.equal(formatRollingSurfaceStatus({
    observedFrom: '2026-08-12T00:00:00Z',
    observedTo: '2026-08-26T23:59:59Z',
    coverage: { rollingFraction: 0.73, updatedFraction: 0.08, baselineFraction: 0.27 },
    oldestPixelAgeDays: 41,
    newestPixelAgeDays: 1,
    sourceProducts: ['mcd43a4-nbar', 'viirs-surface-reflectance'],
  }), 'land rolling MCD43A4 + VIIRS · observations 12 Aug → 26 Aug · ages 1–41 d · 73% rolling, 8% refreshed, 27% seasonal fallback');
});

test('describes a baseline-only result without inventing an observation age', () => {
  assert.equal(formatRollingSurfaceStatus({
    observedFrom: '2004-08-01T00:00:00Z',
    observedTo: '2004-08-31T23:59:59Z',
    coverage: { rollingFraction: 0, updatedFraction: 0, baselineFraction: 1 },
    oldestPixelAgeDays: null,
    newestPixelAgeDays: null,
    sourceProducts: [],
  }), 'land seasonal fallback · no accepted contemporary surface observations');
});
