# Live Earth-state feed deployment

TheMarble's clients never retrieve or interpret scientific products. A scheduled
server-side pipeline publishes immutable, checksummed Earth-state bundles and an
atomic `latest.json` pointer to one HTTPS origin; the website and the Tauri app
read that one pointer and activate a replacement only after every declared byte
verifies. This document covers the operational side of that path: schedules,
provider adapters, delivery, credentials, verification, and rollback.

## The two producers

| Producer | Cadence | Advances at most | Command |
| --- | --- | --- | --- |
| Hourly clouds (GMGSI, or SatCORPS with a catalog) | polls every 10 minutes | once per validated nominal UTC hour | `npm run publish:earth-state-feed` |
| Daily snow and sea ice | runs three times daily | once per validated UTC analysis day | `npm run publish:earth-state-feed -- --cryosphere-catalog …` |

Both run through one orchestration command so a run can never leave an
incoherent combination:

```bash
npm run publish:earth-state-feed -- --python .venv-gmgsi/bin/python --output artifacts/earth-state --cryosphere-catalog artifacts/cryosphere/cryosphere-catalog.json
```

The orchestrator reads the published layer state before and after the run and
refuses to call the result coherent if the cloud, snow, or sea-ice valid time
moves backwards, if a layer disappears, if the cloud sequence stops being two
adjacent observed hours, or if a producer claims a publication the combined
state does not bear out. It exits non-zero in those cases and writes a run report
to `feed-run.json`. Provider lateness is different: a failed producer stage is
reported as `degraded`, the previous coherent Earth stays published, and its age
continues to increase truthfully.

Each producer inherits the current `latest.json` before replacing its own
layers, so the two independent schedules preserve one another's work. Both
scheduled workflows share the `earth-state-publication` concurrency group, so
they never race for the pointer.

## Daily provider adapters

The daily catalog contract in [`cryosphere-pipeline.md`](cryosphere-pipeline.md)
expects reprojected arrays on the bundle's north-up, `[-180, 180] × [-90, 90]`
grid. `npm run build:cryosphere-catalog` is the provider side of that contract:

```bash
npm run build:cryosphere-catalog -- --python .venv-cryosphere/bin/python --output artifacts/cryosphere
```

It asks every source for each of the last three UTC days (`--days`), downloads
what each one delivers, runs `scripts/cryosphere_provider_adapter.py` to decode,
reproject, and screen it, and then builds a catalog validated against the same
daily selector the publisher runs. A catalog that cannot produce a complete
global day fails here rather than half-publishing.

**The day a source contributes is decided from its adapted pixels, never from
the day requested.** A provider asked for a day it does not yet hold answers with
an empty grid; that candidate is excluded with a recorded reason and the newest
day that genuinely carries coverage wins. Sources therefore land on different
days when they run at different latencies, which is exactly what makes the
archival-AMSR2 guard below meaningful. Each product's `producedAt` comes from the
delivery's own `Last-Modified` header where the provider states one, falling back
to the retrieval time — the latest moment it can honestly be claimed to exist.

`config/cryosphere-sources.json` declares the sources. Each entry carries a
`urlTemplateEnv`, so any endpoint can be repointed from the environment without
editing the repository. Templates expand `{ISO_DATE}`, `{YYYY}`, `{MM}`, `{DD}`,
`{DDD}`, `{EPOCH_MS}`, `{WIDTH}`, `{HEIGHT}`, and `{NORTHERN_HEIGHT}`.

