# Cloud relief and view-scale debug controls

## Request

Let the user compare cloud relief interactively and report an objective map-style zoom level before choosing a new zoom limit. Keep controls in a debug subsection of the upper-left menu. Also check and restore production pipeline health.

## Behavior

- The slider changes cloud-top slope exaggeration from 0× to 40× in 0.25 steps, with 1×, 4× (default), and 34× (previous) presets. It updates a shader uniform immediately and resets on reload. It does not change source data, cloud smoothing, cast-shadow weighting, or the current zoom limits.
- 1× preserves the underlying model's height-to-distance slope; 4× is less exaggerated than 34×. This is not a claim of measured cloud shape or calibrated radiative transfer. GMGSI uses estimated height/optical depth, and the existing relief lighting remains an approximation.
- The debug menu shows fractional map-equivalent zoom, centre metres per CSS pixel, camera altitude, latitude/longitude, viewport size and field of view. Copying records these plus scene time, relief and active bundle. A selectable text fallback works when clipboard access is unavailable.

## Chosen maximum zoom

The user selected **5.35** as the maximum Earth map-equivalent zoom. The minimum camera distance is derived from that scale using the current CSS viewport height and effective field of view, so scrolling, pinching and resizing cannot exceed it. A resized window moves an over-close camera outward as needed. The existing atmosphere safety floor remains, and the special Moon-targeted reference view retains its own camera limits. The cloud relief controls and default remain unchanged.

## Zoom convention

The camera looks at Earth's centre and panning is disabled. For centre-ray altitude `h`, effective vertical field of view `f`, and viewport CSS height `H`, the differential ground scale is `m = 2 h tan(f/2) / H`. The equivalent 256-pixel equatorial tile zoom is `z = log2(2 π R / (256 m))`, using the renderer's Earth radius (6378137 m).

This is an **equator-normalized, centre-scale equivalent**, not a global extent or a latitude-adjusted local Mercator zoom. It stays comparable while orbiting toward the poles. Perspective scale changes toward the limb. Window height and field of view affect the reading; device pixel ratio does not. At a given scale, a 512-pixel tile convention is one zoom level lower. The readout does not imply the source contains that much detail. Scale and location are unavailable in the special Moon-targeted reference scene because its centre ray does not point at Earth.

References: [Mapbox tile size and zoom conventions](https://docs.mapbox.com/help/glossary/zoom-level/), [GDAL's distinction between unit scaling and vertical exaggeration](https://gdal.org/en/stable/programs/gdal_raster_hillshade.html).

## Verification and pipeline diagnosis

The map-scale tests check the 256-pixel equatorial reference, half-altitude/double-height zoom increments, and an independent ray–sphere arc calculation. Browser checks exercise shader uniform changes, presets, keyboard input, captured readings, resizing and mobile overflow. Escape revealed a pre-existing pointerleave/focus interaction that reopened the menu; a regression test reproduces it and preserves dismissal until intentional re-entry.

Production cloud publication succeeds. Health run 34027378334 passed feed delivery but reported the terminator and night views still `checking`. Its shared startup wait deducted the bundled globe's loading time from the subsequent remote activation's own deadline. A reduced timing test reproduces the false timeout: 100 units of fallback loading plus 280 units of healthy live loading fails a shared 330-unit allowance. The monitor now gives each sequential phase its own existing application-sized allowance, without changing application timeouts or health acceptance criteria. The workflow is bounded at 45 minutes to leave room for three views, both startup phases, navigation and retained diagnostics. Local software-rendered night startup reached current data; branch/live CI verification is required before claiming the monitor is healthy.

Local production validation (2026-09-06): all 398 tests and the production build pass. The production-configured build reached current remote data in day, terminator and night views with no console or page errors. Feed verification, degraded fallback and the enforced production-health evaluation pass. Standards review found no violations; Spec review's Moon-target edge case was corrected and checked in the browser. Provider telemetry and origin-only checks retain their existing policy waivers; these results do not assert those unconfigured stages are observed.
