# Live Earth data for TheMarble

**Research date:** 2026-08-25  
**Scope:** A scientifically grounded, photorealistic Earth for a Tauri application and a website: current clouds, daily snow and sea ice, seasonal land, explicit timestamps, and resilient delivery.

## Executive answer

Yes—TheMarble can look meaningfully current every day, and its clouds can usually be roughly one to three hours old, with faster delivery possible when a source publishes promptly. It cannot truthfully be a single, simultaneous, cloud-free photograph of the whole planet. No sensor produces that image:

- geostationary satellites observe most of the inhabited latitudes frequently, but not the poles, and their images come from several different viewpoints;
- polar-orbiting satellites cover the globe in swaths collected at different times, with gaps, cloud obstruction, and darkness;
- visible-light terrain cannot be observed through clouds or on the night side;
- snow, sea ice, land color, and clouds are different physical products with different observation times and resolutions.

The best result is therefore a **layered Earth-state visualization**, not a literal snapshot:

1. a sharp, cloud-free seasonal surface;
2. an hourly observation-led cloud layer with per-pixel acquisition age;
3. a daily analyzed snow/sea-ice layer;
4. a forecast/model fill only where observations are missing or stale;
5. a small provenance display that says exactly what the viewer is seeing.

The recommended production pipeline is:

- **surface:** NASA Blue Marble Next Generation monthly imagery initially, later refined with a rolling MODIS/VIIRS clear-pixel composite;
- **clouds, first production version:** NOAA GMGSI, an operational hourly mosaic of GOES, Meteosat, and Himawari visible/infrared imagery, with polar gaps filled separately;
- **clouds, advanced version:** NASA SatCORPS Global Cloud Composite (hourly, 3 km) after an availability soak test, using cloud mask, optical depth, reflectance, cloud-top height, and relative observation time;
- **cloud fallback:** NOAA GFS total-cloud-cover fields only in areas or periods without fresh satellite observations, visibly identified as model-assisted;
- **snow/ice:** daily U.S. National Ice Center IMS in the Northern Hemisphere, augmented by VIIRS detail and a global/southern fallback such as NOAA GMASI;
- **delivery:** a scheduled server-side compositor publishes immutable, timestamped 8K textures plus a compact manifest to object storage/CDN; both the web app and Tauri app consume the same bundle and retain the last known good bundle.

This architecture is practical, legally cleaner than Google imagery, and much more truthful than calling a single composited texture “live.”

## What Google actually does

Google does **not** maintain a daily current terrain photograph for the globe.

