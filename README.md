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
- A production Earth state can carry two adjacent NOAA GMGSI observation hours. Visible imagery supplies daylight cloud structure; longwave infrared maintains the weather pattern through darkness. The server rejects bad-quality pixels, reprojects the provider's actual nonuniform latitude grid and longitude seam to EPSG:4326, feathers quality boundaries, and conservatively suppresses cold polar surface ambiguity. The renderer crossfades both complete cloud states together over five minutes while the hidden details retain both genuine observation windows. GMGSI currently stops near ±72.7°; unsupported polar pixels remain truthfully uncovered until the dedicated polar-gap work lands.
- A production Earth state can also carry one atomic daily snow/sea-ice analysis. Snow modifies land albedo while preserving surface detail; sea ice independently changes ocean albedo and roughness instead of becoming cloud or shiny liquid water. Each layer records its valid/production/retrieval times, source versions, coverage, fallback fraction, fallback explanation, and attribution. Older bundles remain schema-compatible and render with zero contemporary cryosphere correction.
- The bundled fallback includes all twelve cloud-free 5.4K NASA Blue Marble Next Generation monthly surfaces from 2004. The renderer continuously interpolates adjacent months from the actual UTC calendar date, including a seamless December-to-January transition, while keeping only the active pair decoded. The oceans are shaded separately from the land with a low Fresnel reflectance, restrained GGX Sun glint, roughness, and atmospheric-sky reflection driven by the same astronomical Sun vector as the terminator.
- The fixed-time visual checks for seasonal change, the month-midpoint handoff, the terminator, and the packaged fallback are recorded in [`docs/qa/issue-5/`](docs/qa/issue-5/README.md).
- The live NOAA daylight and terminator checks are recorded in [`docs/qa/issue-6/`](docs/qa/issue-6/README.md).
- That fallback also preserves high-resolution night lights, the elevated cloud shell and its interpreted 25 August 2026 MODIS density state, the lunar map, 16K Milky Way, and Hipparcos catalogue. The browser no longer retrieves or interprets scientific satellite products itself; subsequent Earth-state production can replace these layers without changing the renderer's interface.
- The atmosphere uses ray-marched Rayleigh and Mie single scattering, exponential density falloff, ozone extinction, forward aerosol scattering, and explicit Earth shadow. The same air-mass extinction warms low-angle sunlight on the surface, cloud deck, and solar disc. The implementation notes and primary sources are in [`docs/atmospheric-lighting-research.md`](docs/atmospheric-lighting-research.md).

The principal Earth, night-light, and cloud maps ship under `public/`, so both the Tauri build and `dist` work without needing to download those large assets at runtime.

Sky credits: Hipparcos-2 catalogue data from ESA via CDS VizieR I/311. Gaia EDR3 colour-flux map: ESA/Gaia/DPAC, served by CDS as HiPS under ODbL-1.0 and rendered with CDS hips2fits.
