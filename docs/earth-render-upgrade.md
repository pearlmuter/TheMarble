# Earth render upgrade — working plan

**Status: complete on `feat/earth-render-upgrade`.** This file is the source of truth for the work. It is written so
that a fresh session (or a different person) can pick it up cold. Update the checkboxes and
the "Session log" as stages land.

- Branch: `feat/earth-render-upgrade` (branched from `main` at `bd3056c`)
- Baseline captures: `artifacts/render-baseline/` (gitignored — regenerate with the capture script)
- Capture harness: `scripts/capture-render-scenes.mjs`
- Revert anything: every stage is one commit; `git revert <sha>` or `git reset --hard bd3056c` for all of it.

## Why

A side-by-side against the Apollo 17 "Blue Marble" (AS17-148-22727) showed the render reading
as a *sticker on black* rather than a body with air on it. Specifically:

- Oceans near-black instead of a lit navy.
- Land **more** saturated toward the limb, where it should go pale and blue-grey.
- A thin, hard limb ring with a magenta fringe instead of a broad blue halo.
- Flat, decal-like clouds with no relief.

The root cause is not missing physics. The physics is present and its constants are right
(Bruneton values, per `docs/atmospheric-lighting-research.md`). What is wrong is how the
integral is evaluated and how little of it reaches the surface.

**Corrected during stage 1.** The first diagnosis blamed the ten-step uniform outer march for
starving the limb. Measurement says otherwise: on a tangent chord that march is accurate to
within 0.1%, because tangent geometry stretches the density profile along the ray to a width of
`sqrt(R*H)` ≈ 0.035 rather than the 0.00126 scale height, and ten samples resolve that fine.
The real defects, measured, are:

1. **The inner Sun march undercounted by a third.** Five uniform samples over the whole path to
   the top of the atmosphere put the first sample 1.6 scale heights up, recovering only 68% of
   the vertical column. Too little optical depth means too much transmittance.
2. **The visible halo was not the physics at all.** It was `exposedLimb`, a synthetic envelope
   with a 33.6 km e-fold. At this disc size 33.6 km is under two pixels, which is exactly the
   3-pixel hard ring the harness measures. The real scattering underneath it was being scaled
   by a hand-tuned `vec3(13.0,13.0,10.0)` that also reddens.
3. **No multiple scattering.** Single scattering alone leaves a limb too dim to look right,
   which is why the two fudges above had to exist. Removing them without adding multiple
   scattering would just make it dim.
4. **The surface receives extinction but no airlight.** `sunlight=exp(-vec3(.04,.07,.15)*airMass)`
   only darkens and reddens. Aerial perspective is extinction **plus** in-scattered airlight,
   and airlight dominates at high airmass. This is the biggest one for the ocean.
5. **Ozone is resolved while the blue that should balance it is not.** Ozone (`BETA_OZONE`,
   green-absorbing Chappuis) sits in a broad 30 km tent that any march resolves; combined with
   the transmittance error above, green is removed more reliably than blue is replaced, which
   is the magenta cast on the limb.

A ground-hitting ray is the case where marching matters, and there the old uniform march
undercounts by about 10%. The importance-sampled march lands within 2%.

### The finding that turned out to matter most

**The colour pipeline was open.** `renderer.toneMapping = ACESFilmicToneMapping` and
`renderer.outputColorSpace = SRGBColorSpace` had no effect on anything in this scene. three
only *supplies* `toneMapping()` and `linearToOutputTexel()` (see `three.module.js:20084`); a
custom `ShaderMaterial` has to call them via `#include <tonemapping_fragment>` and
`#include <colorspace_fragment>`, and not one of the Earth, cloud, atmosphere, Moon, Sun, star
or Milky Way shaders did. Their linear radiance went straight to an sRGB display.

Displaying linear light as though it were already sRGB darkens the midtones and stretches
contrast. That single fact accounts for most of the Apollo comparison: the ocean reading as
space, the land looking lacquered, the crushed shadows — and for why nearly every term in these
shaders carried a hand-tuned multiplier (`*1.22`, `*1.32`, `vec3(13,13,10)`) clawing brightness
back.

The fix is not per-shader includes, because additive layers must be summed in linear light and
encoded **once**: the atmosphere over the ocean, the corona over the sky, stars over the Milky
Way. Encoding each layer separately and adding the results in display space is a different sum.
So the scene now renders into a half-float target and one composite pass applies the curve.

Measured effect on the daylight scene, with no other change: deep-ocean sRGB 18,25,36 →
48,72,98, and land saturation 0.36 → 0.14. The physics had already been made correct; it simply
could not be seen.

Also, independently of the atmosphere:

