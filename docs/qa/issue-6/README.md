# Ticket #6 visual acceptance

These fixed-time screenshots render a real NOAA GMGSI v3r0 pair observed on 25 August 2026 at 16:00Z and 17:00Z. The 17:00Z visible and longwave products were produced by NOAA at 17:43Z; the source files reported optimal longwave coverage of 99.75% within their grid and the published equirectangular state covers 95.45% of Earth by area through approximately 72.7° north and south.

- `gmgsi-daylight.png` verifies sharp, observation-derived weather systems over a cloud-free seasonal surface.
- `gmgsi-terminator.png` verifies that the same cloud state follows the astronomical terminator into darkness without a separate decorative night texture.

Both were captured at 1280 × 720 from the web renderer with `time=2026-08-25T17:48:00Z`. The browser console contained no warnings or errors. The actual five-minute transition and bounding-window provenance are covered at the controller and manifest seams; provider discovery, incomplete arrival, quality gaps, polar no-data, seam reprojection, darkness, snow ambiguity, thin cloud, clear desert, and tropical convection are covered by deterministic fixtures.

Source: [NOAA Global Mosaic of Geostationary Satellite Imagery](https://registry.opendata.aws/noaa-gmgsi/). The rendered cloud textures are modified derivatives, not original unaltered NOAA imagery.
