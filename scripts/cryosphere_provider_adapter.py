#!/usr/bin/env python3
"""Reproject daily snow/sea-ice provider products onto the Earth-state grid.

The publishing pipeline in `publish-cryosphere-earth-state.mjs` consumes
pre-reprojected arrays on the bundle's north-up, [-180, 180] x [-90, 90]
grid. This adapter is the provider side of that contract: it decodes one
delivered IMS, GMASI, AMSR2, or VIIRS product, resamples it onto that grid,
screens the optical retrieval, and reports the coverage it genuinely has.

Class semantics are never guessed. Every provider class must be declared in
the source plan, and an undeclared value fails the run instead of quietly
becoming bare ground.
"""

import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image


GLOBAL_BOUNDS = {
    "latitude_from": 90.0,
    "latitude_to": -90.0,
    "longitude_from": -180.0,
    "longitude_to": 180.0,
    "north_up": True,
}

# VIIRS VNP10 NDSI_Snow_Cover sentinels that can never carry a snow fraction.
VIIRS_NO_DECISION = 201
VIIRS_NIGHT = 211
VIIRS_INLAND_WATER = 237
VIIRS_OCEAN = 239
VIIRS_CLOUD = 250
VIIRS_SENTINELS = (VIIRS_NO_DECISION, VIIRS_NIGHT, VIIRS_INLAND_WATER, VIIRS_OCEAN, VIIRS_CLOUD)
# VNP10 Basic_QA: 0 best, 1 good, 2 ok, 3 poor; anything else is unusable.
VIIRS_QUALITY_BY_FLAG = {0: 1.0, 1: 0.9, 2: 0.5}
# USNIC/NSIDC IMS: 0 outside coverage, 1 open water, 2 snow-free land,
# 3 sea/lake ice, 4 snow-covered land.
IMS_CLASSES = (0, 1, 2, 3, 4)


def target_latitudes(height):
    return 90.0 - (np.arange(height, dtype=np.float64) + 0.5) * (180.0 / height)


def target_longitudes(width):
    return -180.0 + (np.arange(width, dtype=np.float64) + 0.5) * (360.0 / width)


def _bounds(source_bounds):
    resolved = dict(GLOBAL_BOUNDS)
    resolved.update(source_bounds or {})
    return resolved


def resample_regular(values, source_bounds, width, height, fill=0):
    """Nearest-cell resampling of a regular latitude/longitude source grid."""
    bounds = _bounds(source_bounds)
    source = np.asarray(values)
    if source.ndim != 2:
        raise ValueError("A regular provider grid must be two-dimensional")
    result = np.full((height, width), fill, dtype=source.dtype)

    latitude_span = bounds["latitude_from"] - bounds["latitude_to"]
    longitude_span = bounds["longitude_to"] - bounds["longitude_from"]
    if latitude_span <= 0 or longitude_span <= 0:
        raise ValueError("Provider grid bounds must describe a positive extent")

    row_fraction = (bounds["latitude_from"] - target_latitudes(height)) / latitude_span
    if not bounds["north_up"]:
        row_fraction = 1.0 - row_fraction
    rows_inside = (row_fraction >= 0.0) & (row_fraction < 1.0)

    longitudes = target_longitudes(width)
    if bounds["longitude_from"] >= 0.0:
        longitudes = np.mod(longitudes, 360.0)
    column_fraction = (longitudes - bounds["longitude_from"]) / longitude_span
    columns_inside = (column_fraction >= 0.0) & (column_fraction < 1.0)

    source_rows = np.clip((row_fraction * source.shape[0]).astype(np.int64), 0, source.shape[0] - 1)
    source_columns = np.clip((column_fraction * source.shape[1]).astype(np.int64), 0, source.shape[1] - 1)
    inside = np.outer(rows_inside, columns_inside)
    sampled = source[np.ix_(source_rows, source_columns)]
    result[inside] = sampled[inside]
    return result


