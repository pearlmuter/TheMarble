import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRollingSurfaceObservations } from '../src/rolling-surface-selection.js';

const candidate = (overrides = {}) => ({
  product: 'mcd43a4-nbar',
  version: 'MCD43A4.061',
  href: './mcd43a4-2026-08-24.npz',
  validAt: '2026-08-24T12:00:00Z',
  observedFrom: '2026-08-17T00:00:00Z',
  observedTo: '2026-08-24T23:59:59Z',
  producedAt: '2026-08-25T06:00:00Z',
  coverage: { observedFraction: 0.91 },
  quality: { acceptedFraction: 0.82 },
  ...overrides,
});

test('selects current quality-approved MODIS and VIIRS surface observations in deterministic priority order', () => {
  const selected = selectRollingSurfaceObservations({
    targetTime: '2026-08-27T12:00:00Z',
    previousValidAt: '2026-08-23T12:00:00Z',
    maxCandidateAgeDays: 16,
    minAcceptedFraction: 0.25,
    candidates: [
      candidate({ product: 'viirs-surface-reflectance', version: 'VNP09GA.002', href: './viirs.npz', validAt: '2026-08-26T12:00:00Z', observedFrom: '2026-08-26T00:00:00Z', observedTo: '2026-08-26T23:59:59Z', producedAt: '2026-08-27T06:00:00Z' }),
      candidate(),
      candidate({ href: './too-cloudy.npz', quality: { acceptedFraction: 0.08 } }),
      candidate({ href: './regression.npz', validAt: '2026-08-22T12:00:00Z', observedFrom: '2026-08-15T00:00:00Z', observedTo: '2026-08-22T23:59:59Z' }),
      candidate({ product: 'unapproved-surface', href: './unknown.npz' }),
    ],
  });

  assert.deepEqual(selected.map(item => item.href), ['./viirs.npz', './mcd43a4-2026-08-24.npz']);
});

test('rejects observations that claim future, inverted, or stale observation windows', () => {
  const selected = selectRollingSurfaceObservations({
    targetTime: '2026-08-27T12:00:00Z',
    maxCandidateAgeDays: 10,
    minAcceptedFraction: 0.25,
    candidates: [
      candidate({ href: './future.npz', validAt: '2026-08-28T12:00:00Z' }),
      candidate({ href: './inverted.npz', observedFrom: '2026-08-25T00:00:00Z', observedTo: '2026-08-24T00:00:00Z' }),
      candidate({ href: './stale.npz', validAt: '2026-08-01T12:00:00Z', observedFrom: '2026-07-24T00:00:00Z', observedTo: '2026-08-01T23:59:59Z' }),
    ],
  });

  assert.deepEqual(selected, []);
});
