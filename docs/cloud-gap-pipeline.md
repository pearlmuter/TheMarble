# Honest global cloud completion

TheMarble completes each two-frame observed cloud sequence without pretending that every pixel came from a satellite. The completed visual texture has no blank polar cap or unknown geographic hole, while a paired provenance texture and manifest metadata retain the identity, age, quality, and areal fraction of every contributing source class.

## Source priority

Every pixel follows one fixed hierarchy:

1. an accepted pixel from the primary SatCORPS or GMGSI observation;
2. a recent, quality-accepted VIIRS or MODIS polar observation;
3. NOAA GFS total-cloud cover for the frame's exact valid hour;
4. the bundled static cloud texture.

GFS and static imagery can fill only pixels rejected or missing at all higher levels. They cannot repaint an eligible observation. A small one-sided feather extends higher-priority appearance across a source boundary to hide a hard seam, but the categorical source class remains unchanged and the provenance alpha records the native-source contribution after that visual feather.

The default acceptance thresholds are a maximum observation age of three hours, minimum observation quality of `0.72`, and a three-pixel seam feather. They are explicit command options and are copied into every completed manifest.

## Prepared provider inputs

The operational provider adapters expose a JSON catalog with a retrieval time and an array of candidates. Relative URLs are resolved from the catalog location.

```json
{
  "retrievedAt": "2026-08-27T14:20:00Z",
  "candidates": [
    {
      "product": "viirs-cloud",
      "validAt": "2026-08-27T14:00:00Z",
      "observedFrom": "2026-08-27T13:42:00Z",
      "observedTo": "2026-08-27T13:58:00Z",
      "producedAt": "2026-08-27T14:12:00Z",
      "version": "VNP02MOD-NRT-v2-adapter-1",
      "href": "./viirs-polar-1400.npz",
      "coverage": { "observedFraction": 0.18, "latitudeRange": [-90, 90] }
    },
    {
      "product": "gfs-total-cloud",
      "runAt": "2026-08-27T12:00:00Z",
      "forecastHour": 2,
      "validAt": "2026-08-27T14:00:00Z",
      "producedAt": "2026-08-27T12:45:00Z",
      "version": "GFS-0p25-v16-adapter-1",
      "href": "./gfs-tcc-f002.npy",
      "coverage": { "observedFraction": 1, "latitudeRange": [-90, 90] }
    }
  ]
}
```

The polar NPZ contains north-up equirectangular arrays named `appearance` (`H×W×2`, luminance and opacity), `density` (`H×W×3`), `quality` (`H×W`), and `age_seconds` (`H×W`, age at the candidate's declared `validAt`). The candidate valid time must be at or after its observation window. A polar mosaic cannot be backfilled into an earlier target; when it is used for a later frame, the elapsed time between its valid time and the target is added before freshness testing. The GFS NPY contains total-cloud fraction (`H×W`, `0…1`) for the candidate's exact valid hour. The compositor resamples these standardized grids to the primary observation grid. Catalog candidates may additionally declare `byteLength` and a SHA-256 `checksum`; the publisher verifies them when present.

## Publication

```sh
python3 -m venv .venv-cloud-gaps
.venv-cloud-gaps/bin/pip install -r requirements-cloud-gaps.txt

npm run publish:cloud-gaps -- \
  --catalog artifacts/cloud-gap-catalog.json \
  --python .venv-cloud-gaps/bin/python \
  --output artifacts/earth-state
```

The command derives from the output directory's current `latest.json`, so it completes whichever coherent two-frame observation bundle is current. `--base-manifest` is available for an intentional override. It emits cloud opacity, cloud density, and categorical provenance for both frames, retains SatCORPS cloud physics and per-pixel observation age when present, and then uses the ordinary content-addressed Earth-state publisher. `latest.json` advances only after all inherited and new assets pass checksum and read-back validation.

The provenance RGBA texture encodes static/GFS/primary/polar source class in red, normalized observation age in green, source quality in blue, and native contribution after seam feathering in alpha. Each frame's manifest reports area-weighted observed, model-assisted, and static-fallback fractions, the selected VIIRS/MODIS version and observation window, the exact GFS run and forecast hour, the fallback explanation, and the thresholds. The three fractions must cover the globe and sum to one; no unknown class is publishable.

This stage makes coverage complete and honest. It does not make GFS pixels into observations, and it does not remove the latency or scan-time differences inherent in global satellite mosaics.
