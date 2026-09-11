# Aurora physics approximation

Replace the geographic sine stripes with a phenomenological aurora that follows
magnetic geometry, evolves on plausible spatial/time scales, and integrates an
emission proxy in physical units. Retain forecast/demo/off, timestamp gating,
Earth occlusion, public forecast refresh, demo disclosure and zoom 5.35.

## Model and evidence

- Use the degree-one IGRF-14 coefficients and 2025–2030 secular variation to
  compute a centred dipole. This approximates near-Earth field orientation and
  strength; it is not the complete IGRF or a storm-time magnetosphere. Use the
  dipole invariant r/cos²(magnetic latitude) to map emitting points to a 110 km
  reference shell. Curtains therefore flare along field lines with altitude.
  Magnetic local time follows the actual Sun direction in the Earth-fixed frame.
  Source: https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt
- Estimate energy flux Q=max(0,(P−10)/8) mW/m² from the published OVATION
  probability relation P=10+8Q. This inversion is approximate: smoothing,
  clipping, rounding and the 100% ceiling destroyed information. Zero below
  10% does not establish absence of faint aurora, and saturation is a lower
  bound, not an upper physical limit. The demo amplifies probability before this
  conversion and is not current or historical measured luminosity.
  Source: https://repository.library.noaa.gov/view/noaa/15196/noaa_15196_DS1.pdf
- Use an approximate 557.7 nm green yield of 1.23 kR per mW/m², representative
  of roughly 3 keV precipitation; this is not a measured electron spectrum.
  Source: https://doi.org/10.1029/2011JA017094
- Approximate the emitting volume with three finite, uniform-density layers. Convert
  kR to radiance with 10¹³ photons/(m² s), hc/λ and 1/(4π), then to photopic
  luminance. A 1 kR 557.7 nm column is about 0.00019 cd/m². No extra inverse-square
  dimming of a resolved emitting surface. The model's green profile peaks at 130 km, red higher;
  prompt blue/violet remains restrained. Altitude widths and line ratios are
  representative, not solved chemistry or measured profiles. The assumed red
  and nitrogen yields are 0.08 and 0.12 kR/(mW/m²), respectively; their
  uncertainty and dependence on electron energy are not inferred from the feed.
  Sources: https://science.nasa.gov/sun/auroras/ and
  https://ntrs.nasa.gov/api/citations/19680020298/downloads/19680020298.pdf
- Fine structure remains stochastic, with local curved arcs, diffuse emission,
  patchy brightening and multiple scales. Azimuthal drift follows an illustrative 25 mV/m
  electric field divided by local dipole strength (E/B), using an exact angular
  backtrace rather than a growing Euler displacement. This supplies a
  plausible velocity scale; E and its azimuthal drift direction are assumed, not measured. Earth’s field does not
  itself supply the aurora’s energy. NOAA already incorporates solar-wind forcing.
- The emission generator retains a 0.7 s green response and a more diffuse red component
  with a representative 30 s effective response (radiative lifetime shortened
  by collisional losses). Nitrogen is prompt. No arbitrary animation time wrapping.
  With minute snapshots these are coarse history weights, not resolved second-scale dynamics.
  Green lifetime context: https://pwg.gsfc.nasa.gov/Education/aurora.htm
- Display exposure is explicitly a night-view rendering choice, separate from
  the physical-unit emission proxy. The rest of TheMarble is not a calibrated
  radiometric camera. Daylight contrast suppression remains an approximation.

## Simpler display — September 2026

The requested display updates its emission texture once per 60 simulation seconds.
At normal speed that means once a minute; debug 20× playback refreshes every three
seconds. New forecast objects, gain changes, re-enabling and time rewinds refresh
immediately. Camera projection and daylight contrast update every displayed frame.
The magnetic texture basis is cached with the texture to avoid coordinate drift.
Source polling remains every five minutes. This deliberately omits rapid auroral
motion; it must not be presented as a real-time reconstruction of observed curtains.

The previous renderer took 64 samples per pixel through the volume. The replacement
uses exact intersections with three finite spherical layers, at most six emission
lookups per pixel. The green layer is centred at 130 km, red at 260 km and
blue/violet at 108 km. Thickness is sqrt(12) times each previous Gaussian's standard
deviation (17, 60 and 8 km), preserving column energy and vertical variance.
Chord length produces finite limb brightening. Ground intersections block far-side
light, while magnetic field-line mapping and atmospheric transmission remain.

Uniform layers approximate the altitude profile; they do not reproduce a Gaussian's
soft tails or finely resolved curtain depth. Long oblique paths use midpoint samples
and therefore approximate variations along the path. The display is intended for
orbital globe views. Brightness remains an uncertain forecast-derived proxy with
chosen exposure, not calibrated observed luminosity. Source or gain changes reset
history immediately; regular minute updates retain coarse exponential history.

## Validation

Unit checks cover magnetic geometry, field strength, flux/luminance conversion,
forecast state, ground occlusion and the emission generator's response. New checks
verify minute cadence, time rewinds, each finite layer's vertical normalization and
variance, finite tangent brightening and rays missing the emitting layer.

Run `node scripts/verify-simple-aurora.mjs 4f3b2d7b4d3a1266366e6b2783f67ffaceed8a74`
against the local Vite server on port 5186. It compares the old and new shaders on
identical cached emission, captures close/globe/limb views in both hemispheres,
checks WebGL errors and counts actual emission draws across minute boundaries and
mode/source changes. It also alternates synchronized full-scene timing samples.
At 1000 × 800 CSS pixels and DPR 2 on Apple M1 Max, close polar views fell from
roughly 13 ms to 6 ms per complete scene draw. This is a local rendering measurement,
not a promise about battery life, fan behaviour or other GPUs. The simplification
leaves Earth textures and output resolution unchanged.
