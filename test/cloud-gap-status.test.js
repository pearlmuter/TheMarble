import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCloudGapStatus } from '../src/cloud-gap-status.js';

test('hidden cloud details disclose observed, polar, model, fallback, and acceptance thresholds', () => {
  const text = formatCloudGapStatus({
    gapCompletion: { maxObservationAgeSeconds: 10_800, minObservationQuality: .72, seamBlendPixels: 3 },
    frame: {
      coverage: { observedFraction: .75, modelAssistedFraction: .2, fallbackFraction: .05 },
      assistance: {
        polarObservation: { product: 'viirs-cloud' },
        model: { forecastHour: 4, runAt: '2026-08-27T12:00:00Z' },
      },
    },
  });

  assert.equal(text, '75% observed (VIIRS polar) · 20% GFS f004 from 12Z · 5% static · accepted ≤180 min, q≥72%');
});

test('no gap-completion contract produces no extra status', () => {
  assert.equal(formatCloudGapStatus({ frame: {} }), undefined);
});