def resample_scattered(values, latitudes, longitudes, width, height, aggregate):
    """Forward-bin an irregular source grid, such as IMS polar stereographic."""
    values = np.asarray(values).reshape(-1)
    latitudes = np.asarray(latitudes, dtype=np.float64).reshape(-1)
    longitudes = np.asarray(longitudes, dtype=np.float64).reshape(-1)
    if not (values.shape == latitudes.shape == longitudes.shape):
        raise ValueError("Scattered provider values, latitudes, and longitudes must share one shape")
    # The IMS grid is a square laid over a polar projection, so its corners fall
    # off the disc entirely and carry no coordinate. Clipping a NaN would deposit
    # those cells in a real target cell and invent an analysis there, so they are
    # dropped before any binning.
    located = np.isfinite(latitudes) & np.isfinite(longitudes)
    values = values[located]
    latitudes = latitudes[located]
    longitudes = longitudes[located]
    if values.size == 0:
        raise ValueError("Scattered provider delivered no located cells")
    if np.any(np.abs(latitudes) > 90.0) or np.any(np.abs(longitudes) > 180.0):
        raise ValueError("Scattered provider coordinates fall outside the globe")

    rows = np.clip(((90.0 - latitudes) / 180.0 * height).astype(np.int64), 0, height - 1)
    columns = np.clip(((longitudes + 180.0) / 360.0 * width).astype(np.int64), 0, width - 1)
    cells = rows * width + columns

    if aggregate == "mean":
        totals = np.zeros(height * width, dtype=np.float64)
        counts = np.zeros(height * width, dtype=np.int64)
        np.add.at(totals, cells, values.astype(np.float64))
        np.add.at(counts, cells, 1)
        result = np.zeros(height * width, dtype=np.float32)
        observed = counts > 0
        result[observed] = (totals[observed] / counts[observed]).astype(np.float32)
        return result.reshape(height, width)

    if aggregate != "mode":
        raise ValueError(f"Unsupported scattered aggregation: {aggregate}")
    classes = values.astype(np.int64)
    if np.any(classes < 0):
        raise ValueError("Scattered class values must be non-negative")
    class_count = int(classes.max()) + 1
    tally = np.zeros((height * width, class_count), dtype=np.int64)
    np.add.at(tally, (cells, classes), 1)
    winner = tally.argmax(axis=1)
    winner[tally.max(axis=1) == 0] = 0
    return winner.reshape(height, width).astype(values.dtype)


def require_classes(values, allowed, name):
    """Refuse a delivery whose values are not the declared class set.

    A rendered visualisation decodes as a smooth ramp rather than a handful of
    classes. Casting that to uint8 would publish symbology as if it were an
    analysis, so an undeclared value fails the run.
    """
    values = np.asarray(values)
    present = np.unique(values)
    undeclared = [int(value) for value in present if int(value) not in set(allowed)]
    if undeclared:
        raise ValueError(
            f"{name} delivered {len(present)} distinct values including {undeclared[:8]}, "
            f"which are not its declared classes {sorted(allowed)}; the endpoint is returning "
            "rendered symbology rather than the analysis"
        )
    return values.astype(np.uint8)


def map_classes(values, mapping, name):
    """Translate declared provider classes into fractions, refusing the undeclared."""
    declared = {int(key): float(value) for key, value in mapping.items()}
    values = np.asarray(values)
    present = np.unique(values)
    undeclared = [int(value) for value in present if int(value) not in declared]
    if undeclared:
        raise ValueError(f"{name} carries undeclared class values {undeclared}; declare them in the source plan")
    result = np.zeros(values.shape, dtype=np.float32)
    for value, fraction in declared.items():
        result[values == value] = np.float32(fraction)
    return result


def screen_viirs(ndsi, quality_flags):
    """Keep only recent, sunlit, clear, high-confidence VIIRS snow evidence."""
    ndsi = np.asarray(ndsi, dtype=np.float32)
    quality_flags = np.asarray(quality_flags)
    if ndsi.shape != quality_flags.shape:
        raise ValueError("VIIRS snow and quality grids must share one shape")

    usable = (ndsi >= 0.0) & (ndsi <= 100.0)
    for sentinel in VIIRS_SENTINELS:
        usable &= ndsi != np.float32(sentinel)

    quality = np.zeros(ndsi.shape, dtype=np.float32)
    for flag, confidence in VIIRS_QUALITY_BY_FLAG.items():
        quality[usable & (quality_flags == flag)] = np.float32(confidence)
    snow = np.where(quality > 0.0, np.clip(ndsi / 100.0, 0.0, 1.0), 0.0).astype(np.float32)
    return snow, quality


