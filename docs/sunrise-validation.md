# Sunrise validation — 2026-09-05

## Conclusion and scope

The blue upper atmosphere before direct solar emergence is supported by the
independent calculation and by the actual renderer. The sampled lower paths are
red-dominant. This validates the mechanism within a uniform, spherical,
straight-ray RGB atmosphere; it does **not** certify exact real-world color,
brightness, refraction, or apparent sunrise timing.

The supplied screenshot was used as visual context. It contains an already
visible Sun and lacks verified camera/exposure metadata. It cannot establish a
pre-emergence sequence or be treated as a radiometric target. NASA imagery also
requires care: some reference images are contrast enhanced. See the
[primary-source audit](sunrise-scientific-sources.md).

## Method and results

`scripts/sunrise-reference.mjs` is an independent double-precision midpoint
integrator. It imports physical coefficients only; it does not use the runtime's
optical-depth functions, lookup tables, ray-march spacing or transmittance ratios.
It separately integrates the observer path and each sample's solar path.
The main reference uses 2048 view steps and 512 solar-path steps. Three cases
were repeated at 4096/1024 to check convergence.

`scripts/validate-sunrise.mjs` injects test hooks into the local Vite entrypoint.
It renders actual atmospheric material into a one-pixel float target along each
specified ray. It separately measures single scattering and the complete shader,
then captures native-resolution images through the normal display pipeline.
Test hooks do not ship in the application.

| Check | Observed result | Limit of the claim |
| --- | --- | --- |
| 48 single-scattering rays: 6 tangent heights × 4 solar clearances × 2 camera distances | Maximum normalized channel error **1.45%** after correction; below the chosen 2% threshold | Agreement with the same model's independent integration, not measured atmospheric accuracy |
| Distant observer, 7 Earth radii from center | Maximum error 1.443%; mean 0.810% | Heights 1, 5, 10, 20, 40, 60 km; solar center −0.6°, −0.3°, 0°, +0.3° relative to geometric solid limb |
| ISS altitude, 408 km | Maximum error 1.439%; mean 0.812% | Same sampled heights and clearances |
| 8 tangent-path transmissions compared with 4096-step integration | Maximum absolute difference **0.433 percentage points** | Heights 0.01, 2, 5, 10, 20, 30, 40, 60 km; chosen threshold 1 percentage point |
| CPU convergence on 3 selected rays | Less than 0.001% change when doubling both resolutions | Evidence of convergence on these cases only |
| Finite solar disc cross-check | 37 equal-area ray samples preserve upper-blue/lower-warm behavior in 3 selected cases | Approximation check, not a converged full spectral solar-disc calculation |
| Partial/total occultation browser check | Zero direct solar signal through solid Earth; zero solar flux at total coverage | Geometric occultation; refraction is omitted |
| Standard daylight and terminator captures | No shader or console errors | Visual regression coverage, not a radiometric reference |

The normalized error denominator is `max(reference, 1e-5)` model radiance so
near-black channels do not generate meaningless huge relative errors. Raw channel
values, including the tiny ones, are retained in `report.json`.

The 96-step GPU comparison has mean error around 0.27%, but local extrema do not
necessarily improve monotonically: lookup-table interpolation and numerical
integration can partially cancel one another. It is not a substitute for the
independent CPU reference.

The pre-emergence screenshots use an ephemeris-driven Sun and controlled observer
positions at a fixed date, not simulated elapsed seconds. The two negative
clearances hide the complete geometric solar disc. Scattering remains visible
without direct-Sun bloom. At a 1000-pixel Earth diameter, a 20–40 km layer occupies
1.60–3.21 pixels at the distant viewpoint. The layer has a continuous density
profile, not a hard upper edge.

## Corrections made

1. **Grazing-ray classification.** A missed sphere intersection returned a
   reversed sentinel interval `(1e5, -1e5)`. Checking only whether its start was
   positive wrongly classified every missed ground intersection as a surface
   hit. The shader now requires a valid ordered interval.
2. **Observer-path precision.** Dividing very small half-float transmittances
   can underflow and extinguish blue incorrectly. Because the camera stays above
   the atmospheric boundary, transmission to a sample equals its outward
   transmission toward the observer by reciprocity. A direct lookup replaces
   the ratio in the shell shader and avoids that loss of precision.
3. **Limb sampling.** Twelve steps were 3–5% dimmer than the reference on many
   sampled limb rays (maximum 5.4%). The narrow outer arc now receives 24 steps;
   surface-intersecting rays keep 12. Updated maximum error is under 1.5% in
   the sampled cases. No arbitrary arc brightness multiplier was added.
4. **Classroom disclosure.** “About this view,” inside the existing menu,
   explains that this is a scientific illustration with adjusted brightness and
   that atmospheric refraction is not included.

## What remains unvalidated or deliberately illustrative

- Exact color: the model uses three RGB channels, not full spectral integration
  and CIE color matching.
- Multiple scattering: the actual screenshots include the existing approximate
  multiple-scattering LUT. Only single scattering received the independent
  radiative-transfer comparison. The reference audit identifies authored
  spectral/path-tracing implementations for a stronger future comparison.
- Refraction: no curved rays, apparent horizon displacement, or solar flattening.
- The real atmosphere at a specific place/time: profiles are globally uniform;
  contemporary cloud textures do not make aerosol/ozone/temperature profiles live.
- Absolute exposure: solar radiance is compressed for display; stars, city lights,
  and clouds have separate readability adjustments. This is neither a calibrated
  single exposure nor a prediction of the naked-eye view.
- Atmospheric cloud-shadow interactions, terrain/oblateness near the occulting
  limb, and native Tauri presentation have not been independently validated here.

For a class, explain: **Sunlight can illuminate air above Earth's edge while Earth
still hides the Sun from the observer. That air scatters light toward us. The
visualization models this process, with simplified atmospheric conditions and
brightness adjusted to make features visible.** Teach exact apparent sunrise
shape/timing from a refraction-aware model or observations instead.

## Reproduce and inspect

```sh
npm run dev -- --host 127.0.0.1 --port 5184
node scripts/validate-sunrise.mjs
node scripts/check-solar-render.mjs artifacts/sunrise-validation/solar-controls
npm test
npm run build
# Optional visual report, with matplotlib available:
python3 scripts/build-sunrise-report.py
```

`APP_URL` can point the two browser checks at another local Vite port. These
browser checks need the unbundled Vite entrypoint, not a production minified build.
`validate-sunrise.mjs` accepts an output directory as its first argument. It
retains fresh results and an explicit check verdict even if final assertions fail.

The visual report is `artifacts/sunrise-validation/index.html`; raw evidence is
alongside it. Captures use packaged fallback textures for repeatability. They do
not test current-feed freshness. There are **385 passing unit tests** and the
production build passes, with the existing Vite bundle-size advisory. Publication
is tracked separately by the **TheMarble site** deployment workflow.
