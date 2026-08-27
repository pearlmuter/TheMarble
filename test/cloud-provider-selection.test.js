import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCloudProviderSequence } from '../src/cloud-provider-selection.js';

const frame = (provider, validAt, options = {}) => ({
  provider,
  validAt,
  observedFrom: options.observedFrom ?? validAt,
  observedTo: options.observedTo ?? new Date(Date.parse(validAt) + 10 * 60 * 1000).toISOString(),
  producedAt: options.producedAt ?? new Date(Date.parse(validAt) + 25 * 60 * 1000).toISOString(),
  version: options.version ?? `${provider}-fixture-v1`,
  coverage: options.coverage ?? { observedFraction: .98 },
  quality: options.quality ?? { usableFraction: .95 },
  assets: options.assets ?? { manifest: `https://fixtures.test/${provider}/${validAt}.json` },
});

const sequence = (provider, first, second, options = {}) => ({
  provider,
  frames: [frame(provider, first, options.first), frame(provider, second, options.second)],
});

test('fresh complete SatCORPS wins over an equally fresh GMGSI fallback', () => {
  const selected = selectCloudProviderSequence({
    sequences: [
      sequence('gmgsi', '2026-08-25T14:00:00Z', '2026-08-25T15:00:00Z'),
      sequence('satcorps', '2026-08-25T14:00:00Z', '2026-08-25T15:00:00Z'),
    ],
    retrievedAt: '2026-08-25T16:00:00Z',
  });

  assert.equal(selected.provider, 'satcorps');
  assert.deepEqual(selected.frames.map(item => item.validAt), [
    '2026-08-25T14:00:00Z',
    '2026-08-25T15:00:00Z',
  ]);
  assert.equal(selected.fallback, undefined);
  assert.equal(selected.publish, true);
});

test('the newest usable sequence wins within the preferred provider', () => {
  const selected = selectCloudProviderSequence({
    sequences: [
      sequence('satcorps', '2026-08-25T14:00:00Z', '2026-08-25T15:00:00Z'),
      sequence('satcorps', '2026-08-25T15:00:00Z', '2026-08-25T16:00:00Z'),
    ],
    retrievedAt: '2026-08-25T16:30:00Z',
  });
  assert.equal(selected.frames[1].validAt, '2026-08-25T16:00:00Z');
});

test('GMGSI takes over when SatCORPS is stale, incomplete, corrupt, or below coverage and quality thresholds', () => {
  const fallback = sequence('gmgsi', '2026-08-25T14:00:00Z', '2026-08-25T15:00:00Z');
  const rejected = [
    sequence('satcorps', '2026-08-25T10:00:00Z', '2026-08-25T11:00:00Z'),
    { provider: 'satcorps', frames: [frame('satcorps', '2026-08-25T15:30:00Z')] },
    sequence('satcorps', '2026-08-25T14:00:00Z', '2026-08-25T15:00:00Z', {
      second: { assets: { manifest: '' } },
    }),
    sequence('satcorps', '2026-08-25T14:00:00Z', '2026-08-25T15:00:00Z', {
      second: { coverage: { observedFraction: .84 } },
    }),
    sequence('satcorps', '2026-08-25T14:00:00Z', '2026-08-25T15:00:00Z', {
      second: { quality: { usableFraction: .69 } },
    }),
  ];

  for (const satcorps of rejected) {
    const selected = selectCloudProviderSequence({
      sequences: [fallback, satcorps],
      retrievedAt: '2026-08-25T16:00:00Z',
    });
    assert.equal(selected.provider, 'gmgsi');
    assert.equal(selected.fallback.from, 'satcorps');
    assert.match(selected.fallback.reason, /rejected|unavailable/i);
  }
});

test('selection rejects incoherent frame spacing and never regresses the published cloud edge', () => {
  assert.throws(() => selectCloudProviderSequence({
    sequences: [sequence('satcorps', '2026-08-25T14:00:00Z', '2026-08-25T15:30:00Z')],
    retrievedAt: '2026-08-25T16:30:00Z',
  }), /usable cloud provider sequence/i);

  const selected = selectCloudProviderSequence({
    sequences: [sequence('gmgsi', '2026-08-25T14:00:00Z', '2026-08-25T15:00:00Z')],
    retrievedAt: '2026-08-25T16:00:00Z',
    lastPublishedValidAt: '2026-08-25T15:00:00Z',
  });
  assert.equal(selected.publish, false);
});

test('future observations and products produced after retrieval are rejected', () => {
  const future = sequence('satcorps', '2026-08-25T15:00:00Z', '2026-08-25T16:00:00Z', {
    second: { producedAt: '2026-08-25T16:35:00Z' },
  });
  assert.throws(() => selectCloudProviderSequence({
    sequences: [future],
    retrievedAt: '2026-08-25T16:05:00Z',
  }), /usable cloud provider sequence/i);
});