def observed_fraction(observed):
    """Area-weighted observed coverage; a polar row is not a quarter of the globe."""
    observed = np.asarray(observed, dtype=bool)
    weights = np.cos(np.deg2rad(target_latitudes(observed.shape[0])))
    weights = np.broadcast_to(weights[:, None], observed.shape)
    total = float(weights.sum())
    return float(weights[observed].sum() / total) if total > 0 else 0.0


def latitude_range(observed):
    """The latitude extent genuinely covered, as [south, north]."""
    observed = np.asarray(observed, dtype=bool)
    rows = np.flatnonzero(observed.any(axis=1))
    if rows.size == 0:
        raise ValueError("The provider grid has no observed pixels, so it claims no latitude range")
    height = observed.shape[0]
    north = 90.0 - float(rows[0]) * (180.0 / height)
    south = 90.0 - float(rows[-1] + 1) * (180.0 / height)
    return (round(south, 6), round(north, 6))


def read_ims_ascii(path):
    """Read the USNIC/NSIDC IMS ASCII grid: header lines, then one digit per cell."""
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    rows = []
    with opener(path, "rt", encoding="ascii") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or not stripped.isdigit():
                continue
            if rows and len(stripped) != len(rows[0]):
                continue
            rows.append(stripped)
    if not rows:
        raise ValueError(f"{path} contains no IMS grid rows")
    return np.array([[int(character) for character in row] for row in rows], dtype=np.uint8)


def read_raster(path):
    """Read one delivered single-band raster (GeoTIFF or PNG) as a 2-D array."""
    with Image.open(path) as image:
        array = np.array(image)
    if array.ndim == 3:
        if array.shape[2] < 1:
            raise ValueError(f"{path} carries no raster band")
        array = array[:, :, 0]
    if array.ndim != 2:
        raise ValueError(f"{path} is not a single-band raster")
    return array


def read_binary_grid(path, dtype, shape):
    """Read a raw binary coordinate grid, such as the IMS latitude and longitude
    files, which ship as flat little-endian floats with no header of any kind."""
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as handle:
        values = np.frombuffer(handle.read(), dtype=np.dtype(dtype))
    expected = int(np.prod(shape))
    if values.size != expected:
        raise ValueError(f"{path} holds {values.size} values, not the declared {expected}")
    return values.reshape(tuple(int(extent) for extent in shape))


def _load_grid(path):
    # A declared binary grid states its own dtype and shape, because a headerless
    # file cannot be asked for either.
    if isinstance(path, dict):
        if "dtype" in path or "shape" in path:
            return read_binary_grid(path["path"], path.get("dtype", "<f4"), path["shape"])
        return _load_grid(path["path"])
    path = Path(path)
    suffixes = [suffix.lower() for suffix in path.suffixes]
    if ".npy" in suffixes:
        return np.load(path)
    if ".asc" in suffixes or ".txt" in suffixes:
        return read_ims_ascii(path)
    if {".tif", ".tiff", ".png"}.intersection(suffixes):
        return read_raster(path)
    raise ValueError(f"Unsupported provider input format: {path}")


