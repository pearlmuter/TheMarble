import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeasonalSurfaceController } from '../src/seasonal-surface-controller.js';

const frames = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, value: `frame-${index + 1}` }));

test('the seasonal controller decodes only the active pair and owns replaced texture disposal', async () => {
  const decoded = [];
  const disposed = [];
  const installed = [];
  const preview = { id: 'preview' };
  const controller = createSeasonalSurfaceController({
    initialTextures: [preview],
    async decodeFrame(frame) {
      decoded.push(frame.month);
      return { id: `texture-${frame.month}` };
    },
    installPair(pair) { installed.push(pair); },
    disposeTexture(texture) { disposed.push(texture.id); },
  });

  const prepared = await controller.prepare({ frames, date: new Date('2026-08-25T12:00:00Z') });
  controller.activate(prepared);
  controller.update(new Date('2026-08-26T12:00:00Z'));

  assert.deepEqual(decoded, [8, 9]);
  assert.deepEqual(disposed, ['preview']);
  assert.equal(installed.at(-1).from.id, 'texture-8');
  assert.equal(installed.at(-1).to.id, 'texture-9');
  assert.ok(installed.at(-1).mix > prepared.mix);
});

test('a failed rollover is caught, deduplicated, and retried only after its cooldown', async () => {
  let monotonicNow = 1_000;
  let failedDecodes = 0;
  let reportedErrors = 0;
  const controller = createSeasonalSurfaceController({
    initialTextures: [],
    now: () => monotonicNow,
    retryDelayMs: 60_000,
    async decodeFrame(frame) {
      if (frame.month === 10) {
        failedDecodes += 1;
        throw new Error('undecodable October');
      }
      return { id: `texture-${frame.month}` };
    },
    installPair() {},
    disposeTexture() {},
    onError() { reportedErrors += 1; },
  });
  controller.activate(await controller.prepare({ frames, date: new Date('2026-08-25T12:00:00Z') }));

  controller.update(new Date('2026-09-25T12:00:00Z'));
  controller.update(new Date('2026-09-25T12:00:00Z'));
  await new Promise(resolve => setImmediate(resolve));
  controller.update(new Date('2026-09-25T12:00:00Z'));

  assert.equal(failedDecodes, 1);
  assert.equal(reportedErrors, 1);

  monotonicNow += 60_000;
  controller.update(new Date('2026-09-25T12:00:00Z'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failedDecodes, 2);
  assert.equal(reportedErrors, 2);
});

test('preparing a replacement bundle never reuses month textures from the active bundle', async () => {
  const decoded = [];
  const installed = [];
  const replacementFrames = frames.map(frame => ({ ...frame, value: `replacement-${frame.month}` }));
  const controller = createSeasonalSurfaceController({
    initialTextures: [],
    async decodeFrame(frame) {
      decoded.push(frame.value);
      return { id: frame.value };
    },
    installPair(pair) { installed.push(pair); },
    disposeTexture() {},
  });
  const date = new Date('2026-08-25T12:00:00Z');
  controller.activate(await controller.prepare({ frames, date }));

  controller.activate(await controller.prepare({ frames: replacementFrames, date }));

  assert.deepEqual(decoded, ['frame-8', 'frame-9', 'replacement-8', 'replacement-9']);
  assert.equal(installed.at(-1).from.id, 'replacement-8');
  assert.equal(installed.at(-1).to.id, 'replacement-9');
});

test('a partial pair decode failure disposes the newly decoded sibling texture', async () => {
  const disposed = [];
  const controller = createSeasonalSurfaceController({
    initialTextures: [],
    async decodeFrame(frame) {
      if (frame.month === 11) throw new Error('undecodable November');
      return { id: `texture-${frame.month}` };
    },
    installPair() {},
    disposeTexture(texture) { disposed.push(texture.id); },
  });
  controller.activate(await controller.prepare({ frames, date: new Date('2026-08-25T12:00:00Z') }));

  controller.update(new Date('2026-10-25T12:00:00Z'));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(disposed, ['texture-10']);
});
