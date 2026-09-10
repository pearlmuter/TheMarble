// Serialized into the diagnostic browser only. The production app is unmodified.
// Batch all RAF subscribers together, preserving timestamps and cancellation;
// throttling each callback independently can starve parallel animation loops.
export function installCaptureFramePacing(framesPerSecond) {
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  let nextId = 1, scheduled = null, timer = null, lastFrame = -Infinity;
  let interval = 1000 / framesPerSecond;
  const callbacks = new Map();
  function schedule() {
    if (!callbacks.size || scheduled !== null || timer !== null) return;
    const delay = Math.max(0, lastFrame + interval - window.performance.now());
    timer = window.setTimeout(() => {
      timer = null;
      scheduled = nativeRequest(time => {
        scheduled = null;
        lastFrame = time;
        // A callback registered during this batch belongs to the next frame.
        for (const id of [...callbacks.keys()]) {
          const callback = callbacks.get(id);
          if (!callback) continue;
          callbacks.delete(id);
          try { callback(time); }
          catch (error) { window.setTimeout(() => { throw error; }, 0); }
        }
        schedule();
      });
    }, delay);
  }
  window.requestAnimationFrame = callback => {
    const id = nextId++;
    callbacks.set(id, callback);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = id => {
    callbacks.delete(id);
    if (!callbacks.size) {
      if (timer !== null) window.clearTimeout(timer);
      if (scheduled !== null) nativeCancel(scheduled);
      timer = scheduled = null;
    }
  };
  // Retain the callback handles while lifting the loading-only cadence limit.
  window.__captureResumeFrames = () => {
    interval = 0;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    schedule();
  };
}