Google Earth Help explicitly says its imagery is **not real time** and is collected over time. A displayed location can be a mosaic of images captured over multiple days or months, so Google may show a date range rather than one acquisition time. [Google Earth Help: imagery dates](https://support.google.com/earth/answer/6327779?hl=en)

Google described its zoomed-out global surface as a cloud-free Landsat mosaic assembled from many observations. Its 2013 account says it processed hundreds of terabytes of USGS/NASA Landsat 7 data, selected imagery across many acquisitions, removed clouds, and blended the result into a global mosaic. [Google: Only clear skies on Google Maps and Earth](https://blog.google/products-and-platforms/products/earth/only-clear-skies-on-google-maps-and/)

Google’s 2024 imagery update describes using Cloud Score+ to remove clouds, cloud shadows, haze, and mist while retaining real ice, snow, and mountain shadows. That is a better cloud-free basemap, not a claim that terrain is refreshed daily. [Google: three imagery updates](https://blog.google/products-and-platforms/products/earth/3-imagery-updates-to-google-earth-and-maps/)

Google also explains that Maps and Earth imagery is a mosaic supplied by multiple providers and captured on different dates. Its stated refresh goals in 2020 ranged from about yearly for large cities to every two or three years elsewhere—not daily. [Google: how satellite images work](https://blog.google/products-and-platforms/products/maps/how-do-satellite-images-work/)

Google’s separate animated-cloud layer is closer to the design proposed here. Official documentation says it shows the previous 24 hours, updates hourly or when new data is available, may reuse the most recent complete data, has gaps and irregularities, and lacks polar cloud data. [Google Earth: see clouds](https://developers.google.com/maps/documentation/earth/see-clouds)

### What may and may not be copied from Google

The useful lesson is architectural: **cloud-free, multi-date surface plus a separate recent cloud layer**. The imagery itself is not reusable as TheMarble’s texture pipeline.

Google’s Map Tiles policies prohibit prefetching, indexing, storing, or caching tiles beyond limited protocol-compliant caching, and prohibit extracting Google data for other uses. Satellite tiles also require a billed project, API key, and session token. [Map Tiles API policies](https://developers.google.com/maps/documentation/tile/policies?hl=en) [Satellite tiles documentation](https://developers.google.com/maps/documentation/tile/satellite)

There is an additional local constraint: Google says Map Tiles API satellite 2D and photorealistic 3D tiles are unavailable to certain projects billed in the European Economic Area under the post–8 July 2025 terms. [Google Maps Platform EEA changes](https://developers.google.com/maps/comms/eea/map-tiles?hl=en)

Google has not documented the complete internal production pipeline for its current globe imagery. Any claim that Google uses a particular undocumented daily snow or terrain-refresh system would therefore be inference. What is validated is narrower: the global surface is a cloud-cleared, multi-date mosaic, while animated clouds are a separate, hourly layer.

## The physical limits of a “current Earth”

A realistic product needs to distinguish four time concepts:

- **observation time:** when a satellite actually viewed a pixel;
- **valid time:** when an analysis or forecast represents conditions;
- **production time:** when the provider created the product;
- **retrieval time:** when TheMarble ingested it.

These differ. A global cloud composite labeled `14:00Z` may include pixels observed minutes before or after that nominal time. A daily snow analysis may be valid at `00:00Z` but incorporate observations from a preceding window. A “daily” surface-reflectance product can be a clear-pixel synthesis rather than an instantaneous picture.

There are also unavoidable visual compromises:

- “true color” on the night side is impossible; the renderer should show darkness and city lights, not brighten invisible terrain;
- thin cloud, cloud over snow, and polar darkness are difficult classification problems;
- a global equirectangular texture oversamples the poles and undersamples local detail;
- geostationary observations become increasingly oblique toward the limb and do not adequately cover polar regions;
- interpolating between two cloud frames makes motion attractive, but intermediate frames are an animation, not new observations.

The goal should be **observation-led and temporally explicit**, rather than claiming an impossible instantaneous photograph.

## Primary-source data assessment

| Layer | Best practical source | Cadence / latency | Native scale and coverage | What it really represents | Access and use in TheMarble |
|---|---|---|---|---|---|
| Seasonal surface | NASA Blue Marble Next Generation | 12 monthly composites, based on 2004 observations | Up to 500 m tiled; global | Cloud-free monthly surface with seasonal vegetation and snow | Public NASA download; excellent bundled baseline; old, so never label current |
| Rolling land surface | MODIS MCD43A4 NBAR or VIIRS VNP09GA | Daily product; MCD43A4 uses a 16-day retrieval window | 500 m global land | Atmospherically corrected, clear-pixel/BRDF-normalized surface—not a same-day photo | Raw products may require Earthdata Login; process on server and publish derivative textures |
| Operational cloud imagery | NOAA GMGSI | Hourly in the public NOAA cloud bucket; official product pages quote 2–3 h latency | Near-global, roughly 60–71°N/S depending product generation; current files are a 5000 × 3000 lon/lat grid, about 8 km at the equator | Harmonized visible, shortwave IR, longwave IR, and water-vapor imagery; not retrieved cloud microphysics | No-account public S3; straightforward server-side NetCDF ingest; strongest Phase 1 backbone |
| Advanced cloud properties | NASA SatCORPS Global Cloud Composite | Hourly; near real time | 3 km; global product | Harmonized GEO + LEO cloud mask and physical properties, including per-pixel relative time | Early-access product; server-side NetCDF/ArcGIS ingestion; validate operational reliability before sole-source use |
| Direct GEO cloud inputs | GOES-18/19, Meteosat-12, Himawari-9 | Full disk generally every 10 minutes | Approx. 0.5–2 km by spectral band; regional viewpoints | High-frequency observation; requires calibration, reprojection, harmonization, and limb handling | NOAA is open; EUMETSAT requires registration/licence handling; JMA’s raw operational access is constrained |
| Model cloud fill | NOAA GFS | Four runs per day, every six hours | 0.25° global | Forecast/analysis cloud fraction, not an image | Open NOAA object storage; GRIB processing required; use only as disclosed gap fill |
| Northern snow/ice | U.S. National Ice Center IMS | Daily, approximately 00Z | 1 km, 4 km, 24 km; Northern Hemisphere | Analyst-integrated snow and ice extent from many satellite and ancillary sources | GeoTIFF/NetCDF/GRIB/ASCII; good daily authoritative mask |
| Detailed optical snow | NASA/NOAA VIIRS snow | Near-real-time swaths/daily; product dependent | 375 m snow; global swaths | Observed snow where daylight and cloud screening permit | High detail but incomplete under clouds/night; merge rather than use alone |
| Global snow fallback | NOAA GMASI | Daily | Approx. 2 km; global, gap-filled | Automated multisensor snow/ice analysis | Suitable for southern/global fallback; lower detail and different semantics from IMS |
| Sea ice detail | MODIS/VIIRS sea-ice products | Daily/NRT | Approx. 1 km MODIS, 750 m VIIRS | Optical or multisensor ice classification | Cloud/daylight limitations; combine with analyzed products |

### Surface imagery

NASA Blue Marble Next Generation provides twelve cloud-free monthly global composites with seasonal change at up to 500 m resolution. It is an ideal stable baseline and offline fallback. NASA documents known artifacts: finding cloud-free tropical pixels is difficult, short-lived snow can be confused with cloud, some open water is noisy, and deep ocean was made visually uniform. [NASA Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/) [Blue Marble base-map downloads](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/)

For a more current land surface, MCD43A4 provides daily nadir BRDF-adjusted reflectance at 500 m, but each result is based on a 16-day retrieval window and is associated with the ninth day of that window. It is a rolling best estimate of surface reflectance, not “today’s photograph.” [MCD43A4 product catalog](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MCD43A4)

VIIRS VNP09GA NRT is a daily 500 m/1 km surface-reflectance product that combines available observations and applies atmospheric corrections and cloud screening. It is useful for a rolling clear-pixel mosaic, but night, ocean, cloud, and missing observations create fill values. [NASA VNP09GA NRT](https://www.earthdata.nasa.gov/data/catalog/lancemodis-vnp09ga-nrt-1)

The right product language is therefore “seasonal surface” or “rolling clear-surface composite,” accompanied by the contributing observation window—not “live terrain.”

### Clouds

#### Recommended operational starting point: NOAA GMGSI

NOAA’s Global Mosaic of Geostationary Satellite Imagery (GMGSI) is the most practical Phase 1 backbone discovered in this research. NOAA composites GOES-East, GOES-West, Himawari-9, and Meteosat into near-global visible, shortwave-infrared, longwave-infrared, and water-vapor images. The public NOAA Open Data Dissemination bucket updates hourly, requires no AWS account, and permits public use with attribution requested. [NOAA GMGSI open-data registry](https://registry.opendata.aws/noaa-gmgsi/)

The current public NetCDF files are already on a regular longitude/latitude grid, avoiding the hardest part of direct five-satellite ingestion. A sampled current file is 5000 × 3000 at about 0.0722° spacing—roughly 8 km per pixel at the equator—and extends to approximately ±72.7°. NOAA documentation is not fully consistent across generations: its operational training page describes approximately 8 km and valid data to about 71° north/south, while the current OSPO display page describes approximately 3 km and 60° north/south. TheMarble must treat the **actual NetCDF coordinate metadata and coverage mask as authoritative for each generation**, rather than hard-coding either claim. [NOAA operational GMGSI description](https://vlab.noaa.gov/web/towr-s/gmgsi) [NOAA OSPO GMGSI page](https://www.ospo.noaa.gov/products/imagery/gmgsi/)

GMGSI is operational and substantially simpler than SatCORPS, but it is spectral imagery rather than a Level-2 cloud-property retrieval. The visible band supplies attractive daytime cloud structure; longwave and shortwave infrared preserve clouds at night and help detect cloud/fog, but converting them into a realistic translucent white shell requires a documented rendering heuristic. The product itself does not provide cloud optical depth or cloud-top height.

Its latency also needs measured rather than assumed. NOAA’s OSPO page says two to three hours, while spot checks of the public bucket can show newly created hourly files tens of minutes after nominal time. A week-long ingestion log should define the actual median and worst-case delivery. The UI should always use the file’s nominal/observation time, never the retrieval time, when stating cloud age.

Use GMGSI for the first live version, supplement latitude gaps with recent VIIRS/MODIS observations or disclosed GFS model fill, and retain the newest complete global frame if the next file is incomplete.

#### Advanced physical cloud source: NASA SatCORPS

NASA’s SatCORPS Global Cloud Composite is the strongest single scientific candidate. NASA says the system merges MODIS/VIIRS with five geostationary platforms—including GOES, Meteosat, and Himawari—into hourly, global 3 km cloud products. Available variables include cloud mask, optical depth, phase, cloud-top/bottom/effective height, visible reflectance, relative observation time, satellite identifier, viewing geometry, water path, and emittance. [NASA Earthdata: global cloud composite](https://www.earthdata.nasa.gov/about/nasa-support-snwg/solutions/radiation-clouds) [SatCORPS product and parameter documentation](https://satcorps.larc.nasa.gov/GCC-SNWG-v2.html)

The service is marked “Early Access” and offers near-real-time Version 2 products through its product explorer/download service. It should be tested continuously for several weeks before TheMarble depends on it as its only operational source. [SatCORPS Global Cloud Composite](https://satcorps.larc.nasa.gov/new/products/global-cloud-composite/index.html)

SatCORPS’s **relative-time field** is especially valuable: it enables a real per-pixel age/quality map rather than presenting every texel as if observed simultaneously. NASA also exposes rolling composite fields through an Earthdata ArcGIS ImageServer. [NASA Earthdata SatCORPS rolling ImageServer](https://gis.earthdata.nasa.gov/image/rest/services/C96176-EAP-SATCORPS/REGCOMP_HOURLY_ROLLING/ImageServer)

If SatCORPS proves unreliable, the more operationally controlled path is to ingest the constituent geostationary systems directly. NOAA says GOES East/West normally provide full-disk scans every ten minutes; ABI spectral channels range from 0.5 km visible to 2 km infrared. NOAA’s cloud-hosted GOES data is publicly accessible and new files appear as they become available. [NOAA GOES scan schedules](https://www.nesdis.noaa.gov/our-satellites/currently-flying/goes-east-west/goes-schedules-and-scan-sectors) [NOAA ABI channel resolution](https://www.star.nesdis.noaa.gov/goes/abispectralattributes.php) [NOAA GOES open data](https://registry.opendata.aws/noaa-goes/)

EUMETSAT says Meteosat-12 scans the full disk every ten minutes with 16 channels and roughly 0.5–2 km sampling. Access through the EUMETSAT Data Store requires registration; individual products can require licence acceptance, attribution, and operational-account handling. [EUMETSAT Meteosat series](https://www.eumetsat.int/our-satellites/meteosat-series) [EUMETSAT registration and licensing](https://user.eumetsat.int/resources/user-guides/data-registration-and-licensing)

JMA says Himawari full-disk imagery is produced every ten minutes, with 0.5–2 km native sampling depending on band. Its HimawariCloud service is intended for national meteorological and hydrological services, while lower-grade public distribution is less suitable for a production globe. [JMA HimawariCloud](https://ds.data.jma.go.jp/mscweb/en/himawari89/cloud_service/cloud_service.html) [JMA data dissemination service](https://www.data.jma.go.jp/mscweb/en/himawari89/JDDS_service/JDDS_service.html)

Direct multi-satellite ingestion offers control but is a substantial remote-sensing system: calibrate products, unify cloud definitions, reproject different geostationary grids, select the best overlapping view, handle scan time, normalize day/night appearance, and supplement the poles. SatCORPS already performs much of this harmonization.

### Model-assisted cloud fill

NOAA’s Global Forecast System publishes a 0.25° global model four times per day at 00, 06, 12, and 18 UTC, with analyses and forecasts in GRIB2. It is available through NOAA’s open cloud-data program. [NCEP GFS product inventory](https://www.nco.ncep.noaa.gov/pmb/products/gfs/) [NOAA GFS open data](https://registry.opendata.aws/noaa-gfs-bdp-pds/)

GFS can prevent holes when an observed cloud field is stale, missing, or unavailable near the poles. It should never be made visually indistinguishable in the provenance layer: the manifest must say `model-assisted`, include the model run and forecast hour, and retain a coverage fraction for actual observations.

### Snow and sea ice

The U.S. National Ice Center publishes daily Interactive Multisensor Snow and Ice Mapping System (IMS) files for the Northern Hemisphere at 1, 4, and 24 km. The NOAA service describes a daily update around 00 UTC and an analysis assembled from SAR, GOES, VIIRS, other optical/infrared imagery, stations, radar, and forecast information, prioritized by recency and quality. [USNIC IMS data](https://usicecenter.gov/Products/ImsData) [NOAA IMS 1 km service](https://mapservices.weather.noaa.gov/raster/rest/services/obs/usnic_ims_snow_ice_1km/ImageServer)

IMS is an analyzed extent mask, not a color photograph or snow-depth measurement. The NSIDC archive warns that operational web delivery and timeliness are not guaranteed and should not be used for safety-critical operations. [NSIDC IMS archive](https://nsidc.org/data/g02156/versions/1)

VIIRS can add sharper observed snow boundaries at 375 m, but optical retrievals have holes under cloud and in polar darkness. NASA’s NRT catalog identifies VNP10_NRT as a global 375 m, six-minute swath product. [NASA VIIRS NRT snow](https://www.earthdata.nasa.gov/data/catalog/lancemodis-vnp10-nrt-2)

For the Southern Hemisphere and as a gap-free fallback, NOAA’s Global Multisensor Automated Snow/Ice Map (GMASI) is a daily global product at approximately 2 km, derived from AVHRR and microwave observations. [NOAA snow products](https://www.ospo.noaa.gov/products/land/snow.html) [NCEI GMASI metadata](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc%3AC01696)

NASA GIBS also publishes daily/NRT MODIS snow and sea-ice visualization layers, including 500 m NDSI snow and 1 km sea ice. They are excellent for development and visualization, though cloud and daylight constraints remain. [MODIS Terra NDSI snow metadata](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/MODIS_Terra_NDSI_Snow_Cover.json) [MODIS Aqua sea-ice metadata](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/MODIS_Aqua_Sea_Ice.json)

### NASA GIBS as a fast integration path

NASA’s Global Imagery Browse Services exposes standards-compliant WMTS, WMS, TWMS, and XYZ endpoints in geographic and projected coordinate systems, including time dimensions. Its catalog contains more than a thousand daily and subdaily layers; many LANCE near-real-time visualizations are available within about 3.5 hours, while standard products often arrive later. NASA warns that the current date can be empty or incomplete while acquisition and processing are still underway. [GIBS access basics](https://nasa-gibs.github.io/gibs-api-docs/access-basics/) [GIBS available visualizations](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/)

GIBS is the quickest way to prototype dated global overlays without building every raw-product reader. A server-side pipeline is still preferable for TheMarble’s production textures: it guarantees stable formats, applies quality rules consistently, avoids client fan-out, and keeps the web and Tauri renderers identical. Large-volume users should observe GIBS’s published usage guidance and coordinate sustained bulk retrievals. [GIBS map-library and usage guidance](https://nasa-gibs.github.io/gibs-api-docs/map-library-usage/)

NASA Earth science data is generally open; NASA-led mission data is normally CC0 unless marked otherwise, while third-party datasets preserve their own terms. NASA requests acknowledgement of GIBS/ESDIS imagery. [NASA Earthdata data-use policy](https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy) [NASA GIBS acknowledgement](https://nasa-gibs.github.io/gibs-api-docs/)

## Recommended production architecture

### 1. Scheduled server-side compositor

Do not make every browser or Tauri client download NetCDF, GRIB, or dozens of sensor tiles. Run a scheduled ingestion/compositing job that:

1. discovers the newest complete products;
2. validates timestamps, coverage, and expected dimensions;
3. reprojects sources to a shared geographic/equirectangular grid;
4. constructs surface, snow/ice, cloud optical-depth/alpha, cloud-height, and data-age textures;
5. writes immutable, time-keyed files;
6. atomically updates a small `latest.json` only after the whole bundle passes validation.

Publish to an object store/CDN. Both app variants download the same manifest and assets. The Tauri build retains the last two successful bundles plus a bundled offline baseline.

An initial **8192 × 4096** global cloud texture is close to the useful information content of a 3 km product: at the equator it is roughly 4.9 km per texel. A **16384 × 8192** texture is roughly 2.4 km per texel and is appropriate for capable desktop GPUs, but should be tiled or GPU-compressed (for example KTX2/Basis) rather than shipped uncompressed. Surface detail can use higher-resolution tiles near the camera without forcing every device to hold a giant global texture.

### 2. Surface construction

- Begin with the twelve Blue Marble monthly surfaces and interpolate adjacent months slowly through the year.
- Apply the daily snow/ice mask independently so snow extent can change without rebuilding the land basemap.
- In a later phase, replace or blend land areas with a rolling MCD43A4/VNP09GA clear-pixel composite.
- Store a per-pixel age or contributing-window texture if the rolling surface is presented as current.
- Preserve a fixed, visually clean ocean shader rather than treating noisy satellite ocean color as high-resolution terrain.

This avoids the grainy “clouds baked into terrain” problem: the surface layer is explicitly cloud-cleared; all clouds live above it.

### 3. Cloud construction and rendering

For the advanced renderer, use SatCORPS fields as follows:

- cloud mask defines coverage;
- optical depth controls opacity and self-darkening;
- visible reflectance controls cloud brightness on the sunlit side;
- cloud phase can tune scattering/brightness for ice versus liquid cloud;
- cloud-top/effective height produces a height map or two to three altitude bands;
- relative observation time becomes a per-pixel age/quality texture;
- satellite ID/view geometry can help reject poor limb observations.

In Phase 1, derive cloud coverage and brightness from GMGSI visible and IR imagery, using the IR channels to keep cloud structure through the night. In Phase 2, replace those heuristics with the SatCORPS physical fields above. Where satellite pixels are absent or older than a chosen threshold—initially two to three hours—blend in GFS cloud fraction and mark those pixels as model-assisted. Use VIIRS/MODIS polar observations where available before falling back to the model.

The renderer should:

- place clouds on a slightly larger shell, with displacement exaggerated only enough to remain visible at globe scale;
- compute cloud shadow displacement from cloud height and the actual Sun vector, not a constant UV offset;
- darken the underlying surface according to cloud optical depth while retaining soft penumbra;
- light clouds with the same solar ephemeris as the planet;
- suppress visible-white cloud on the night side except for physically plausible moonlight or lightning if later added;
- crossfade two completed hourly composites over a few minutes to avoid popping.

The crossfade is a visual interpolation. The UI should continue showing the timestamps of the bounding observations rather than inventing an intermediate observation time.

### 4. Snow and ice construction

- Use daily IMS 1 km as the Northern Hemisphere extent authority.
- Refine recent sunlit, cloud-free edges with VIIRS 375 m snow where confidence is high.
- Use GMASI or VIIRS/microwave-derived products for the Southern Hemisphere and global fallback.
- Treat sea ice separately from snow-covered land so ocean shading, roughness, and seasonal breakup can be rendered correctly.
- Crossfade over a short period when a new daily mask arrives, but display the actual analysis valid time.

Snow/ice extent should modify albedo and roughness; it should not be pasted as a bright, unshaded white decal. Cloud-over-snow ambiguity and polar darkness should be represented in the quality metadata.

### 5. Manifest, caching, and fallback behavior

Every bundle should include fields such as:

```json
{
  "source": "NASA SatCORPS GCC V2",
  "dataset_version": "2",
  "observation_start": "2026-08-25T13:30:00Z",
  "observation_end": "2026-08-25T14:30:00Z",
  "valid_at": "2026-08-25T14:00:00Z",
  "produced_at": "2026-08-25T14:42:00Z",
  "retrieved_at": "2026-08-25T14:48:00Z",
  "coverage_fraction": 0.93,
  "fallback": "GFS model-assisted 7%",
  "model_run": "2026-08-25T12:00:00Z",
  "forecast_hour": 2
}
```

Recommended update policy:

- poll the GMGSI bucket every 10–15 minutes and publish a validated global bundle once per hour; later apply the same cadence to SatCORPS;
- keep the last known good observed cloud bundle when a publication is late;
- after two to three hours, add or expand the disclosed GFS fill instead of freezing unmarked old clouds;
- ingest snow/ice once daily after the new analysis appears;
- update a rolling land composite daily or weekly, while the monthly seasonal baseline remains available;
- never replace `latest.json` with a partially built bundle;
- if all live sources fail, show the last good bundle with a stale label, then a bundled climatological/static fallback rather than a blank globe.

### 6. Quiet but truthful provenance UI

The corner-hover text requested for TheMarble is enough. It could read:

> Clouds · NOAA GMGSI · valid 14:00Z · 48 min old · observed to 72°N/S / polar GFS-assisted  
> Snow & ice · USNIC IMS + VIIRS · valid 00:00Z  
> Land · MODIS NBAR · 16-day window centered 20 Aug 2026

If the current frame is interpolated, stale, or using a fallback, say so. This small disclosure is what lets the visual be both jewel-like and scientifically defensible.

## Web, Tauri, access, and licensing implications

- **NASA GIBS:** no-key standards-based imagery service and a good prototype source. Direct browser use is demonstrated in NASA client examples, but production should still verify current CORS behavior rather than treat it as a contractual guarantee. Bulk limits apply. Some raw Earthdata products require Earthdata Login.
- **NOAA GMGSI:** operational, no-account public S3 NetCDF and the cleanest first live-cloud feed. It is spectral imagery, not Level-2 cloud mask/optical-depth/height data; file coordinate metadata must govern resolution and coverage.
- **NASA SatCORPS:** early-access NetCDF/ArcGIS source; use a backend worker. Its service maturity, product latency, retention, and schema stability require a soak test.
- **NOAA GOES/GFS:** public cloud buckets require no cloud account. Raw NetCDF/GRIB is unsuitable for direct globe rendering; process server-side. NOAA requests attribution.
- **USNIC IMS/NOAA GMASI:** suitable for scheduled backend retrieval. Monitor product publication rather than assuming a fixed wall-clock arrival.
- **EUMETSAT:** registration and product-specific licence acceptance/attribution may be necessary. This complicates a public client-only implementation, but not a compliant backend pipeline.
- **JMA:** do not depend on NMHS-oriented HimawariCloud access for a public application unless separate access is confirmed.
- **ECMWF, if used instead of GFS:** ECMWF Open Data is 0.25°, real-time forecast data under CC BY 4.0 with attribution and disclaimer requirements. Its total cloud cover is model-derived, not an observed image. [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data) [ECMWF total cloud cover definition](https://codes.ecmwf.int/grib/param-db/164)
- **Google:** do not extract or persist satellite tiles, and do not build the product around an API that is restricted for applicable EEA-billed projects.

## Phased implementation plan

Time ranges below are engineering magnitudes for one focused developer with the existing globe renderer, not commitments.

### Phase 0 — access and provenance spike (1–3 days)

- Define the manifest and stale/fallback rules first.
- Retrieve representative GMGSI, SatCORPS, GIBS, IMS, VIIRS, GMASI, and GFS files.
- Verify timestamps, retention, product completeness, credentials, CORS, licence/attribution text, and redistribution terms.
- Run GMGSI and SatCORPS discovery/download continuously to measure real latency, coverage, and outages.
- Decide whether SatCORPS is reliable enough for primary production use.

**Exit criterion:** a written source contract for every layer and a test bundle with auditable timestamps.

### Phase 1 — first live, honest Earth (about 1 week)

- Integrate the twelve Blue Marble monthly surfaces.
- Add daily IMS snow/ice with VIIRS/GMASI fallback.
- Ingest the newest complete hourly GMGSI visible/IR mosaic, derive a conservative cloud alpha/brightness texture, and fill its polar gap from VIIRS/MODIS or disclosed GFS data.
- Publish through the scheduled pipeline with `latest.json`, last-known-good caching, and provenance hover text.

**Result:** an operational hourly cloud view that is clean, seasonal, global after disclosed fill, and honest about age; cloud height and optical depth remain approximate.

### Phase 2 — live observation-led clouds (about 1–2 weeks)

- Ingest SatCORPS hourly cloud mask, optical depth, reflectance, top height, and relative-time fields.
- Add GFS fill for stale/missing areas and polar gaps.
- Generate height/age/quality textures.
- Implement smooth hourly crossfades and height-aware solar shadows.
- Add monitoring for latency, observed coverage, and fallback percentage.

**Result:** clouds normally within one or two hours of reality, with physically meaningful thickness, height, illumination, and shadowing.

### Phase 3 — living surface and polish (about 1–2+ weeks)

- Build the rolling clear-pixel MCD43A4/VNP09GA land composite.
- Track surface age/contributing window.
- Separate sea ice, land snow, ocean, and city-light rendering.
- Add 8K/16K GPU-compressed delivery and resolution tiers.
- Tune atmospheric scattering, terminator, cloud phase, exposure, and fallback transitions against reference imagery.

**Result:** a surface that changes seasonally and incrementally without baking current clouds into the terrain.

### Phase 4 — optional direct-sensor operations

- Replace or supplement early-access SatCORPS with direct GOES, Meteosat, and Himawari Level-2 ingestion.
- Add credentials/licence operations, calibration/version monitoring, multi-view seam selection, and polar LEO stitching.

This gives maximum control but creates an ongoing meteorological data-processing service. It is justified only if SatCORPS cannot meet availability or visual-quality needs.

## Recommendation

Build Phase 0 immediately, then ship Phases 1 and 2 before attempting a “daily terrain” rebuild. The largest visual gain will come from separating a sharp cloud-free seasonal surface from a genuinely recent, optically meaningful cloud shell—not from repeatedly replacing the land texture.

Use NOAA GMGSI as the first production cloud feed: it is operational, hourly, already mosaicked, and openly available. Then adopt SatCORPS as the preferred physical cloud feed **only after a soak test**. Its already-harmonized hourly 3 km cloud mask, optical depth, height, and per-pixel relative time fit TheMarble unusually well. Keep GFS strictly as a labeled gap fill. Use daily IMS plus VIIRS/GMASI for snow and sea ice. Preserve Blue Marble as the dependable seasonal/offline surface while a rolling clear-pixel land composite is developed.

The finished experience can reasonably claim:

> A scientifically grounded view of Earth: hourly observation-led clouds, daily snow and ice, and a seasonally current clear-surface composite—each shown with its real observation age.

It should not claim “a live photograph of Earth.” The more accurate description is also the more interesting one: TheMarble is a continuously reconstructed, transparent view of the planet as it is being observed.
