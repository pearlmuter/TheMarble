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

## What is live

- The sunlight position is calculated locally from the current UTC time and date, producing the right seasonal tilt and day/night terminator.
- The solar disc uses the Sun's real radius and mean astronomical-unit distance. The opening camera is placed just outside the Earth-Sun occultation cone, so the true-sized Sun appears immediately beside the atmospheric limb without being pinned to the screen.
- The Moon position is calculated from its current approximate orbital coordinates.
- The star field is generated from 37,619 real Hipparcos-2 catalogue positions, apparent magnitudes, and B−V colours. It is fixed in an inertial celestial frame while Earth turns beneath it.
- The unresolved Milky Way is a 16K all-sky texture rendered from CDS's progressive Gaia EDR3 colour-flux HiPS survey and registered to the Hipparcos frame. Simulated eye/camera adaptation substantially dims the Milky Way and faint stars whenever the Sun is visible.
- The Sun keeps its physical angular size, but high dynamic range, sensor bloom, short diffraction rays, and a very restrained, occultation-aware lens flare prevent it from reading as a flat white button.
- The renderer receives one versioned Earth-state bundle rather than provider-specific imagery. Its manifest records geographic convention, observation and production times, dataset versions, attributions, texture semantics, immutable asset references, and SHA-256 checksums. The same activation path runs in the website and Tauri app, and a replacement cannot become current unless its complete asset set loads and matches its declared byte lengths and checksums.
- Contemporary land can be published as a rolling clear-surface composite with `npm run publish:rolling-surface`. Quality-approved MCD43A4 NBAR and VIIRS surface-reflectance pixels gradually replace the seasonal portrait; cloud, shadow, haze, poor geometry, and rejected pixels retain their previous clean value and continue aging. A lossless paired audit texture maps every rolling pixel to its exact contributing observation window, while baseline pixels retain an explicit non-fresh sentinel. Robust color normalization, a daily change limit, and inward swath-edge feathering suppress seams and abrupt calibration shifts. All twelve Blue Marble monthly surfaces remain in every bundle as the permanent fallback. See [`docs/rolling-surface-pipeline.md`](docs/rolling-surface-pipeline.md).
- The bundled fallback includes all twelve cloud-free 5.4K NASA Blue Marble Next Generation monthly surfaces from 2004. The renderer continuously interpolates adjacent months from the actual UTC calendar date, including a seamless December-to-January transition, while keeping only the active pair decoded. The oceans are shaded separately from the land with a low Fresnel reflectance, restrained GGX Sun glint, roughness, and atmospheric-sky reflection driven by the same astronomical Sun vector as the terminator.
- The fixed-time visual checks for seasonal change, the month-midpoint handoff, the terminator, and the packaged fallback are recorded in [`docs/qa/issue-5/`](docs/qa/issue-5/README.md).
- That fallback also preserves high-resolution night lights, the elevated cloud shell and its interpreted 25 August 2026 MODIS density state, the lunar map, 16K Milky Way, and Hipparcos catalogue. The browser no longer retrieves or interprets scientific satellite products itself; subsequent Earth-state production can replace these layers without changing the renderer's interface.
- The atmosphere uses ray-marched Rayleigh and Mie single scattering, exponential density falloff, ozone extinction, forward aerosol scattering, and explicit Earth shadow. The same air-mass extinction warms low-angle sunlight on the surface, cloud deck, and solar disc. The implementation notes and primary sources are in [`docs/atmospheric-lighting-research.md`](docs/atmospheric-lighting-research.md).

The principal Earth, night-light, and cloud maps ship under `public/`, so both the Tauri build and `dist` work without needing to download those large assets at runtime.

Sky credits: Hipparcos-2 catalogue data from ESA via CDS VizieR I/311. Gaia EDR3 colour-flux map: ESA/Gaia/DPAC, served by CDS as HiPS under ODbL-1.0 and rendered with CDS hips2fits.
