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

## What is live

- The sunlight position is calculated locally from the current UTC time and date, producing the right seasonal tilt and day/night terminator.
- The solar disc uses the Sun's real radius and mean astronomical-unit distance. The opening camera is placed just outside the Earth-Sun occultation cone, so the true-sized Sun appears immediately beside the atmospheric limb without being pinned to the screen.
- The Moon position is calculated from its current approximate orbital coordinates.
- The star field is generated from 37,619 real Hipparcos-2 catalogue positions, apparent magnitudes, and B−V colours. It is fixed in an inertial celestial frame while Earth turns beneath it.
- The unresolved Milky Way is a 16K all-sky texture rendered from CDS's progressive Gaia EDR3 colour-flux HiPS survey and registered to the Hipparcos frame. Simulated eye/camera adaptation substantially dims the Milky Way and faint stars whenever the Sun is visible.
- The Sun keeps its physical angular size, but high dynamic range, sensor bloom, short diffraction rays, and a very restrained, occultation-aware lens flare prevent it from reading as a flat white button.
- The globe uses a bundled 5.4K NASA Blue Marble surface, high-resolution night lights, a detailed lunar map, and a separate elevated cloud shell. The cloud shell is lit independently and slightly shadows the surface. Its continuous high-detail texture is subtly modulated every 30 minutes by NASA's same-day MODIS weather observations. The raw MODIS no-data swaths are assigned zero confidence, so they never form bands on the planet.
- The atmosphere uses ray-marched Rayleigh and Mie single scattering, exponential density falloff, ozone extinction, forward aerosol scattering, and explicit Earth shadow. The same air-mass extinction warms low-angle sunlight on the surface, cloud deck, and solar disc. The implementation notes and primary sources are in [`docs/atmospheric-lighting-research.md`](docs/atmospheric-lighting-research.md).

The principal Earth, night-light, and cloud maps ship under `public/`, so both the Tauri build and `dist` work without needing to download those large assets at runtime.

Sky credits: Hipparcos-2 catalogue data from ESA via CDS VizieR I/311. Gaia EDR3 colour-flux map: ESA/Gaia/DPAC, served by CDS as HiPS under ODbL-1.0 and rendered with CDS hips2fits.
