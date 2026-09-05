# Sun, sunrise, and following a place — 2026-09-05

## What changed

The partially covered Sun looked like a lamp painted across Earth. The photosphere
already rejected rays through the solid Earth, but the corona and diffraction
sprites disabled depth testing. Their opacity followed the total visible fraction
of the Sun while their bright centers still covered the hidden part of the disc.
The browser regression reproduced 0.6997 linear HDR intensity inside Earth's
silhouette with only the solar contributors enabled.

The new rendering removes those sprites and the decorative flare ghosts. A
white, physically sized photosphere supplies HDR light. Earth and Moon block its
rays, and grazing rays use the atmosphere's shared transmittance lookup, including
ozone. The old independent Chapman approximation and 60 km cutoff are gone.
Bloom is derived from the resulting visible pixels before the final tone mapping.
A small optical spill across an edge is expected; a second disc inside Earth is
not. When the Sun is fully covered or outside the view, the bloom pass is skipped.

The atmospheric lighting now includes the Sun's finite angular radius at the
horizon. This softens the onset of direct illumination as the disc rises instead
of switching the whole source on at its center. The horizon approximation follows
[Bruneton's transmittance implementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html).
The visual reference is the warm lower atmosphere and blue upper layers in
[NASA's orbital sunset photography](https://science.nasa.gov/earth/earth-observatory/sunset-from-the-international-space-station-44267/).

“Follow this place” is a switch inside the existing upper-left disclosure. It is
off initially. When enabled, the current camera position, target, and orientation
are carried by Earth's incremental body rotation. Dragging and zooming update the
view being followed. Disabling the switch releases it at its current position,
without resetting or jumping. No camera control remains visible over the globe
when the menu closes.

## Verification

- `npm test`: 381 tests pass, including full-day camera tracking, release/re-enable,
  a changed place/zoom, and the finite-disc horizon transition.
- `npm run build`: passes; Vite retains its existing large-bundle advisory.
- `node scripts/check-solar-render.mjs artifacts/solar-review/final` against Vite
  on port 5184 (override with `APP_URL`): clear, partial, and fully hidden Sun;
  zero direct solar intensity inside Earth; reduced flux during partial coverage;
  zero solar flux during total coverage; keyboard and mobile menu controls;
  actual camera motion after six simulated hours. No shader or page errors.
- `scripts/capture-render-scenes.mjs`: daylight, terminator, sunrise-limb, and
  solar-occultation all render without console errors.
- Synchronized 30-frame browser measurement at 1200 × 900, device scale 1:
  original 1.86 ms/frame, updated 2.09 ms/frame with the Sun visible. This is a
  local rendering sample, not a mobile or sustained thermal benchmark.

Captures and detailed reports are under `artifacts/solar-review/`. Deterministic
captures use the packaged fallback textures; they do not validate feed freshness.
The data publication, origin, and current-data selection paths are unchanged.

The model remains an RGB real-time approximation: solar radiance and optical
bloom are calibrated for this display exposure, and atmospheric refraction/solar
flattening are not simulated. Native Tauri acceptance has not been run here.


## Classroom validation follow-up

The later [scientific validation](sunrise-validation.md) adds 48 independent
single-scattering comparisons, checks atmospheric transmission and the
pre-emergence sequence, and fixes grazing-ray classification and precision.
The outer arc now uses 24 steps; the menu explains the model's limits under
“About this view.” The current suite has 385 passing tests.