| Source | Default endpoint | Environment override |
| --- | --- | --- |
| `ims-snow-ice` | NOAA `usnic_ims_snow_ice_1km` ImageServer, EPSG:4326 export | `THEMARBLE_IMS_URL_TEMPLATE` |
| `gmasi-snow`, `gmasi-sea-ice` | none — operations owned | `THEMARBLE_GMASI_SNOW_URL_TEMPLATE`, `THEMARBLE_GMASI_SEA_ICE_URL_TEMPLATE` |
| `amsr2-snow`, `amsr2-sea-ice` | NASA GIBS WMS, EPSG:4326 | `THEMARBLE_AMSR2_SNOW_URL_TEMPLATE`, `THEMARBLE_AMSR2_SEA_ICE_URL_TEMPLATE` |
| `viirs-snow` | none — operations owned | `THEMARBLE_VIIRS_SNOW_URL_TEMPLATE`, `THEMARBLE_VIIRS_QUALITY_URL_TEMPLATE` |

GMASI has no stable public bucket, so this repository does not guess one; each
unconfigured source carries a `reason` saying why. Until operations configures a
current GMASI delivery, the disclosed NASA/JAXA AMSR2 contingency supplies the
global analysis, and the catalog records `contingency: "amsr2"` with its reason.
VIIRS is likewise unconfigured by default: the adapter screens VNP10_NRT's NDSI
and `Basic_QA` bands, and the public GIBS visualisation is a rendered palette
that cannot substitute for them. VIIRS is a refinement in #7's contract, so a
daily analysis publishes without it — but snow edges stay at analysis resolution
until an Earthdata-authenticated endpoint is configured.

An AMSR2 day older than the newest GMASI day is excluded with a recorded
reason — an archival day must never be presented as contemporary.

The IMS ImageServer must return raw class values, not a rendered symbology:
leave `renderingRule` unset. The adapter is self-guarding here — every provider
class must be declared in the source plan, and an undeclared value fails the run
instead of quietly becoming bare ground.

VIIRS retains only recent, sunlit, clear, high-confidence retrievals. Cloud,
night, ocean, inland-water, and no-decision sentinels receive quality zero and
can never claim snow; `Basic_QA` values worse than "good" fall below the
refinement threshold the compositor requires.

## Credentials

Provider credentials, bulk scientific formats, and processing all stay
server-side. Ordinary clients receive only small render-ready textures and a
manifest.

| Secret | Owner | Used by |
| --- | --- | --- |
| `THEMARBLE_EARTHDATA_TOKEN` | Data operations | VIIRS retrieval (`Authorization: Bearer`) |
| `THEMARBLE_ORIGIN_ACCESS_KEY_ID` / `THEMARBLE_ORIGIN_SECRET_ACCESS_KEY` | Platform operations | Object-storage upload only |

GMGSI needs no credentials: the NOAA Open Data bucket is public.

Repository *variables* — not secrets — carry the non-sensitive endpoints:
`THEMARBLE_ORIGIN_BUCKET_URI`, `THEMARBLE_ORIGIN_REGION`, `THEMARBLE_CDN_ORIGIN`,
`THEMARBLE_CDN_LATEST_URL`, `THEMARBLE_CLIENT_ORIGINS`, and the provider URL
templates above. A failed delivery is never logged with its URL, because a
provider template can carry a query-string credential.

## Delivery

Assets are content-addressed and immutable; only `latest.json` and
`latest-presentations.json` are replaced. The origin must therefore serve two
cache classes, and both clients must be able to read it cross-origin:

| Path class | `cache-control` | Notes |
| --- | --- | --- |
| `latest.json`, `latest-presentations.json` | `public, max-age=30, must-revalidate` | at most 600 s, and `no-cache`, `no-store`, or `must-revalidate` |
| `bundles/**`, `assets/**` | `public, max-age=31536000, immutable` | at least one day, and `immutable` |

Every path needs `access-control-allow-origin` covering both the website origin
and the Tauri webview origin (`tauri://localhost`); `*` is simplest. Credentialed
cross-origin delivery is refused — the feed is public read-only data. JSON must
be served as `application/json`.

Both mutable pointers are uploaded, not just `latest.json`: omitting
`latest-presentations.json` would silently strip the adaptive tiers and drop
every client back to the baseline bundle.

Publication order matters: sync the immutable assets first, then replace the
pointer. A pointer that names bytes the origin has not yet accepted is the one
way this design can show a client an incomplete bundle.

