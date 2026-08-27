# TheMarble

A small, live, interactive Earth view for use as a Tauri window or as a standalone page in a web desktop.

## Run it

```sh
npm install
npm run dev
```

Open the local address Vite prints. To use it as a desktop app, install the Rust toolchain and Tauri prerequisites, then run:

```sh
npm run tauri dev
```

To make a production web build, use `npm run build`; the `dist` folder is the embeddable app.

## Publish an Earth state

The deterministic publisher copies a complete verified source set into immutable, time-keyed paths and replaces `latest.json` only after every published byte passes read-back validation:

```sh
npm run publish:earth-state -- \
  --source public/earth-state/bundled-v1.json \
  --source-root public \
  --target-time 2026-08-25T12:00:00Z \
  --output artifacts/earth-state
```

Publishing the same source set for the same target time produces identical asset, manifest, and latest-pointer bytes. A website can serve the output directory at `/earth-state/`; TheMarble checks `/earth-state/latest.json` every ten minutes while retaining its current verified globe through missing, malformed, corrupt, or timed-out replacements. Set `VITE_EARTH_STATE_LATEST_URL` when the desktop build should read a production `latest.json` from a separate HTTPS origin.

The Tauri app keeps the two newest successfully activated remote bundles in its private persistent webview store. On startup it re-verifies cached manifests and every asset checksum before applying anything, tries the newest complete cache first, and falls back to the packaged seasonal Earth if storage is missing, evicted, partial, or corrupt. The website uses the same decoder and atomic activation path without the desktop cache.

### Publish hourly NOAA clouds

Install the server-side GMGSI compositor in a dedicated Python environment:

```sh
python3 -m venv .venv-gmgsi
.venv-gmgsi/bin/pip install -r requirements-gmgsi.txt
```

Then poll NOAA and publish the newest two adjacent, complete observation hours:

```sh
npm run publish:gmgsi -- \
  --python .venv-gmgsi/bin/python \
  --output artifacts/earth-state
```

Run that command from a server-side scheduler every 10–15 minutes. It lists the public NOAA GMGSI bucket, waits for a matching visible/longwave-IR pair, follows each NetCDF file's coordinates and quality flags, derives 4K cloud radiance/opacity and confidence textures, and atomically advances `latest.json` at most once for each nominal UTC hour. Repeated polls within the same hour report `unchanged`. Each producer inherits the current verified bundle before replacing its own layers, so hourly clouds preserve the latest daily cryosphere and a daily cryosphere update preserves the current cloud sequence. Static assets use a shared content-addressed store, so a new hour adds only the new cloud textures and manifest.

### Prefer physical NASA SatCORPS clouds

The advanced path accepts two adjacent NASA SatCORPS Global Cloud Composite frames listed by an operations catalog. Install both `requirements-satcorps.txt` and `requirements-gmgsi.txt` in the publishing environment, then run `npm run publish:clouds -- --catalog <catalog.json> --python <venv-python> --output <earth-state-directory>`. The catalog contains `{ "sequences": [...] }`; each SatCORPS frame uses the selector contract (`provider`, provenance times, version, coverage, quality) and points `assets.manifest` at its NetCDF/HDF5 product. Relative product URLs are resolved from the catalog URL. The same command automatically invokes the operational GMGSI publisher whenever the catalog is unavailable or SatCORPS download, validation, composition, or publication fails.

The selector requires two coherent hourly frames, at least 90% observed coverage, at least 70% usable retrievals, and a newest frame no more than two hours old. The compositor independently verifies those catalog claims from the pixels, follows NetCDF scale/fill metadata, and preserves cloud mask, 0.63 µm reflectance, optical depth, liquid/ice phase, effective height, per-pixel relative observation time, and retrieval quality in four GPU-ready textures. Publication remains atomic across all four textures, and older GMGSI-only bundles remain schema-compatible. `npm run compose:satcorps` remains available for inspecting one product. Because SatCORPS is still an early-access service, discovery and continuous endpoint measurement belong to the operational soak test rather than the browser.

### Complete polar and observation gaps honestly

After publishing the latest observed pair, `npm run publish:cloud-gaps` completes only its missing, rejected, or stale pixels. Recent quality-accepted VIIRS/MODIS observations have priority at the poles; matching-hour NOAA GFS total-cloud fills the remaining gaps; and the bundled cloud texture is the explicit last resort. Both hourly frames receive a categorical provenance texture. The manifest reports area-weighted observed, model-assisted, and static fractions, selected source versions and times, exact GFS run/hour, fallback explanation, and acceptance thresholds. The three classes must cover the globe and sum to one—there is no silent unknown class. Install `requirements-cloud-gaps.txt`; the catalog and command contract are documented in [`docs/cloud-gap-pipeline.md`](docs/cloud-gap-pipeline.md).

Daily snow-covered land and sea ice use a separate conservative pipeline. IMS is authoritative in the Northern Hemisphere, GMASI is the preferred global/Southern fill (with archival AMSR2 accepted only as a disclosed contingency), and recent clear, sunlit VIIRS may sharpen snow edges without erasing trusted analysis under cloud or darkness. Install `requirements-cryosphere.txt` and run `npm run publish:cryosphere -- --catalog <catalog.json> --python <venv-python> --output <earth-state-directory>`. Both publishers automatically derive from that output directory's current `latest.json`; `--base-manifest` remains available for an intentional override or first-run fixture. The complete source hierarchy, catalog contract, fusion rules, and primary documentation are in [`docs/cryosphere-pipeline.md`](docs/cryosphere-pipeline.md).

