import assert from 'node:assert/strict';
import test from 'node:test';
import { selectSeasonalSurfaceFrames } from '../src/seasonal-surface.js';

test('seasonal surface selection anchors each monthly composite at the middle of its observation month', () => {
  assert.deepEqual(
    selectSeasonalSurfaceFrames(new Date('2024-03-01T12:00:00.000Z')),
    { fromMonth: 2, toMonth: 3, mix: 0.5 },
  );
});

test('seasonal surface selection crosses the year boundary without a visual jump', () => {
  const decemberEnd = selectSeasonalSurfaceFrames(new Date('2025-12-31T23:59:59.999Z'));
  const januaryStart = selectSeasonalSurfaceFrames(new Date('2026-01-01T00:00:00.000Z'));

  assert.equal(decemberEnd.fromMonth, 12);
  assert.equal(decemberEnd.toMonth, 1);
  assert.equal(januaryStart.fromMonth, 12);
  assert.equal(januaryStart.toMonth, 1);
  assert.ok(januaryStart.mix > decemberEnd.mix);
  assert.ok(januaryStart.mix - decemberEnd.mix < 1e-8);
});

test('the frame pair rolls over continuously at a monthly midpoint', () => {
  const beforeMidpoint = selectSeasonalSurfaceFrames(new Date('2026-01-16T11:59:59.999Z'));
  const atMidpoint = selectSeasonalSurfaceFrames(new Date('2026-01-16T12:00:00.000Z'));

  assert.equal(beforeMidpoint.fromMonth, 12);
  assert.equal(beforeMidpoint.toMonth, 1);
  assert.ok(beforeMidpoint.mix > 0.999999);
  assert.deepEqual(atMidpoint, { fromMonth: 1, toMonth: 2, mix: 0 });
});

test('seasonal surface selection rejects invalid dates', () => {
  assert.throws(
    () => selectSeasonalSurfaceFrames(new Date(Number.NaN)),
    /valid Date/,
  );
});