Its acceptance thresholds live in `config/earth-production-policy.json` under
`acceptance`, beside the health and soak thresholds, and are passed with
`--policy`.

`npm run verify:earth-state-feed -- --origin https://…/earth-state/` probes the
pointer, the manifest it names, and one of its assets, checks all of the above,
and then evaluates the served manifest itself: two adjacent recent observed
cloud hours from a provider with a documented freshness policy, paired daily
snow and sea-ice provenance from the same analysis day, complete source versions
and attribution, and attribution that says the result is modified by TheMarble
rather than unaltered provider imagery. Adding `--app-url` also loads the app
with a corrupt pointer response and asserts that a verified globe stays visible;
the scheduled health workflow does this against the client it already serves,
because the publication workflows have no browser.

### Storage growth

The asset store is content-addressed and append-only, so it grows with every
distinct texture ever published. Two consequences for operations: give the bucket
a lifecycle policy that expires `bundles/` directories and unreferenced `assets/`
objects past your retention window, and note that each publication run syncs the
store to the runner. The sync uses `--size-only`, which is exact for immutable
content-addressed objects and skips checksumming, but the transfer still scales
with the retained store — expiring old bundles keeps the ten-minute cloud job
inside its timeout.

## Client configuration

Both production builds read one configured pointer:

```sh
VITE_EARTH_STATE_LATEST_URL=https://earth.example.org/earth-state/latest.json npm run build
```

`VITE_EARTH_STATE_PRESENTATIONS_URL` selects the adaptive tier index described in
[`presentation-tiers.md`](presentation-tiers.md). Unset, both default to
`/earth-state/…` on the app's own origin.

Startup is always progressive: the packaged fallback (or, in Tauri, the newest
complete verified cache) renders immediately, then the newest complete remote
bundle is verified and activated atomically. The desktop app keeps the two newest
successfully activated remote bundles within a 384 MiB limit and re-verifies every
cached manifest and asset checksum before applying anything, so it reopens on the
latest coherent Earth while offline.

## Stale and failed feeds

Nothing here can blank the globe:

- an unavailable, malformed, corrupt, or timed-out `latest.json` leaves the
  active verified state and marks the refresh failed;
- a late provider leaves the newest complete state active with a truthful,
  increasing age;
- a partial or failed producer leaves `latest.json` untouched entirely.

The hidden provenance corner names each of these explicitly — interpolation,
staleness, offline cache, last-known-good, model assistance, and bundled
fallback — rather than implying currency the data does not have.

## Rollback

Every bundle directory is immutable and retained, so rollback is a pointer
change:

1. list the bundle directories and choose the newest known-good;
2. write a `latest.json` naming that bundle's `manifest.json` with its recorded
   byte length and checksum;
3. upload it with the pointer cache headers above;
4. run `npm run verify:earth-state-feed` against the origin.

Clients pick the restored pointer up within their ten-minute refresh. Because the
publishers never regress a valid time, the next successful producer run will
advance past the rolled-back state rather than fight it. The tested recovery
drills for provider outage, stale state, compositor restart, corrupt output,
publication interruption, and CDN failure are documented in
[`production-operations.md`](production-operations.md).

## Local visual acceptance

```bash
npm run preview:live -- --python .venv-cryosphere/bin/python
```

This publishes a state into `public/earth-state-preview/earth-state` and opens
TheMarble against it. Clouds are real: the NOAA GMGSI bucket is public and needs
no credentials. The daily cryosphere endpoints are operations-owned, so the
preview substitutes a conservative polar fixture labelled
`local-preview-fixture` with the attribution "Local preview fixture (not an
observation)" — it stands inside the polar caps deliberately and never invents
mid-latitude snow. Pass `--cryosphere-catalog` to use a real catalog instead, or
`--skip-cryosphere true` to publish clouds alone.

The preview directory is git-ignored. Never point a production build at it.