5. The ocean threw away all bathymetry: `day=mix(land,oceanLight,ocean)` replaced every ocean
   pixel with a single constant `deepWater`, discarding the shelf colour the Blue Marble day
   map already contains.
6. The ocean had no sky reflection at nadir — `atmosphericReflection` was gated entirely on
   `horizonFresnel=pow(1-nDotV,5)`, which is ~0 anywhere but the extreme limb.
7. `directLight=.055+1.32*smoothstep(-.015,.72,solar)` saturates at 44° from the subsolar
   point, so the whole middle of the disk is flat-lit. That is not a cosine.
8. The surface texture is **Blue Marble Next Generation**, which is an atmospherically
   *corrected* surface-reflectance product. The atmosphere has already been removed from it.
   Lighting it directly, with no atmosphere put back, is precisely the over-saturated look.

## Architecture

Replace the hand-rolled march with a Hillaire-style LUT atmosphere. Two lookup textures,
built once at startup into float render targets:

| LUT | Size | Contents |
| --- | --- | --- |
| Transmittance | 256×64 | `T(r, mu)` — transmittance from a point at radius `r` to the top of atmosphere along a ray with zenith cosine `mu`. Built with 40 analytic steps. |
| Multiple scattering | 32×32 | `Psi(r, mu_sun)` — isotropic multiple-scattering factor. Built by integrating over a sphere of directions. |

Parametrisation is Hillaire's (`H = sqrt(Rtop^2-Rg^2)`, `rho = sqrt(r^2-Rg^2)`, `xR = rho/H`,
`xMu = (d-dMin)/(dMax-dMin)`), which is standard and well tested.

This buys three things at once:

- The inner 5-sample sun march becomes **one texture fetch**, so the outer march can afford
  far more samples at the same or lower cost.
- Camera-side transmittance also becomes a fetch, via `T(a→b) = T(a→TOA)/T(b→TOA)`.
- Multiple scattering becomes real, which is what makes a limb read soft and bright. The
  `vec3(13,13,10)` and `exposedLimb` fudges can then be deleted rather than retuned.

**Key insight that makes the surface coupling nearly free:** the atmosphere shell already
marches the camera→ground segment for pixels over the disk (`farDistance` is clamped to the
ground hit) and adds it. So fixing the shell's integration delivers correct airlight over the
ocean and correct aerial perspective toward the limb **for free** — no second march in the
surface shader. The surface shader only needs single LUT fetches for view-path extinction,
sun-path transmittance, and sky irradiance.

### Sampling

Importance-sample the outer march around the point of closest approach, which is the minimum
altitude on the segment in both cases (ground-hit rays: at the ground end; limb rays: at the
tangent point). Clamp `tc = clamp(-dot(o,d), t0, t1)`, split the sample budget between
`[t0,tc]` and `[tc,t1]` proportional to length, and within each half distribute with a power
curve concentrating toward `tc`. Quadrature uses segment boundaries so `ds` stays exact.

## Stages

Each stage is one commit, independently revertible, with `npm test` green before it lands.

- [x] **0 — Scaffolding.** Branch, this plan, `scripts/capture-render-scenes.mjs`, baseline captures.
- [x] **1 — Transmittance LUT.** Physics module, CPU mirrors, tests. Landed as `7ef70bf`; not yet consumed by main.ts.
- [x] **1b — Wire the shell to the LUT** and to the importance-sampled march, deleting the inner Sun loop, `vec3(13,13,10)` and `exposedLimb`.
- [x] **2 — Importance-sampled march.** Closest-approach distribution, raised sample count. Expect the limb to broaden and go blue, and the magenta to disappear.
- [x] **1c — Close the colour pipeline.** HDR target plus one composite pass; sky exposure re-solved against the golden scenes.
- [x] **3 — Multiple scattering LUT.** Remove `vec3(13,13,10)` and `exposedLimb`.
- [x] **4 — Surface coupling.** Sun transmittance and sky irradiance from the LUTs, replacing `exp(-vec3(.04,.07,.15)*airMass)`. View-path extinction on the surface. True cosine falloff replacing the saturating smoothstep.
- [x] **5 — Ocean.** Sky-reflection floor at all view angles landed with stage 4. **The bathymetry half of this item was wrong and was dropped:** the packaged Blue Marble carries no usable bathymetry. Its deep ocean is one flat value (linear 0.0011, 0.0017, 0.007) in the Atlantic, the Pacific, the Red Sea and over the Sahul and Great Barrier shelves alike; only the Bahamas bank differs, and the water classifier already routes that to the land path where its colour survives. There was nothing being discarded to restore.
- [x] **6 — Clouds.** Relief/self-shadowing from the optical-depth gradient; stronger cast shadows; clouds lit through the same solar transmittance.
- [x] **7 — Tone.** Re-examined and **left alone**. Closing the colour pipeline was the tone fix: clipping on the daylight scene fell from 1.09% of the frame to 0.13% while the disc got brighter, because ACES now rolls the highlights off instead of the shader clamping them. Changing exposure on top of that would have been taste applied to a curve that had only just started working.
- [x] **8 — Tests and docs.** Update `test/earth-surface-render-contract.test.js`, add invariants for the new physics, refresh golden scenes.

