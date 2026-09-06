# Polar ice and cloud presentation — 2026-09-05

## Request and acceptance

Improve the pixelated clouds and artificial polar ice in the supplied close-up Europe and Arctic views. Verify the ice near Svalbard. Preserve observed weather patterns, distinguish ice extent from concentration, remove mapping artifacts, improve ice material and the cloud-coverage boundary, and publish after validation. No invented cracks, floes, or polar weather may be presented as observations.

## Plan

1. Freeze a checksum-verified production bundle and capture repeatable Europe/Arctic views. Compare the dated IMS ice product with a separate raw concentration product from MET Norway/OSI SAF.
2. Correct polar reprojection and ensure corrected data actually publishes. Resolve categorical extent versus concentration explicitly in the compositor, metadata, and menu. Use independently dated, quality-screened concentration when available; retain truthful extent fallback.
3. Reduce exaggerated cloud relief and use gentle, resolution-aware reconstruction for magnified textures. Preserve thin cloud and gaps, and keep minification efficient. Investigate source resolution before increasing delivered texture dimensions.
4. Improve ice shading with measured coverage and restrained material response. Soften the observed cloud coverage boundary without fabricating polar observations or changing their provenance.
5. Test data semantics/reprojection at synthetic seams and on real products, inspect synchronized before/after images, run typechecking/build/tests and independent review, then publish the code and regenerate the daily data. Verify the deployed website and data bundle.

## Known constraints

- Production currently uses GMGSI 4096 × 2048 clouds, and IMS 24 km categorical ice/snow reprojected to 4096 × 2048. The daily cryosphere publication predates the already-merged polar-gap fix: shipping the site alone cannot repair that texture.
- Shared R2 site/feed assets must retain the two-writer safety invariants in web-integration.md.
- A concentration map is not a photographic texture. Missing data is distinct from open water. Source timestamps and quality must survive compositing.
- Native Tauri acceptance is separate from browser validation.

## Implementation and evidence

- The first regeneration fixed the pole itself but close inspection exposed coastal streaks from row-wise hole filling. The final implementation upgrades to the native 4 km numerical NetCDF, then samples directly through its declared polar projection and axes. Genuine unknown source cells remain unknown. No latitude-row spreading is used in the production configuration. Its separately supplied latitude/longitude grids confirm the projection after accounting for their opposite row order.
- OSI SAF OSI-401-d v4.1 numerical NetCDF is publicly available from MET Norway's THREDDS server for both hemispheres. Its 10 km grid is read using the file's own CF projection and axes. Packed scale factors are decoded once, then percent becomes fraction. Land/lake/coast/missing/unknown flags and uncertainty over 20 percentage points are excluded. An accepted zero means open water; missing remains NaN.
- Concentration supersedes IMS extent over ocean where accepted, with the original extent retained where concentration is absent. Each concentration source retains its own analysis date; no later day or more-than-one-day-older field can accompany the selected daily analysis. Sources remain within the existing three-day freshness limit.
- A processing revision can replace the same daily analysis once. An older analysis cannot regress the feed. This allows a repaired projection to ship without falsely advancing observation time.
- Cloud relief falls from 34× to 4×. Magnified samples use positive cubic reconstruction blended with ordinary sampling; minified views retain mipmapped sampling. This cannot create finer observations. The 1.5° one-sided latitude coverage feather affects appearance, relief and shadows only; missing polar weather remains undisplayed and explicitly disclosed in the menu.
- GMGSI source documentation describes a 5000 × 3000 grid (roughly 8 km at the equator). Jumping from the current 4096-wide delivered field to 8192 would largely interpolate observations and quadruple texture memory. This release keeps its dimensions and improves reconstruction instead. Higher resolution physical cloud retrievals remain subject to the existing SatCORPS qualification process.
- Ice retains fractional area mixing with ocean, gains a restrained broad reflection and a more neutral diffuse colour. No invented cracks, floes, ridges or weather patterns were added.

References: [NSIDC IMS](https://nsidc.org/data/g02156/versions/1), [MET Norway OSI SAF numerical catalog](https://thredds.met.no/thredds/catalog/osisaf/met.no/ice/conc/2026/09/catalog.html), [MET Norway regional chart documentation](https://api.met.no/weatherapi/icemap/1.0/documentation), and docs/live-earth-data-research.md for the inspected GMGSI grid.

Frozen data and captures live under artifacts/polar-cloud-review (excluded from deployment). Use scripts/check-polar-cloud-render.mjs against the local Vite server with APP_URL to repeat the fixed Earth-relative views. Render-only captures hold all original observations fixed; final captures replace September 4 cryosphere processing with September 4 concentration and corrected IMS while retaining identical clouds. Native Tauri acceptance is not claimed.

The native 4 km NetCDF was checked byte-for-byte against its matching ASCII categories. Sampled coordinates agree with the independent companion grids within 0.0001°. The file's daily nowcast date remains the catalog valid day. The delivered reference time is 20Z on the preceding day despite its 00Z comment; that actual reference time is retained, accepted only within the documented 0–6-hour nowcast window, and not silently rewritten. The four-kilometre grid substantially improves coastlines without adding simulated texture.

## Validation results

- All 389 JavaScript tests and 56 relevant Python tests passed; TypeScript and the production build passed.
- Fixed-camera browser captures for Europe, Arctic, Svalbard and the globe completed with no runtime or shader errors. These are appearance checks, not a performance benchmark.
- Missing pixels in the northernmost five texture rows fell from 96.27% in the frozen production texture to zero. Unknown cells elsewhere retain their missing-data semantics.
- The independent coordinate comparisons had maximum sampled errors of 0.000014° for IMS and 0.000006° for OSI SAF. Axis reversal, valid zero versus missing, hemisphere limits, and malformed axes have regression coverage.
- In the September 4 sample, 81°N 18°E is accepted open water; 82°N 18°E is about 54% concentration. This is a dated observation, not a permanent rule for Svalbard.
- The delivered 4096 × 2048 texture still resolves about 9.8 km per latitude step; the native 4 km source does not imply uniform 4 km display detail. Polar cloud coverage remains incomplete and the feather is an illustrative presentation adjustment.


## Review — Standards

No documented integration violations. The review found a misleading Southern Hemisphere fallback explanation and duplicated coverage-band decisions. The explanation now specifies missing southern **snow**, and rendering/qualification share one coverage helper. Both findings are addressed.

## Review — Spec

The review found that catalog reduction could discard concentration matching a delayed IMS day, and that composite observation bounds omitted contributing dates. Concentration dates now survive until daily selection, with a catalog-to-selection regression. Dataset bounds include all contributing dates and the actual OSI SAF daily observation interval, retained through adapter, catalog and provenance. Both findings are addressed and the full suite passes.

Review totals: Standards 2 judgment calls resolved; Spec 2 correctness findings resolved. Publication remains subject to live deployment verification.

## Publication follow-up — 2026-09-06

PR #33 deployed the website successfully. Daily publication run 33989956576 built the corrected September 5 analysis, but the combined-feed check rejected it because the observation date had not advanced. Upload was skipped, preserving the prior live feed.

The follow-up carries the processing revision on both snow and ice. The combined check records `reprocessed` separately from newer observations, accepting a changed revision only in a new bundle; date regression and incomplete/no-op publication still fail. A full frozen-data orchestration run reproduced same-day replacement successfully, and a repeat left the feed unchanged. All 392 JavaScript tests and the TypeScript/production build pass. No renderer behavior changes in this follow-up.
