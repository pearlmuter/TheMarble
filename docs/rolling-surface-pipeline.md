# Rolling contemporary clear-land surface

TheMarble's contemporary land is a rolling, quality-screened mosaic, not a claim that the planet was photographed all at once. The permanent fallback remains the twelve cloud-free 2004 Blue Marble Next Generation monthly surfaces. At each publication time the two calendar-adjacent fallback months are blended, previous accepted land pixels are retained and aged, and only accepted MODIS or VIIRS land observations may replace them.

## Scientific source contract

Prepared provider adapters may offer:

- NASA [MCD43A4 Version 6.1 NBAR](https://lpdaac.usgs.gov/products/mcd43a4v061/), a daily product built from a multi-day BRDF retrieval window. Its product date is not a same-day global photograph.
- NASA [VNP09GA Version 2](https://lpdaac.usgs.gov/products/vnp09gav002/), daily VIIRS surface reflectance used only where its quality, cloud, cloud-shadow, haze, and geometry fields pass the compositor thresholds.

The selector rejects unapproved products, future or inverted windows, insufficient accepted coverage, stale candidates, and candidates older than the current rolling state. Newest valid observations are considered first; equal-time MCD43A4 NBAR wins because its directional reflectance has already been normalized.

The catalog is JSON. Relative `href` values resolve from the catalog file:

```json
{
  "retrievedAt": "2026-08-27T07:00:00Z",
  "candidates": [
    {
      "product": "mcd43a4-nbar",
      "version": "MCD43A4.061-adapter-1",
      "href": "./mcd43a4-2026-08-24.npz",
      "validAt": "2026-08-24T12:00:00Z",
      "observedFrom": "2026-08-12T00:00:00Z",
      "observedTo": "2026-08-26T23:59:59Z",
      "producedAt": "2026-08-27T05:00:00Z",
      "coverage": { "observedFraction": 0.91 },
      "quality": { "acceptedFraction": 0.82 }
    }
  ]
}
```

An optional `byteLength` and SHA-256 `checksum` protect each candidate. Every NPZ is a north-up EPSG:4326 grid matching the seasonal surface dimensions. It may contain the already standardized fields `reflectance` (`H×W×3`, linear 0–1), `land`, `quality`, `cloud`, `cloud_shadow`, `haze`, `geometry_quality`, and `age_days`, or the provider fields below. Provider reprojection remains in the acquisition adapter; scale and QA interpretation happen at the compositor seam and are fixture-tested.

- MCD43A4: `nbar_rgb` contains bands 1/4/3 as stored integers, `mandatory_quality_rgb` contains the three corresponding mandatory QA bands, plus `land` and `age_days`. Only full BRDF inversions (`bit 0 = 0`) in all three color bands are accepted; reflectance uses the documented `0.0001` scale.
- VNP09GA: `surface_reflectance_rgb` contains M5/M4/M3 natural color, accompanied by `qf1`, `qf2`, `qf3`, `qf5`, `qf7`, and `age_days`, with optional `sensor_zenith_degrees`. The decoder requires medium/high cloud-mask quality, clear/probably-clear daylight, land, no cloud shadow, no heavy aerosol/cirrus/adjacent-cloud flag, good M5/M4/M3 SDR and surface-reflectance quality, valid reflectance, and acceptable geometry. These masks follow the NASA VNP09 QF tables rather than applying the unrelated I1/I2/I3 flags or trusting a generic quality percentage.

## Composition and auditability

Clear, finite land pixels above the quality and geometry thresholds may update. Cloud, cloud shadow, haze, ocean, invalid reflectance, and poor viewing geometry retain the prior clean surface. Prior observed pixels age by elapsed whole days. Pixels with no accepted history use the current seasonal blend and the reserved age value `65535`; they are never described as fresh.

A robust per-channel gain, clipped to 0.75–1.25, is calculated independently for every declared `tile_id` (or once for an untiled observation), reducing calibration differences at contiguous tile boundaries. A configurable daily delta limit prevents a single swath from making a large visual jump, and an inward feather makes the accepted side of each swath meet retained imagery continuously without altering rejected pixels. Incoming observations may replace only baseline or older observed pixels, so a late-arriving clear granule can fill gaps without making fresher land older. These controls deliberately favor a stable planetary portrait over pretending each raw granule is already a seamless visual mosaic.

The paired `surfaceAge` PNG is lossless RGBA:

- red/green: unsigned 16-bit pixel age in whole days; `65535` means seasonal baseline;
- blue/alpha: unsigned 16-bit observation-window index; zero means seasonal baseline.

The manifest maps every nonzero window index to product, version, valid time, and full contributing observation window. Indices unused by the current surface are dropped at the next publication. Coverage fractions are area-weighted, and the manifest records rolling, newly updated, and baseline fractions plus oldest/newest ages and normalization policy.

## Publish

```sh
python3 -m venv .venv-rolling-surface
.venv-rolling-surface/bin/pip install -r requirements-rolling-surface.txt

npm run publish:rolling-surface -- \
  --catalog artifacts/rolling-surface/catalog.json \
  --target-time 2026-08-27T12:00:00Z \
  --python .venv-rolling-surface/bin/python \
  --output artifacts/earth-state
```

The publisher continues from the output directory's verified `latest.json`; on the first run it uses the bundled twelve-month fallback. `--base-manifest` permits an intentional alternative. Generated surface, per-pixel audit texture, all inherited layers/resources, and all twelve fallback months cross the ordinary atomic Earth-state publication seam together. A failed selection, composition, checksum, asset write, or read-back cannot replace `latest.json`.

This ticket supplies the deterministic daily publication pipeline. Scheduling and provider credential/discovery adapters belong in deployment: the browser and Tauri app consume the same published Earth-state bundle and do not download scientific granules directly.