## Verification

Run at every stage:

```bash
npm test                                        # node --test test/*.test.js
npx tsc --noEmit                                # type check
node scripts/capture-render-scenes.mjs --out artifacts/render-<stage>
```

The capture script drives the existing `?golden=<scene>` deterministic camera poses from
`src/orbital-golden-scenes.js` against a local vite server, so captures are comparable across
stages. `daylight` is the primary scene for this work; `terminator` and `sunrise-limb` guard
against regressions at low sun angle; `crescent-earth` guards the night side.

The script also prints mean linear RGB for the ocean, land and space regions of `daylight`,
which is the quantitative check that matters here — "ocean is no longer black" is a number,
not an opinion. It **exits non-zero on any console error**: a shader that fails to compile still
renders a picture, just one missing whatever that shader contributed, and measurements alone will
not say so. That happened once during this work — a renamed GLSL helper silently emptied the
multiple-scattering table — which is also why `test/atmosphere-model.test.js` resolves every
atmosphere function the bake shaders call against the shared GLSL, without needing a GPU.

### Outcome

Daylight scene, baseline → final:

| Measure | Baseline | Final | Target |
| --- | --- | --- | --- |
| Deep-ocean sRGB | 32,53,74 | 55,82,121 | a lit navy, not space |
| Sahara sRGB | 217,161,119 | 196,171,157 | pale and hazy |
| Sahara saturation | 0.45 | 0.20 | falls |
| Land saturation centre→limb | rises | falls | aerial perspective |
| Limb hue | magenta-tinted | blue | ozone tints twilight, not the day limb |
| Frame clipped to white | 1.09% | 0.13% | highlights roll off |
| Tangent halo (`sunrise-limb`) | 3 px | 22 px | broad decay |

**On the remaining gap to Apollo.** The Sahara now measures saturation 0.20 against roughly 0.31
in AS17-148-22727. That gap is not a defect to chase. Apollo was shot on Ektachrome, which is
warm and high-saturation; a calibrated instrument looking at the same desert through the same air
— DSCOVR EPIC, say — sees it pale, and that is where the render now sits. The sky-irradiance
table was checked against published atmospheric ratios rather than against the photograph: 4.7%
diffuse fraction at zenith Sun from single scattering (about 10% once multiple scattering is
included, which is the clear-sky value), rising to 44% at 85°. If the Apollo *look* is wanted, it
is a grading choice and belongs in one place, not spread back through the physics.

**Known approximation.** `GROUND_ALBEDO` is a single planetary mean, because the
multiple-scattering table is indexed only by altitude and Sun angle and cannot know whether ocean
or desert lies beneath. Airlight over bright desert is therefore slightly bluer than it should be,
and over open ocean slightly brighter. Fixing it properly means carrying surface reflectance into
the scattering term at render time, as Bruneton's `GetSkyRadianceToPoint` does.

### Acceptance targets (daylight scene)

| Measure | Baseline | Target | Rationale |
| --- | --- | --- | --- |
| Deep-ocean sRGB | ~(12,26,38) | ~(28,52,84) | Apollo's Indian Ocean is a lit navy, not space. |
| Limb halo width | ~4 px | 15–30 px | Broad decay, not a ring. |
| Limb hue | magenta-tinted | blue | Ozone should tint twilight, not the day limb. |
| Land saturation toward limb | rises | falls | Aerial perspective. |
| Space background | (0,0,0) | (0,0,0) | Must not drift; a lifted background means airlight is leaking. |

## Exercising the paths no data has reached

Three branches this work touched had never executed anywhere. The bundled offline state carries
only `surfaceAlbedo`, `nightLights`, `cloudOpacity` and `cloudDensity`; production adds real
GMGSI cloud but still no `cloudPhysics`, `snowCover` or `seaIce`, and the clouds workflow runs
the feed with no cloud catalog so it always takes the GMGSI path. Every published state has said
"Cloud thickness · assumed".

`scripts/preview_satcorps_fixture.py` synthesises a SatCORPS granule so the real compositor,
manifest builder and publisher can run end to end, and `preview-live-earth-state.mjs` gained a
`--satcorps-fixture` flag beside the cryosphere one:

```bash
npm run preview:live -- --cryosphere-fixture true --satcorps-fixture true \
  --python "$PWD/.venv-integration/bin/python" --port 5184
node scripts/capture-render-scenes.mjs --url http://localhost:5184/index.html --out artifacts/render-physical
```

The SatCORPS soak gate is satisfied rather than bypassed: a history is generated and the report
derived from it with the same function the gate re-derives it with, so it stays a real check of
whether the samples support promotion.

**Established.** The retrieved cloud-physics path runs — clouds provider `satcorps`, no console
errors, no NaN, no blown highlights — and the relief shading demonstrably responds to retrieved
cloud-top heights. `snowCover` and `seaIce` both publish and render, and neither `snowAlbedo` nor
`seaIceLight` blows out under the new irradiance basis; both got dimmer, not brighter.

**Not established.** How any of it will *look* against real SatCORPS data. The fixture is a
synthetic field, and two attempts to make it realistic showed how easy it is to fool yourself
here: the first was smooth at continental scale, so its cloud-top steps came out at 36 m — below
the 78 m the compositor's 8-bit height channel can even represent — and rendered perfectly flat
blobs. The second overcorrected into solid zonal belts. Its purpose is to exercise code, not to
be a picture; do not read it as a preview of the feature.

**Found, and worth checking when real retrievals arrive.** The cloud mesh is displaced per-vertex
on a 192x192 sphere while the height field is 4096x2048. With a constant 11 km assumed height
that is invisible. With retrieved heights spanning 0-20 km it produces visible ledges at sharp
height discontinuities, because the geometry cannot represent the field's detail. Mitigations, in
increasing cost: smooth the displacement, raise the mesh density, or stop displacing geometry and
carry the height as parallax in the fragment shader.

## What it cost, and getting it back

The upgrade was reported making a laptop hot. It was: measured headlessly at a resolution high
enough to be GPU-bound rather than vsync-capped, a frame went from **11 ms before the upgrade to
24.2 ms after**. Two things were responsible, and neither was the physics.

| Change | Frame at 3200x2000 on a 2x display |
| --- | ---: |
| Before the upgrade (`bd3056c`) | 11.0 ms |
| As first shipped | 24.2 ms |
| Hoisting the constant transmittance out of the march | 23.8 ms |
| Dropping 4x MSAA on the half-float target | 14.0 ms |
| Twelve march steps instead of thirty-two | **14.7 ms** |

**Multisampling was the larger half, and it was buying nothing.** Carrying the canvas's
antialiasing over to the new half-float target looked like the obvious thing to do when the
scene stopped being drawn to the canvas. But multisampling a full-screen float target is
expensive, and against captures it produced an image indistinguishable from none — at the
Earth's limb *and* at the Moon's. The reason is the upgrade itself: the atmosphere shell now
draws a soft gradient over the silhouette that used to be a hard edge, so the thing that needed
antialiasing stopped being one.

**The step count was never the problem, which is the third correction to the original
diagnosis.** Twelve importance-sampled steps match thirty-two to within 0.16 of an sRGB level on
average, with 0.04% of pixels differing by more than two. Thirty-two was three times the cost of
ten for no visible return. What mattered was always where the samples go, not how many there
are — the very thing this module was written to fix, applied to itself a step too late.

All eight golden scenes were re-diffed after the optimisation: mean difference below 0.16 of a
level, fewer than 0.15% of pixels differing by more than three, with the isolated maxima at hard
edges where multisampling used to blend.

Roughly a third of the remaining increase over baseline is the physics that was added — multiple
scattering, sky irradiance, aerial perspective, cloud relief — and that part is real work for a
real return.

## Session log

- **2026-09-04** — Recovered two thirds of the frame-cost regression the upgrade introduced; see above. Golden scenes regenerated.
- **2026-09-04** — Exercised the retrieved-physics and cryosphere paths behind fixtures; see above. Merged as #22 and deployed.
- **2026-09-04** — Stages 5, 6, 7, 8. Golden scenes in `docs/golden-scenes/` regenerated against the new render; the checks each one guards are unchanged.
- **2026-09-04** — Stages 3, 4, and the night-lights wash fix.
- **2026-09-04** — Stages 1, 1b, 1c, 2. The colour pipeline was the dominant defect; see above. Sky exposure corrections (`0.27` Milky Way, `0.11` stars) were solved against `docs/golden-scenes/`, not guessed.
- **2026-09-04** — Stage 0. Branch cut from `bd3056c`, plan written, capture harness added, baseline captured.