def close_resampling_gaps(values, rounds):
    """Fill target cells that forward binning left empty, from their nearest
    binned neighbour.

    A 24 km analysis binned onto a ~10 km grid lands in roughly one target cell
    in five, so the result is speckled even where the provider covered
    everything. Closing those holes is nearest-neighbour upsampling of the
    delivered analysis rather than new information, and it is bounded: after
    `rounds` steps nothing has travelled more than that many cells, so a
    hemispheric source stays hemispheric.

    Longitude wraps, because the grid meets itself at the antimeridian.
    Latitude does not, because the poles are not neighbours and Arctic ice must
    never leak onto Antarctica.
    """
    grid = np.asarray(values).copy()
    for _ in range(max(0, int(rounds))):
        empty = grid == 0
        if not empty.any():
            break
        candidate = np.zeros_like(grid)
        for vertical in (-1, 0, 1):
            for horizontal in (-1, 0, 1):
                if vertical == 0 and horizontal == 0:
                    continue
                shifted = np.roll(grid, horizontal, axis=1)
                if vertical != 0:
                    rolled = np.roll(shifted, vertical, axis=0)
                    # A row shifted in from beyond a pole is not a neighbour.
                    if vertical > 0:
                        rolled[:vertical, :] = 0
                    else:
                        rolled[vertical:, :] = 0
                    shifted = rolled
                candidate = np.where((candidate == 0) & (shifted > 0), shifted, candidate)
        grid = np.where(empty, candidate, grid)
    return grid


def _resample(source, plan, width, height):
    if plan["kind"] == "regular":
        return resample_regular(source, plan.get("bounds"), width, height, fill=plan.get("fill", 0))
    if plan["kind"] == "scattered":
        binned = resample_scattered(
            source,
            _load_grid(plan["latitudes"]),
            _load_grid(plan["longitudes"]),
            width,
            height,
            plan.get("aggregate", "mode"),
        )
        return close_resampling_gaps(binned, plan.get("closeGapRounds", 0))
    raise ValueError(f"Unsupported provider input kind: {plan['kind']}")


def _observed_mask(product, grid):
    if product == "ims-snow-ice":
        return grid > 0
    return np.ones(grid.shape, dtype=bool)


def adapt_source(source, width, height, output_directory):
    """Reproject one delivered product and describe it for the daily catalog."""
    grid = _resample(_load_grid(source["input"]["path"]), source["input"], width, height)
    semantics = source["semantics"]
    quality = None

    if semantics["type"] == "classes":
        values = require_classes(grid, semantics.get("allowed", IMS_CLASSES), source["product"])
    elif semantics["type"] == "class-map":
        values = map_classes(grid, semantics["map"], f"{source['product']} classes")
    elif semantics["type"] == "fraction":
        values = np.clip(np.asarray(grid, dtype=np.float32) * np.float32(semantics.get("scale", 1.0)), 0.0, 1.0)
    elif semantics["type"] == "viirs":
        quality_grid = _resample(_load_grid(semantics["quality"]["path"]), semantics["quality"], width, height)
        values, quality = screen_viirs(grid, quality_grid)
    else:
        raise ValueError(f"Unsupported provider semantics: {semantics['type']}")

    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)
    key = source.get("key", source["product"])
    array_path = output_directory / f"{key}.npy"
    np.save(array_path, values)
    observed = _observed_mask(source["product"], grid) if quality is None else quality > 0.0

    product = {
        "product": source["product"],
        "key": key,
        "validAt": source["validAt"],
        "producedAt": source["producedAt"],
        "version": source["version"],
        "arrayPath": array_path.name,
        "coverage": {
            "latitudeRange": list(latitude_range(observed)),
            "observedFraction": round(observed_fraction(observed), 6),
        },
    }
    if quality is not None:
        quality_path = output_directory / f"{key}-quality.npy"
        np.save(quality_path, quality)
        product["qualityArrayPath"] = quality_path.name
    if source.get("attribution"):
        product["attribution"] = source["attribution"]
    return product


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, help="JSON plan describing the delivered provider products")
    parser.add_argument("--output", required=True, help="Directory that receives the reprojected arrays")
    parser.add_argument("--products", required=True, help="Path of the emitted product description")
    arguments = parser.parse_args()

    plan = json.loads(Path(arguments.plan).read_text(encoding="utf8"))
    width = int(plan.get("width", 4096))
    height = int(plan.get("height", 2048))
    products = [adapt_source(source, width, height, arguments.output) for source in plan["sources"]]
    Path(arguments.products).write_text(
        json.dumps({"retrievedAt": plan["retrievedAt"], "products": products}, indent=2) + "\n",
        encoding="utf8",
    )


if __name__ == "__main__":
    main()
