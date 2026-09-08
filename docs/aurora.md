# Aurora simulation

## Scope

Add an aurora layer guided by NOAA SWPC's OVATION forecast, with a repeatable debug demonstration and optional north/south camera shortcuts. Keep controls in the upper-left Debug view. Retain the 5.35 zoom cap and existing Earth rendering. Publish after testing and review.

## Scientific contract

- The normal layer is explicitly **the latest forecast overlay**, with observation and forecast-valid UTC times. It is not an observation of aurora happening now. It does not change the globe clock. For a separately requested historical scene, hide unrelated current forecasts.
- Geographic activity comes from NOAA's 360 × 181, one-degree longitude/latitude probability grid. Percentages constrain an illustrative emission envelope, not calibrated radiance. Curtains, motion and brightness are simulated.
- Approximate green emission at 100–200 km, faint higher red at 200–400+ km, and a restrained lower violet fringe. Render above clouds with solid-Earth occlusion and stronger visibility against the dark hemisphere. Daylight suppression is a display approximation, not absence of daytime aurora. Fine magnetic geometry, refraction and absolute photometry are not solved.
- Debug mode uses a bundled NOAA forecast recorded on 2026-09-06, with activity amplified to make inspection repeatable. It is labelled as a recorded, amplified demonstration, never as a historical storm reconstruction. Keep a small demonstration indicator visible when the menu is closed.
- Forecast refresh is independent of Earth loading and publication. Fetch the public CORS-enabled NOAA endpoint every five minutes with a timeout; validate grid shape, ranges, duplicate cells and timestamps. Hide stale/unavailable data rather than substitute a demo. A previously verified fresh forecast may survive a failed refresh, with that failure disclosed. Mode changes and late fetch completions cannot overwrite one another.
- A forecast is fresh only when its observation is at most two hours old (five minutes future clock tolerance). Lead time must be 0–180 minutes. A fixed scene more than 15 minutes from both current time and forecast-valid time does not use the current overlay.

## Data and attribution

NOAA SWPC OVATION: https://services.swpc.noaa.gov/json/ovation_aurora_latest.json

Forecast interpretation: https://www.swpc.noaa.gov/products/aurora-30-minute-forecast

Public reuse: https://www.weather.gov/disclaimer/

Emission heights: https://science.nasa.gov/sun/auroras/

The demo records the original observation and forecast timestamps, source URL and SHA-256 of the original response. Only its numeric grid representation is compacted; demonstration amplification happens in the renderer.

## Equatorial data guard

The raw NOAA responses inspected on 6 and 8 September 2026 contain an isolated
nonzero strip at −1°/0° latitude surrounded by zero-valued rows. Rendering this
literally produced an equatorial aurora ring. We interpret this as a gridding
artifact, not a verified physical event. The display removes equatorial cells
that have no eight-neighbour nonzero connection to activity outside ±10°;
longitude neighbours wrap at the seam. This preserves continuous equatorward
expansion and all source values outside that belt. The archived source is
unchanged. This conservative display correction is not a NOAA quality flag and
cannot establish whether a detached low-latitude event actually occurred.

## Validation

Check coordinate registration (Greenwich, dateline, poles, hemisphere), malformed/duplicate/missing values, freshness and scene-time gating, mode switching during fetches, stale/failed fetches, and bounded Earth-occluded ray intervals. Visually inspect both hemispheres, overhead and horizon views, daylight, demo off, zoom cap and mobile controls. Compare frame cost with aurora off/on, run all tests and the production build, and verify the deployed site.

### Acceptance recorded 2026-09-08

- Clean committed-tree production build and all **412 tests** pass, including
  thirteen aurora tests for registration, completeness, malformed data, freshness,
  mode/fetch races, failure recovery, Earth occlusion and the equatorial guard.
- Chromium on Apple M1 Max/ANGLE Metal: northern and southern camera shortcuts,
  recorded demo, current NOAA forecast, off mode, daylight, full-globe limb,
  persistent demonstration label and 390-pixel mobile controls inspected. No
  shader errors, page errors or lost graphics context; zoom still caps at 5.35.
- NOAA's response was accessible from the browser with observation
  `2026-09-08T15:40:00Z` and forecast-valid time `2026-09-08T16:36:00Z`.
- Separate standards and spec reviews of the committed implementation found no
  actionable findings. These checks validate an explicitly illustrative model,
  not measured auroral morphology or absolute brightness. Native Tauri visual
  acceptance and low-end GPU performance remain unmeasured.

Browser captures and measurements are retained locally in `artifacts/aurora/`;
these diagnostic files are not shipped with the website.
