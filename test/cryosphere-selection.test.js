import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDailyCryosphere } from '../src/cryosphere-selection.js';

const candidate = (product, validAt, options = {}) => ({
  product,
  validAt,
  producedAt: options.producedAt ?? `${validAt.slice(0, 10)}T18:00:00Z`,
  version: options.version ?? 'fixture-v1',
  href: options.href ?? `https://fixtures.test/${product}/${validAt.slice(0, 10)}.tif`,
  coverage: options.coverage ?? { latitudeRange: [-90, 90], observedFraction: 1 },
});

test('the newest complete global day uses IMS in the north and the documented global analysis as fallback', () => {
  const candidates = [
    candidate('amsr2-snow', '2026-08-24T00:00:00Z'),
    candidate('amsr2-sea-ice', '2026-08-24T00:00:00Z'),
    candidate('ims-snow-ice', '2026-08-24T00:00:00Z', { coverage: { latitudeRange: [0, 90], observedFraction: 0.5 } }),
    candidate('amsr2-snow', '2026-08-25T00:00:00Z'),
    candidate('amsr2-sea-ice', '2026-08-25T00:00:00Z'),
    candidate('ims-snow-ice', '2026-08-25T00:00:00Z', { coverage: { latitudeRange: [0, 90], observedFraction: 0.5 } }),
  ];

  const selected = selectDailyCryosphere({
    candidates,
    retrievedAt: '2026-08-26T03:00:00Z',
  });

  assert.equal(selected.validAt, '2026-08-25T00:00:00Z');
  assert.equal(selected.analysis.northernPrimary.product, 'ims-snow-ice');
  assert.equal(selected.analysis.globalFallback.snow.product, 'amsr2-snow');
  assert.equal(selected.analysis.globalFallback.seaIce.product, 'amsr2-sea-ice');
  assert.equal(selected.fallback.ims, false);
  assert.equal(selected.publish, true);
});

test('a complete global day still publishes with an explicit IMS fallback when IMS is late', () => {
  const selected = selectDailyCryosphere({
    candidates: [
      candidate('amsr2-snow', '2026-08-25T00:00:00Z'),
      candidate('amsr2-sea-ice', '2026-08-25T00:00:00Z'),
      candidate('ims-snow-ice', '2026-08-24T00:00:00Z', { coverage: { latitudeRange: [0, 90], observedFraction: 0.5 } }),
    ],
    retrievedAt: '2026-08-26T03:00:00Z',
  });

  assert.equal(selected.validAt, '2026-08-25T00:00:00Z');
  assert.equal(selected.analysis.northernPrimary, undefined);
  assert.equal(selected.fallback.ims, true);
  assert.match(selected.fallback.reason, /IMS/i);
});

test('VIIRS is optional and only selected when it is recent enough to refine the chosen analysis day', () => {
  const base = [
    candidate('amsr2-snow', '2026-08-25T00:00:00Z'),
    candidate('amsr2-sea-ice', '2026-08-25T00:00:00Z'),
  ];
  const selected = selectDailyCryosphere({
    candidates: [
      ...base,
      candidate('viirs-snow', '2026-08-23T00:00:00Z'),
      candidate('viirs-snow', '2026-08-25T12:00:00Z', { producedAt: '2026-08-25T13:00:00Z' }),
    ],
    retrievedAt: '2026-08-26T03:00:00Z',
  });

  assert.equal(selected.refinement.product, 'viirs-snow');
  assert.equal(selected.refinement.validAt, '2026-08-25T12:00:00Z');
});

test('selection never republishes or regresses an already published daily analysis', () => {
  const selected = selectDailyCryosphere({
    candidates: [
      candidate('amsr2-snow', '2026-08-25T00:00:00Z'),
      candidate('amsr2-sea-ice', '2026-08-25T00:00:00Z'),
    ],
    retrievedAt: '2026-08-26T03:00:00Z',
    lastPublishedValidAt: '2026-08-25T00:00:00Z',
  });

  assert.equal(selected.publish, false);
});

test('selection rejects stale or future-dated source products', () => {
  assert.throws(
    () => selectDailyCryosphere({
      candidates: [
        candidate('amsr2-snow', '2026-08-19T00:00:00Z'),
        candidate('amsr2-sea-ice', '2026-08-19T00:00:00Z'),
        candidate('amsr2-snow', '2026-08-27T00:00:00Z'),
        candidate('amsr2-sea-ice', '2026-08-27T00:00:00Z'),
      ],
      retrievedAt: '2026-08-26T03:00:00Z',
    }),
    /complete global cryosphere day/i,
  );
});

test('the operational 2 km GMASI global analysis is preferred when both documented fallbacks exist', () => {
  const selected = selectDailyCryosphere({
    candidates: [
      candidate('amsr2-snow', '2026-08-25T00:00:00Z'),
      candidate('amsr2-sea-ice', '2026-08-25T00:00:00Z'),
      candidate('gmasi-snow', '2026-08-25T00:00:00Z'),
      candidate('gmasi-sea-ice', '2026-08-25T00:00:00Z'),
    ],
    retrievedAt: '2026-08-26T03:00:00Z',
  });

  assert.equal(selected.analysis.globalFallback.snow.product, 'gmasi-snow');
  assert.equal(selected.analysis.globalFallback.seaIce.product, 'gmasi-sea-ice');
});
