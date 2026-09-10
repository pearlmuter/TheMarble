# Sustained rendering cost and software-rendered health checks

The user reports that the site loads in under 15 seconds but the Mac's fans run
after several minutes. Startup latency and sustained graphics load are different
measurements: the globe continues shading millions of pixels on every frame after
its data has loaded. The terminator is calculated locally from the Sun's direction
and the Earth surface normal. The health job's `terminator` is a camera-view name,
not another image or data product downloaded from a provider.

## Layer measurements

An Apple M1 Max, Chromium/ANGLE Metal, 1512 × 982 CSS pixels at DPR 2
(5,939,136 rendered pixels), using the bundled Earth and a recorded aurora demo.
The camera and simulation were frozen. Each layer was disabled in turn while
retaining the rest of the scene; Earth shading was replaced with a cheap opaque
material to preserve depth occlusion. Alternating order reduces ordering bias.
Each draw ends in a one-pixel readback, so timings include completion overhead.

| Work | Approximate extra draw time per frame |
| --- | --- |
| Aurora in the close northern demonstration view | 12.8 ms (21.9 ms with it, 9.1 ms without) |
| Atmospheric scattering | 2.2–3.4 ms |
| Earth surface lighting, textures and cloud shadows | 1.8–2.7 ms |
| Elevated cloud shading | 1.0–2.4 ms |
| Solar bloom when the Sun is visible | up to 2.1 ms |
| Star field and Milky Way | small, view-dependent; roughly 0.1–1.3 ms |

Repeating the check with verified live Earth data gave approximately 2.5–3.4 ms
for atmosphere, 0.6–2.1 ms for clouds, 1.0–2.5 ms for surface shading, and again
12.8 ms for the close-up aurora. The ranking is consistent with the bundled run.

These are indicative differences, not independent percentages to add together.
Inactive-layer differences sometimes fall within timing noise. Quiet aurora or
other camera positions need not have the demonstration's cost. Higher resolution
and more displayed frames increase sustained work. Network feeds refresh
intermittently; they are not the continuous per-pixel work responsible for these
measurements. This does not measure the user's hardware power or fan speed.

## Production failure and correction

The 2026-09-10 health artifact from run 34469877419 reports currentness failures
for day and terminator after the client's 300-second activation deadline. The
night view reached live data. No JavaScript/page errors were recorded; delivery
was available and within freshness policy. These failures predate PR #41.

The screenshot job runs on a machine without a hardware graphics accelerator.
Locally reproducing software rendering with SwiftShader at its 1600 × 1000
viewport took 28.5 seconds to activate fallback plus live data in the terminator
view. Pacing loading redraws at 4 Hz reduced this to 22.7 seconds against the
same live bundle; initial fallback display fell from 8.3 to 3.6 seconds. This is
a local comparison, not a measurement of the GitHub runner's exact bottleneck.

The smoke browser now batches all animation-frame subscribers at 4 Hz while
loading, preserving cancellation and their shared timestamps. It removes the
cadence limit before the screenshot. The application, its rendering resolution,
shaders, live-data validation, and activation deadline remain unchanged by this
fix. A real failed activation still fails the health check; no failure is waived.

Each view's report now includes renderer identity, output dimensions, readiness
time, last completed resource-fetch time, and the activation budget. The optional
`--software-rendering true` flag reproduces the headless software path locally.
The production site never installs this capture scheduler.

```sh
node scripts/measure-render-layers.mjs --live
npm run smoke:production -- --app-url http://127.0.0.1:5187/ --software-rendering true --output artifacts/production-render-diagnostics/local-smoke
node --test test/capture-frame-pacing.test.js test/production-visual-smoke.test.js
```

The app URL must be built/configured against the real production latest pointer.
A passing capture requires all three views to expose a verified remote bundle;
rendering only the packaged fallback is never a successful production check.
