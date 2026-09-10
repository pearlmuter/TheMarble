# Rendering efficiency without reducing detail

The September 2026 performance work responds to sustained laptop load. Its scope
is to remove redundant work while retaining texture tiers, Retina pixel ratio,
atmospheric and auroral integration samples, luminosity, animation cadence,
and the existing zoom limit. This is not a low-quality mode or a frame-rate cap.

## Changes

- The menu clock reuses locale formatters and formats once per displayed second.
  Sun and lightning status text is assigned only when its content changes.
  The clock still updates while the menu is closed, so opening it reveals the
  current time immediately. Dates, time jumps, and daylight-saving offsets use
  the scene's actual timestamp.
- Canvas MSAA is disabled. Scene geometry already renders into the existing HDR
  scene target, whose sampling is unchanged. Only a screen-filling presentation
  quad reaches the default canvas framebuffer; multisampling that quad adds a
  resolve without smoothing any Earth geometry.
- Aurora rays whose entire emitting interval has zero daylight display contrast
  are rejected before integration. Individual zero-contrast samples also skip
  the emission lookup. This preserves the existing display model, including its
  distinction between sunlight suppressing contrast and stopping excitation.
- Dipole field lines preserve magnetic longitude. Aurora sampling now computes
  the reference magnetic latitude directly instead of reconstructing a 3D
  footpoint and projecting it back into magnetic coordinates 64 times per pixel.
  The original mapping is retained immediately around the magnetic axis, where
  longitude becomes singular. Shell boundaries, 64 integration samples,
  afterglow, emission history, and atmospheric transmission are unchanged.

The whole-ray daylight rejection is conservative: projection of a point onto
`sunLocal` is linear along each ray interval. Its minimum is at an endpoint.
When all endpoints project beyond `0.08 * AURORA_OUTER`, every sample's
`dot(normal, sunLocal)` is at least 0.08 because its radius cannot exceed the
outer shell radius. The original smoothstep then contributes exactly zero.

## Measurements and limits

Measured locally using Chromium/ANGLE Metal on an Apple M1 Max. These are
controlled browser workload measurements, not temperatures or power readings
from the user's M1. They do not establish that a fan will stay off.

At 1512 × 982 CSS pixels with device pixel ratio 2:

- A fixed-time ordinary Earth view rewrote unchanged, closed-menu text about
  240 times/second before the change; the regression check observes zero after.
- The first isolated menu correction reduced average scene-update JavaScript
  time from 0.616 ms to 0.283 ms/frame, and browser task time from 0.665 to
  0.464 seconds over a four-second run. These exclude GPU execution, and timings
  vary with browser load. No frame-rate or resolution reduction was applied.
- A high-frequency full-screen texture compared canvas MSAA 4× versus 0× at
  3024 × 1964 pixels. All 23,756,544 RGBA channels were identical.

For aurora, two fixed northern/southern demonstration views used 1000 × 800 CSS
pixels at DPR 2. The comparison swaps the old and new shaders against the same
camera, emission texture and uniforms, without advancing the simulation. No
channel differed by more than one 8-bit rounding level; 393 and 530 of 12,800,000
channels changed in the recorded run (under 0.005%).

Alternating old/new renders with the ordinary animation loop paused gave median
complete-scene draw-and-readback times of **15.6 → 14.0 ms** in the northern view
and **14.7 → 13.4 ms** in the southern view. Each measurement forces completion
with a one-pixel readback and includes that overhead. These show about 9–10%
less elapsed work for those views; they are not FPS or pure GPU timer readings.
Uncontrolled whole-browser timings were noisier, so they are not used to claim
an additional percentage improvement from the canvas change.

## Reproduce

Start the development server on port 5186, then run these separately so that GPU
benchmarks do not compete with each other. Set `RENDER_TEST_URL` (including the
trailing slash) to use another local development URL.

```sh
ASSERT_EFFICIENCY=1 node scripts/measure-render-efficiency.mjs current
node scripts/verify-presentation-canvas.mjs
node scripts/verify-aurora-render.mjs bf7c5ff798fadf168d411a85490c5b70238868b1
npm test
npm run build
```

The scene checks return immediate, non-retryable 404s for live feed requests
(including same-origin feeds), await completed fallback activation, and use the bundled Earth preview
plus the recorded aurora demonstration, so asynchronous data arrivals cannot
change the measured scene or legitimately update provenance mid-test. The canvas
comparison requires the browser to grant MSAA in its first context.

The browser checks write reports into ignored `artifacts/render-efficiency/`.
The aurora check accepts a baseline Git revision and compiles its actual shader
for an in-place comparison. Revisit its tolerance intentionally if a subsequent
change is meant to alter the image. Timing numbers are diagnostic, not brittle
machine-speed assertions. The closed-menu assertion was run before the fix and
failed on 966 redundant mutations in four seconds.
