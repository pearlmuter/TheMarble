# Daily cryosphere pipeline

TheMarble treats snow-covered land and sea ice as two physical surface states, never as cloud imagery. The daily producer creates two EPSG:4326 equirectangular RGB textures. Red is fractional coverage, green is analysis confidence, and blue identifies the contributing analysis (global fallback, IMS, or VIIRS refinement).

## Production update — 2026-09-05

Production uses the public IMS 4 km numerical NetCDF, inverse-projected through
its own CF metadata. OSI SAF OSI-401-d v4.1 supplies quality-screened daily 10 km
sea-ice concentration in both hemispheres. Measured concentration supersedes IMS
ice extent over accepted ocean pixels; excluded coastal, lake, land or uncertain
pixels retain the extent fallback. Unobserved stays distinct from open water.
Each source retains its own analysis date. The source catalog and menu explicitly
distinguish categorical extent from concentration. See [validation and plan](polar-cloud-plan.md).

The hierarchy below describes other supported inputs; GMASI and VIIRS endpoints
are still not configured in production. Native 4 km is delivered to the existing
4096 × 2048 globe grid, whose latitude resolution remains about 9.8 km.

## Source hierarchy

1. **U.S. National Ice Center Interactive Multisensor Snow and Ice Mapping System (IMS), 4 km in production** is authoritative over its Northern Hemisphere coverage. Its fixed categories are outside coverage, open water, snow-free land, sea/lake ice, and snow-covered land.
2. **NOAA GMASI, approximately 2 km daily global snow/ice** is the preferred documented fill for the Southern Hemisphere and any missing IMS pixel. The selector also accepts the NASA/JAXA AMSR2 unified daily snow-water-equivalent and 12.5 km sea-ice products as a lower-resolution contingency when a current GMASI delivery is unavailable.
3. **NASA VIIRS VNP10_NRT V2, 375 m** may refine recent snow edges only where its quality input says the retrieval is recent, sunlit, clear, and high-confidence. It cannot repaint stable analysis interiors.

Primary product documentation:

- [USNIC IMS product page](https://usicecenter.gov/Products/ImsHome)
- [NSIDC IMS user guide](https://nsidc.org/sites/default/files/g02156-v001-userguide_1.pdf)
- [NOAA GMASI product page](https://www.ospo.noaa.gov/products/land/gmasi/)
- [NASA VNP10_NRT V2 product page](https://www.earthdata.nasa.gov/data/catalog/lpcloud-vnp10-nrt-2)
- [NASA GIBS AMSR2 snow metadata](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/AMSRU2_Snow_Water_Equivalent_Daily.json)
- [NASA GIBS AMSR2 sea-ice metadata](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/AMSRU2_Sea_Ice_Concentration_12km.json)

AMSR2’s public GIBS layers are a supported contingency, not the preferred operational global feed: their current metadata does not mark them as ongoing. A production catalog must never present an archival AMSR2 day as contemporary.

## Conservative fusion rules

- IMS overrides the global categorical analysis wherever it supplies a valid class. Accepted OSI SAF concentration then supersedes that ice-presence classification over ocean.
- The global analysis fills the Southern Hemisphere and IMS class `0` (outside coverage).
- VIIRS can add or remove snow only on a one-pixel analysis boundary and only at quality `>= 0.9`.
- Cloud, darkness, staleness, missing retrievals, or low quality leave the trusted analysis unchanged.
- VIIRS never changes sea ice in this stage.
- A daily state needs either the global snow/ice pair or an accepted Northern Hemisphere IMS analysis. Optional concentration retains its own day, no later than the selected analysis and at most one day older.
- The publisher never regresses an analysis day. A changed processing version may replace the same day once to correct processing without falsifying observation time.

## Producer input and publication

Provider adapters prepare two-dimensional NumPy arrays on the bundle’s north-up, `[-180, 180] × [-90, 90]` grid:

- IMS integer class grid (`0…4`), optional when IMS is late;
- global snow fraction and sea-ice fraction grids (`0…1`);
- optional VIIRS snow fraction plus an equally sized quality grid (`0…1`).

The catalog passed to `npm run publish:cryosphere` records each candidate’s product, valid and production times, version, attribution, geographic coverage, array URL, and—on VIIRS—the quality-array URL. GMASI candidates use `gmasi-snow` and `gmasi-sea-ice`; the contingency uses `amsr2-snow` and `amsr2-sea-ice`.

```sh
python3 -m venv .venv-cryosphere
.venv-cryosphere/bin/pip install -r requirements-cryosphere.txt

npm run publish:cryosphere -- \
  --catalog artifacts/cryosphere-catalog.json \
  --python .venv-cryosphere/bin/python \
  --output artifacts/earth-state
```

The compositor emits distinct snow and sea-ice textures plus complete provenance. By default the producer inherits the output directory's current atomic bundle (or the packaged baseline on first publication); `--base-manifest` can intentionally override that choice. The cloud producer follows the same rule, so their independent schedules preserve one another's layers. The ordinary Earth-state publisher verifies every byte and advances `latest.json` only after the full bundle—including cloud, snow, sea ice, sky, and static layers—passes validation and read-back.

The provider adapter, scheduler, stable HTTPS origin, and client configuration are documented in [`live-feed-deployment.md`](live-feed-deployment.md); `npm run build:cryosphere-catalog` produces the catalog described above from the delivered IMS, GMASI (or AMSR2 contingency), and VIIRS products. This repository deliberately keeps provider credentials and bulk scientific formats server-side; browsers and Tauri only receive small render-ready immutable textures.
