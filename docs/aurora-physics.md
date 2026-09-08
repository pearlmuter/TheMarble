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
- Integrate normalized altitude profiles through the emitting volume. Convert
  kR to radiance with 10¹³ photons/(m² s), hc/λ and 1/(4π), then to photopic
  luminance. A 1 kR 557.7 nm column is about 0.00019 cd/m². No extra inverse-square
  dimming of a resolved emitting surface. Green peaks near 120 km, red higher;
  prompt blue/violet remains restrained. Altitude widths and line ratios are
  representative, not solved chemistry or measured profiles. The assumed red
  and nitrogen yields are 0.08 and 0.12 kR/(mW/m²), respectively; their
  uncertainty and dependence on electron energy are not inferred from the feed.
  Sources: https://science.nasa.gov/sun/auroras/ and
  https://ntrs.nasa.gov/api/citations/19680020298/downloads/19680020298.pdf
- Fine structure remains stochastic, with local curved arcs, diffuse emission,
  patchy brightening and multiple scales. Drift follows an illustrative 25 mV/m
  convection field divided by local dipole strength (E/B). This supplies a
  plausible velocity scale; E is assumed, not measured. Earth’s field does not
  itself supply the aurora’s energy. NOAA already incorporates solar-wind forcing.
- Integrate green excitation with a 0.7 s response and a more diffuse red component
  with a representative 30 s effective response (radiative lifetime shortened
  by collisional losses). Nitrogen is prompt. No arbitrary animation time wrapping.
  Green lifetime context: https://pwg.gsfc.nasa.gov/Education/aurora.htm
- Display exposure is explicitly a night-view rendering choice, separate from
  the physical-unit emission proxy. The rest of TheMarble is not a calibrated
  radiometric camera. Daylight contrast suppression remains an approximation.

## Acceptance

Verify magnetic pole/field strength, dipole invariant at multiple altitudes and
both hemispheres, radiance conversion, integrated profile normalization,
frame-rate-independent decay, no emitted green column above 1.23 times the inferred flux
from the bounded procedural structure, and existing state/occlusion
checks. Inspect overhead/limb/day, both hemispheres, motion over time, off/on
frame cadence and mobile. Preserve raw source data. Update README and debug
explanation, review, build/test clean committed files, publish and verify live.


### Validation

Independent unit checks cover IGRF pole quadrant, approximately 30/60 µT
surface equatorial/polar field, inverse-cube field strength, E/B velocity scale,
field-line invariant in both hemispheres at 110–450 km, epoch limits, the
probability/flux relation and 1 kR luminance conversion. The normalized vertical
profiles integrate to within 0.5% of unity over 85–500 km; a tangent column
brightens from path length without a painted halo.

An isolated GPU fixture reads actual floating-point emission buffers. With a
uniform 5 mW/m² input, green stays below the 6.15 kR bound. After setting input
to zero, the one-second green/red retention agrees with exp(−1/0.7) and
exp(−1/30), within half-float precision. No shader errors or context loss.

Browser checks include both hemispheres, overhead and limb, daylight, the 20×
time-lapse disclosure, off mode, mobile controls and the retained 5.35 cap.
At the same polar viewpoint on Apple M1 Max/ANGLE Metal, the mean of 120 frame
intervals was 8.33 ms with the model on and 8.33 ms with it off. This measures
displayed cadence on this machine, not GPU execution time or low-end performance.
