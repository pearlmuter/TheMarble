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
(Bruneton values, per `docs/atmospheric-lighting-research.md`). The problem is that the
atmosphere integral is **under-resolved** and then only **half-applied**:

1. `src/main.ts` marched the atmosphere in **10 uniform steps** against a Rayleigh scale
   height of `0.001258`. At the limb the chord is ~0.28, so each step spanned ~22 scale
   heights. The bottom of the atmosphere — which holds nearly all the optical mass — fell
   between samples.
2. The surface shader received **extinction only** (`sunlight=exp(-vec3(.04,.07,.15)*airMass)`).
   Extinction darkens and reddens. Aerial perspective is extinction **plus** in-scattered
   airlight, and airlight dominates at high airmass. Half the equation was present.
3. The magenta limb was a sampling artefact, not physics: ozone (`BETA_O3`, green-absorbing
   Chappuis band) sits in a *broad* 33 km triangular profile that 10 samples resolve fine,
   while the *sharp* Rayleigh exponential that would put the blue back was missed. Green
   killed, blue not replenished → magenta.
4. The two hand-tuned fudges — `radiance*vec3(13.0,13.0,10.0)` and the synthetic
   `exposedLimb` envelope — existed to compensate for #1. They must be removed **as** #1 is
   fixed, not before and not after.

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
- [x] **1 — Transmittance LUT.** Build it; use it for sun-path and view-path transmittance in the shell. Delete the inner 5-sample loop. No visual retuning yet.
- [x] **2 — Importance-sampled march.** Closest-approach distribution, raised sample count. Expect the limb to broaden and go blue, and the magenta to disappear.
- [x] **3 — Multiple scattering LUT.** Remove `vec3(13,13,10)` and `exposedLimb`.
- [x] **4 — Surface coupling.** Sun transmittance and sky irradiance from the LUTs, replacing `exp(-vec3(.04,.07,.15)*airMass)`. View-path extinction on the surface. True cosine falloff replacing the saturating smoothstep.
- [x] **5 — Ocean.** Keep bathymetry from the day map; sky-reflection floor at all view angles; keep the existing GGX glint.
- [x] **6 — Clouds.** Relief/self-shadowing from the optical-depth gradient; stronger cast shadows; clouds lit through the same solar transmittance.
- [x] **7 — Tone.** Re-examine exposure and the ACES toe now that the airlight floor exists.
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

- **2026-09-04** — Stage 0. Branch cut from `bd3056c`, plan written, capture harness added, baseline captured.
