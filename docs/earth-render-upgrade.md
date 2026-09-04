# Earth render upgrade — working plan

**Status: in progress.** This file is the source of truth for the work. It is written so
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
- [ ] **7 — Tone.** Re-examine exposure and the ACES toe now that the airlight floor exists.
- [ ] **8 — Tests and docs.** Update `test/earth-surface-render-contract.test.js`, add invariants for the new physics, refresh golden scenes.

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
not an opinion.

### Acceptance targets (daylight scene)

| Measure | Baseline | Target | Rationale |
| --- | --- | --- | --- |
| Deep-ocean sRGB | ~(12,26,38) | ~(28,52,84) | Apollo's Indian Ocean is a lit navy, not space. |
| Limb halo width | ~4 px | 15–30 px | Broad decay, not a ring. |
| Limb hue | magenta-tinted | blue | Ozone should tint twilight, not the day limb. |
| Land saturation toward limb | rises | falls | Aerial perspective. |
| Space background | (0,0,0) | (0,0,0) | Must not drift; a lifted background means airlight is leaking. |

## Session log

- **2026-09-04** — Stages 1, 1b, 1c, 2. The colour pipeline was the dominant defect; see above. Sky exposure corrections (`0.27` Milky Way, `0.11` stars) were solved against `docs/golden-scenes/`, not guessed.
- **2026-09-04** — Stage 0. Branch cut from `bd3056c`, plan written, capture harness added, baseline captured.
