import assert from 'node:assert/strict';
import test from 'node:test';
import { selectGmgsiCloudSequence } from '../src/gmgsi-discovery.js';

const key = (band, hour, createdMinute = band === 'VIS' ? '43' : '35') => {
  const product = band === 'VIS' ? 'GLOBCOMPVIS' : 'GLOBCOMPLIR';
  return `GMGSI_${band === 'VIS' ? 'VIS' : 'LW'}/2026/08/25/${hour}/${product}_v3r0_blend_s20260825${hour}00000_e20260825${hour}09599_c20260825${hour}${createdMinute}000.nc`;
};

test('discovery chooses the newest two adjacent complete visible/infrared hours and ignores partial arrival', () => {
  const keys = [
    key('VIS', '14'), key('LW', '14'),
    key('VIS', '15'), key('LW', '15'),
    key('VIS', '16'),
  ];

  const selected = selectGmgsiCloudSequence({
    keys,
    retrievedAt: '2026-08-25T16:48:00Z',
  });

  assert.deepEqual(selected.frames.map(frame => frame.validAt), [
    '2026-08-25T14:00:00Z',
    '2026-08-25T15:00:00Z',
  ]);
  assert.match(selected.frames[1].visibleKey, /GMGSI_VIS\/2026\/08\/25\/15\//);
  assert.match(selected.frames[1].longwaveKey, /GMGSI_LW\/2026\/08\/25\/15\//);
  assert.equal(selected.publish, true);
});

test('discovery keeps the last published hour when NOAA is late and never republishes one nominal hour', () => {
  const keys = [key('VIS', '14'), key('LW', '14'), key('VIS', '15'), key('LW', '15'), key('LW', '16')];

  const selected = selectGmgsiCloudSequence({
    keys,
    retrievedAt: '2026-08-25T17:12:00Z',
    lastPublishedValidAt: '2026-08-25T15:00:00Z',
  });

  assert.equal(selected.frames[1].validAt, '2026-08-25T15:00:00Z');
  assert.equal(selected.publish, false);
});

test('discovery rejects a pair whose visible and infrared observation windows disagree', () => {
  const mismatched = key('LW', '15').replace('_e202608251509599_', '_e202608251519599_');

  assert.throws(
    () => selectGmgsiCloudSequence({
      keys: [key('VIS', '14'), key('LW', '14'), key('VIS', '15'), mismatched],
      retrievedAt: '2026-08-25T16:00:00Z',
    }),
    /two adjacent complete GMGSI hours/,
  );
});