An incomplete pair, mismatched observation window, insufficient longwave coverage, invalid grid, failed download, failed compositor, or failed read-back leaves the previous `latest.json` untouched. The globe therefore keeps the newest complete state and reports an age that continues to increase. Serve the output at `/earth-state/`, or set `VITE_EARTH_STATE_LATEST_URL` to its HTTPS `latest.json`. NOAA data is modified by TheMarble's reconstruction; the generated manifest retains NOAA attribution and never describes the result as unaltered NOAA imagery.

## What is live

- The sunlight position is calculated locally from the current UTC time and date, producing the right seasonal tilt and day/night terminator.
- The solar disc uses the Sun's real radius and mean astronomical-unit distance. The opening camera is placed just outside the Earth-Sun occultation cone, so the true-sized Sun appears immediately beside the atmospheric limb without being pinned to the screen.
- The Moon position is calculated from its current approximate orbital coordinates.
- The star field is generated from 37,619 real Hipparcos-2 catalogue positions, apparent magnitudes, and B−V colours. It is fixed in an inertial celestial frame while Earth turns beneath it.
- The unresolved Milky Way is a 16K all-sky texture rendered from CDS's progressive Gaia EDR3 colour-flux HiPS survey and registered to the Hipparcos frame. Simulated eye/camera adaptation substantially dims the Milky Way and faint stars whenever the Sun is visible.
- The Sun keeps its physical angular size, but high dynamic range, sensor bloom, short diffraction rays, and a very restrained, occultation-aware lens flare prevent it from reading as a flat white button.
- The renderer receives one versioned Earth-state bundle rather than provider-specific imagery. Its manifest records geographic convention, observation and production times, dataset versions, attributions, texture semantics, immutable asset references, and SHA-256 checksums. The same activation path runs in the website and Tauri app, and a replacement cannot become current unless its complete asset set loads and matches its declared byte lengths and checksums.
- A production Earth state can carry two adjacent NOAA GMGSI observation hours. Visible imagery supplies daylight cloud structure; longwave infrared maintains the weather pattern through darkness. The server rejects bad-quality pixels, reprojects the provider's actual nonuniform latitude grid and longitude seam to EPSG:4326, feathers quality boundaries, and conservatively suppresses cold polar surface ambiguity. The renderer crossfades both complete cloud states together over five minutes while the hidden details retain both genuine observation windows. GMGSI's observed coverage stops near ±72.7°; the gap-completion stage can now fill those caps first with recent VIIRS/MODIS observations, then matching-hour GFS, then explicitly disclosed static fallback.
- When a fresh, global SatCORPS pair passes the same atomic boundary, it becomes the preferred cloud source. Reflectance and optical depth control sunlit radiance and transmission; phase changes liquid/ice scattering; effective height displaces the cloud limb and drives spherical Sun-ray shadow intersections; relative time gently reduces trust in older pixels. Clouds emit no night light, and optical depth attenuates both the surface and city lights beneath dense cloud. GMGSI remains the automatic operational fallback.
- A production Earth state can also carry one atomic daily snow/sea-ice analysis. Snow modifies land albedo while preserving surface detail; sea ice independently changes ocean albedo and roughness instead of becoming cloud or shiny liquid water. Each layer records its valid/production/retrieval times, source versions, coverage, fallback fraction, fallback explanation, and attribution. Older bundles remain schema-compatible and render with zero contemporary cryosphere correction.
- Contemporary land can be published as a rolling clear-surface composite with `npm run publish:rolling-surface`. Quality-approved MCD43A4 NBAR and VIIRS surface-reflectance pixels gradually replace the seasonal portrait; cloud, shadow, haze, poor geometry, and rejected pixels retain their previous clean value and continue aging. A lossless paired audit texture maps every rolling pixel to its exact contributing observation window, while baseline pixels retain an explicit non-fresh sentinel. Robust color normalization, a daily change limit, and inward swath-edge feathering suppress seams and abrupt calibration shifts. All twelve Blue Marble monthly surfaces remain in every bundle as the permanent fallback. See [`docs/rolling-surface-pipeline.md`](docs/rolling-surface-pipeline.md).
- The bundled fallback includes all twelve cloud-free 5.4K NASA Blue Marble Next Generation monthly surfaces from 2004. The renderer continuously interpolates adjacent months from the actual UTC calendar date, including a seamless December-to-January transition, while keeping only the active pair decoded. The oceans are shaded separately from the land with a low Fresnel reflectance, restrained GGX Sun glint, roughness, and atmospheric-sky reflection driven by the same astronomical Sun vector as the terminator.
- The fixed-time visual checks for seasonal change, the month-midpoint handoff, the terminator, and the packaged fallback are recorded in [`docs/qa/issue-5/`](docs/qa/issue-5/README.md).
- The live NOAA daylight and terminator checks are recorded in [`docs/qa/issue-6/`](docs/qa/issue-6/README.md).
- That fallback also preserves high-resolution night lights, a globally complete elevated static cloud shell with neutral confidence, the lunar map, 16K Milky Way, and Hipparcos catalogue. The browser no longer retrieves or interprets scientific satellite products itself; subsequent Earth-state production can replace these layers without changing the renderer's interface.
- The atmosphere uses ray-marched Rayleigh and Mie single scattering, exponential density falloff, ozone extinction, forward aerosol scattering, and explicit Earth shadow. The same air-mass extinction warms low-angle sunlight on the surface, cloud deck, and solar disc. The implementation notes and primary sources are in [`docs/atmospheric-lighting-research.md`](docs/atmospheric-lighting-research.md).

The principal Earth, night-light, and cloud maps ship under `public/`, so both the Tauri build and `dist` work without needing to download those large assets at runtime.

Sky credits: Hipparcos-2 catalogue data from ESA via CDS VizieR I/311. Gaia EDR3 colour-flux map: ESA/Gaia/DPAC, served by CDS as HiPS under ODbL-1.0 and rendered with CDS hips2fits.
