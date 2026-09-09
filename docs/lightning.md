# Observed lightning

## Implementation plan

1. Publish compact, timestamped flash observations from NOAA GOES-19/18 GLM and EUMETSAT MTG LI. Decode packed numbers and quality flags; retain source windows and provenance. EUMETSAT needs repository secrets; never expose them to browsers.
2. Replay each source on a fixed delayed clock, once per observation. Keep continuous timing across refreshes, hide expired/missing intervals, and never replace an unavailable feed with invented activity. Avoid counting the same storm twice in overlapping satellite views by assigning fixed longitude sectors.
3. Render brief, soft optical illumination above the surface, with Earth occlusion and restrained daylight visibility. Locations and durations are observed; cloud diffusion and visible colour/brightness are illustrative. Satellite optical energy is not total discharge energy.
4. Put live/off/recorded-demo controls, delay, coverage, freshness and attribution inside Debug view only. Preserve zoom 5.35 and the existing aurora controls.
5. Validate packed decoding, timing, deduplication, stale data, source failures, rendering and mobile. Review, publish, and check the served result.

## Sources

- NOAA GOES GLM LCFA: https://registry.opendata.aws/noaa-goes/ — public cloud distribution; 20-second files containing flash centroids, first/last event time, area, radiant energy and quality flags.
- EUMETSAT LI LFL: https://user.eumetsat.int/catalogue/EO%3AEUM%3ADAT%3A0691 — free and unrestricted CC BY 4.0; downloaded products require an account. https://user.eumetsat.int/resources/user-guides/data-store-detailed-guide
- Optical scattering and detection limits: https://user.eumetsat.int/resources/user-guides/background-to-lightning-detection
- Appearance from orbit: https://www.nasa.gov/image-article/thunderstorms-visible-during-nighttime-pass/

These are detected total-lightning flashes, not necessarily ground strikes. Missing detections or uncovered regions do not establish an absence of lightning. The cloud imagery has its own observation time and may not align with a newer storm. No exact bolt geometry or calibrated naked-eye brightness is claimed.

## Delivery and setup

`lightning.yml` publishes `/lightning/latest.json`, a separate key in the existing
R2 bucket. The Cloudflare publisher scheduler dispatches it every five minutes;
GitHub scheduling is a backstop. The browser refreshes once a minute. It replays
NOAA ten minutes behind the clock and EUMETSAT twenty minutes behind, allowing for
download batching and publication. Missing source intervals stay dark. These are
intentional playback delays, not promises that every upstream file arrives on time.

To enable EUMETSAT, create a free account at https://api.eumetsat.int/api-key/ and
set repository secrets `EUMETSAT_CONSUMER_KEY` and `EUMETSAT_CONSUMER_SECRET`.
Without those, Debug view reports that the account is not configured; NOAA remains
independent. `VITE_LIGHTNING_URL` can override the published endpoint for testing.
No credentials are embedded in the application.

NOAA West owns longitudes west of 105°W and east of 150°E, NOAA East owns
105°W–30°W, and LI owns 30°W–80°E. The feeds are further limited by sensor coverage
and conservative latitude bounds; these sectors are not guarantees of detection.
Keeping one satellite per sector avoids double-counting the same flash from
multiple viewing angles, at the cost of unused overlap and no automatic geographic
fallback during outages.

The recorded example is a GOES-19 twenty-second file from 2026-09-09 09:20 UTC.
Its public source URL and SHA-256 are retained in `src/lightning-demo.json`.
Quality flags and geographic sector filtering are the same as live playback.

## Visual approximation

Flash centroids and first/last event times come from observations. GLM area and
optical energy at the detector inform a bounded glow radius and relative intensity;
LI footprint pixel counts give only an approximate area and LI brightness is
currently neutral, pending radiometric cross-calibration. A white-blue diffuse
footprint represents light scattered through a thundercloud, at a representative
12 km cloud-top altitude. The current cloud texture modulates its appearance but
cannot reconstruct the cloud that existed at the flash time. Atmospheric
transmission and Earth occlusion apply. Daylight contrast is reduced. There are
no giant drawn bolts, artificial ground impacts, or additional synthetic strikes.
The visible envelope is approximate (60–1500 ms); sub-flash pulse timing and exact
brightness cannot be recovered from these flash summaries.

## Validation status

NOAA decoding was exercised against current GOES-19 and GOES-18 files, including
packed unsigned energy/area and time offsets. Six Python regressions cover
packing (both byte orders), time units, quality rejection, geographic ownership
and missing LI BODY intervals. Browser checks exercise the actual recorded NOAA
sample, live-source failure, off mode, mobile layout and zoom 5.20 below the 5.35
cap. A GPU readback fixture produces zero emitted light behind Earth and reduced
daylight output, without GL errors. Playback tests include duplicate refreshes,
expired windows, historical scene clocks and sub-second backwards adjustments.

**EUMETSAT remains unverified against an authenticated product.** The adapter is
implemented using the documented LFL fields and official EUMDAC client, but the
repository currently has no EUMETSAT credentials. Configuring secrets must be
followed by a successful real LI decode and served-feed check before its live
compatibility can be claimed. NOAA operates independently meanwhile.
