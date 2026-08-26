#!/usr/bin/env python3
"""Conservative daily snow/sea-ice fusion for pre-reprojected source rasters.

IMS class semantics are fixed by the USNIC/NSIDC product contract:
0 outside coverage, 1 open water, 2 snow-free land, 3 sea/lake ice,
4 snow-covered land. VIIRS is evidence for recent, sunlit, clear edge
refinement only; it is never permitted to modify a low-quality pixel.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


SOURCE_NONE = np.uint8(0)
SOURCE_GLOBAL_FALLBACK = np.uint8(1)
SOURCE_IMS = np.uint8(2)
SOURCE_VIIRS = np.uint8(3)
QUALITY_DARK = np.float32(0)
MIN_VIIRS_QUALITY = np.float32(0.9)


def _require_same_shape(reference, value, name):
    if value.shape != reference.shape:
        raise ValueError(f"{name} dimensions disagree with IMS grid")


def _boundary(mask):
    """Return one-pixel internal/external boundary without wrapping at the seam."""
    result = np.zeros(mask.shape, dtype=bool)
    vertical = mask[1:, :] != mask[:-1, :]
    horizontal = mask[:, 1:] != mask[:, :-1]
    result[1:, :] |= vertical
    result[:-1, :] |= vertical
    result[:, 1:] |= horizontal
    result[:, :-1] |= horizontal
    return result


def compose_cryosphere(
    ims_classes,
    fallback_snow,
    fallback_sea_ice,
    viirs_snow=None,
    viirs_quality=None,
):
    """Fuse trusted analyses and optional VIIRS edge evidence.

    Returns snow and sea-ice fractions plus their independent per-pixel source codes.
    All inputs must already use the bundle's EPSG:4326 equirectangular grid.
    """
    ims = np.asarray(ims_classes, dtype=np.uint8)
    fallback_snow_values = np.asarray(fallback_snow, dtype=np.float32)
    fallback_sea_ice_values = np.asarray(fallback_sea_ice, dtype=np.float32)
    snow_available = np.isfinite(fallback_snow_values)
    sea_ice_available = np.isfinite(fallback_sea_ice_values)
    snow = np.clip(np.nan_to_num(fallback_snow_values, nan=0.0), 0, 1).copy()
    sea_ice = np.clip(np.nan_to_num(fallback_sea_ice_values, nan=0.0), 0, 1).copy()
    _require_same_shape(ims, snow, "fallback snow")
    _require_same_shape(ims, sea_ice, "fallback sea ice")

    covered = np.isin(ims, [1, 2, 3, 4])
    snow[covered] = (ims[covered] == 4).astype(np.float32)
    sea_ice[covered] = (ims[covered] == 3).astype(np.float32)
    snow_source = np.where(snow_available, SOURCE_GLOBAL_FALLBACK, SOURCE_NONE).astype(np.uint8)
    sea_ice_source = np.where(sea_ice_available, SOURCE_GLOBAL_FALLBACK, SOURCE_NONE).astype(np.uint8)
    snow_source[covered] = SOURCE_IMS
    sea_ice_source[covered] = SOURCE_IMS

    if viirs_snow is None and viirs_quality is None:
        return snow, sea_ice, snow_source, sea_ice_source
    if viirs_snow is None or viirs_quality is None:
        raise ValueError("VIIRS snow and quality must be supplied together")
    viirs = np.clip(np.asarray(viirs_snow, dtype=np.float32), 0, 1)
    quality = np.clip(np.asarray(viirs_quality, dtype=np.float32), 0, 1)
    _require_same_shape(ims, viirs, "VIIRS snow")
    _require_same_shape(ims, quality, "VIIRS quality")

    # Optical evidence can sharpen a boundary, but cannot repaint a stable
    # interior or act where cloud, darkness, age, or retrieval quality is poor.
    refinable = _boundary(snow >= 0.5) & (quality >= MIN_VIIRS_QUALITY)
    snow[refinable] = viirs[refinable]
    snow_source[refinable] = SOURCE_VIIRS
    return snow, sea_ice, snow_source, sea_ice_source


def _load_array(path, name):
    values = np.load(path, allow_pickle=False)
    if values.ndim != 2:
        raise ValueError(f"{name} must be a two-dimensional NumPy array")
    return values


def _texture(fraction, source):
    confidence = np.where(source == SOURCE_NONE, 0.0, np.where(source == SOURCE_IMS, 1.0, np.where(source == SOURCE_VIIRS, .92, .72)))
    return np.stack([
        np.clip(fraction, 0, 1),
        confidence,
        source.astype(np.float32) / float(SOURCE_VIIRS),
    ], axis=-1)


def compose_files(arguments):
    fallback_snow = _load_array(arguments.fallback_snow, "global fallback snow")
    fallback_sea_ice = _load_array(arguments.fallback_sea_ice, "global fallback sea ice")
    ims = np.zeros(fallback_snow.shape, dtype=np.uint8) if arguments.ims is None else _load_array(arguments.ims, "IMS classes")
    viirs = None if arguments.viirs_snow is None else _load_array(arguments.viirs_snow, "VIIRS snow")
    quality = None if arguments.viirs_quality is None else _load_array(arguments.viirs_quality, "VIIRS quality")
    snow, sea_ice, snow_source, sea_ice_source = compose_cryosphere(
        ims, fallback_snow, fallback_sea_ice, viirs, quality
    )
    Image.fromarray(np.clip(_texture(snow, snow_source) * 255, 0, 255).astype(np.uint8), mode="RGB").save(arguments.snow, optimize=True)
    Image.fromarray(np.clip(_texture(sea_ice, sea_ice_source) * 255, 0, 255).astype(np.uint8), mode="RGB").save(arguments.sea_ice, optimize=True)
    latitudes = 90.0 - (np.arange(ims.shape[0], dtype=np.float64) + .5) * (180.0 / ims.shape[0])
    weights = np.broadcast_to(np.cos(np.deg2rad(latitudes))[:, None], ims.shape)
    weighted_fraction = lambda mask: float(np.sum(mask * weights) / np.sum(weights))
    snow_coverage = {
        "observedFraction": weighted_fraction((ims != 0) | np.isfinite(fallback_snow)),
        "latitudeRange": [-90, 90],
        "fallbackFraction": weighted_fraction((ims == 0) & np.isfinite(fallback_snow)),
    }
    sea_ice_coverage = {
        "observedFraction": weighted_fraction((ims != 0) | np.isfinite(fallback_sea_ice)),
        "latitudeRange": [-90, 90],
        "fallbackFraction": weighted_fraction((ims == 0) & np.isfinite(fallback_sea_ice)),
    }
    Path(arguments.metadata).write_text(json.dumps({
        "validAt": arguments.valid_at,
        "producedAt": arguments.produced_at,
        "retrievedAt": arguments.retrieved_at,
        "sourceVersion": arguments.source_version,
        "dimensions": {"width": int(snow.shape[1]), "height": int(snow.shape[0])},
        "layers": {
            "snowCover": {"coverage": snow_coverage},
            "seaIce": {"coverage": sea_ice_coverage},
        },
        "fallback": arguments.fallback,
        "attribution": arguments.attribution,
    }, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ims")
    parser.add_argument("--fallback-snow", required=True)
    parser.add_argument("--fallback-sea-ice", required=True)
    parser.add_argument("--viirs-snow")
    parser.add_argument("--viirs-quality")
    parser.add_argument("--snow", required=True)
    parser.add_argument("--sea-ice", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--valid-at", required=True)
    parser.add_argument("--produced-at", required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--source-version", required=True)
    parser.add_argument("--fallback", required=True)
    parser.add_argument("--attribution", required=True)
    arguments = parser.parse_args()
    if (arguments.viirs_snow is None) != (arguments.viirs_quality is None):
        parser.error("--viirs-snow and --viirs-quality must be supplied together")
    compose_files(arguments)


if __name__ == "__main__":
    main()
