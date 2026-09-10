import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { installCaptureFramePacing } from '../scripts/lib/capture-frame-pacing.mjs';

function browserClock() {
  let now = 0, serial = 0;
  const timers = new Map(), frames = new Map();
  const window = {
    performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  runInNewContext(`(${installCaptureFramePacing.toString()})(4)`, { window });
  return { window, tick(time) {
    now = time;
    for (const [id, task] of [...timers]) if (task.at <= now) { timers.delete(id); task.fn(); }
    for (const [id, fn] of [...frames]) { frames.delete(id); fn(now); }
  } };
}
test('capture pacing delivers parallel RAF loops together without starving capability measurement', () => {
  const { window, tick } = browserClock();
  const scene = [], capabilities = [];
  const draw = time => { scene.push(time); window.requestAnimationFrame(draw); };
  const measure = time => { capabilities.push(time); window.requestAnimationFrame(measure); };
  window.requestAnimationFrame(draw); window.requestAnimationFrame(measure);
  for (let time = 0; time <= 1000; time += 10) tick(time);
  assert.deepEqual(scene, [0, 250, 500, 750, 1000]);
  assert.deepEqual(capabilities, scene);
});
test('capture pacing cancels callbacks, including cancellation by an earlier callback in the same frame', () => {
  const { window, tick } = browserClock();
  let called = 0;
  const first = window.requestAnimationFrame(() => called++);
  window.cancelAnimationFrame(first); tick(0);
  window.requestAnimationFrame(() => window.cancelAnimationFrame(second));
  const second = window.requestAnimationFrame(() => called++);
  tick(10); assert.equal(called, 0);
});
test('lifting capture pacing releases pending callbacks at native cadence without losing their handles', () => {
  const { window, tick } = browserClock();
  const times = [];
  const draw = time => { times.push(time); window.requestAnimationFrame(draw); };
  window.requestAnimationFrame(draw); tick(0); tick(16);
  assert.deepEqual(times, [0]);
  window.__captureResumeFrames(); tick(32); tick(48);
  assert.deepEqual(times, [0, 32, 48]);
});
