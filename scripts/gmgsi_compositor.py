#!/usr/bin/env python3
"""Convert one NOAA GMGSI visible/longwave pair into render-ready cloud textures."""

import argparse
import json
from pathlib import Path

import h5py
import numpy as np
from PIL import Image, ImageFilter


def smoothstep(low, high, value):
    position = np.clip((value - low) / (high - low), 0.0, 1.0)
    return position * position * (3.0 - 2.0 * position)


def classify_cloud_pixels(
    visible,
    longwave,
    visible_good,
    longwave_good,
    visible_background,
    longwave_background,
    latitude_degrees=None,
):
    visible_unit = np.clip(visible / 255.0, 0.0, 1.0)
    longwave_unit = np.clip(longwave / 255.0, 0.0, 1.0)
    visible_contrast = np.maximum(visible - visible_background, 0.0) / 255.0
    longwave_contrast = np.maximum(longwave - longwave_background, 0.0) / 255.0

    latitude = np.zeros_like(longwave_unit) if latitude_degrees is None else np.asarray(latitude_degrees)
    polar_factor = smoothstep(55.0, 72.0, np.abs(latitude))
    infrared_absolute = smoothstep(0.30, 0.78, longwave_unit) * 0.82 * (1.0 - 0.85 * polar_factor)
    infrared_relative = smoothstep(0.03, 0.22, longwave_contrast) * 0.75
    infrared_cloud = np.maximum(infrared_absolute, infrared_relative)

    visible_brightness = smoothstep(0.18, 0.82, visible_unit)
    visible_structure = smoothstep(0.02, 0.18, visible_contrast)
    thermal_support = smoothstep(0.20, 0.55, longwave_unit)
    daylight_cloud = visible_brightness * (0.12 + 0.50 * thermal_support + 0.38 * visible_structure)
    daylight_cloud *= 1.0 - 0.72 * polar_factor * (1.0 - visible_structure)

    score = np.where(visible_good, np.maximum(infrared_cloud, daylight_cloud), infrared_cloud)
    available = visible_good | longwave_good
    opacity = np.where(available, smoothstep(0.08, 0.86, score), 0.0).astype(np.float32)
    confidence = np.where(longwave_good, 0.88 + 0.12 * visible_good, 0.55 * visible_good).astype(np.float32)
    contribution = np.where(visible_good, np.clip(daylight_cloud - infrared_cloud, 0.0, 1.0), 0.0).astype(np.float32)
    return opacity, confidence, contribution


def _coordinate_axis(coordinates, axis, name):
    coordinates = np.asarray(coordinates, dtype=np.float32)
    if coordinates.ndim == 1:
        return coordinates
    if coordinates.ndim != 2:
        raise ValueError(f"GMGSI {name} coordinates must be one- or two-dimensional")
    if axis == 0:
        reference = coordinates[:, :1]
    else:
        reference = coordinates[:1, :]
    if np.nanmax(np.abs(coordinates - reference)) > 1e-3:
        raise ValueError(f"GMGSI {name} coordinates are not a rectilinear grid")
    return reference[:, 0] if axis == 0 else reference[0, :]


def _resize_horizontally(values, width, nearest=False):
    mode = "L" if nearest else "F"
    array = values.astype(np.uint8 if nearest else np.float32)
    image = Image.fromarray(array, mode=mode)
    resampling = Image.Resampling.NEAREST if nearest else Image.Resampling.BILINEAR
    return np.asarray(image.resize((width, values.shape[0]), resampling), dtype=np.float32)


def reproject_to_equirectangular(values, good, latitudes, longitudes, target_width, target_height):
    values = np.asarray(values, dtype=np.float32)
    good = np.asarray(good, dtype=bool)
    latitude_axis = _coordinate_axis(latitudes, 0, "latitude")
    longitude_axis = _coordinate_axis(longitudes, 1, "longitude")
    if values.shape != good.shape or values.shape != (latitude_axis.size, longitude_axis.size):
        raise ValueError("GMGSI data, quality, and coordinate dimensions disagree")
    if not np.all(np.diff(latitude_axis) < 0):
        raise ValueError("GMGSI latitude coordinates must run north to south")

    longitude_order = np.argsort(longitude_axis)
    sorted_longitudes = longitude_axis[longitude_order]
    longitude_step = float(np.median(np.diff(sorted_longitudes)))
    if sorted_longitudes[-1] - sorted_longitudes[0] + longitude_step < 350:
        raise ValueError("GMGSI longitude coordinates do not cover a global seam")
    horizontal_values = _resize_horizontally(values[:, longitude_order], target_width)
    horizontal_good = _resize_horizontally(good[:, longitude_order], target_width, nearest=True) > 0.5

    target_latitudes = 90.0 - (np.arange(target_height, dtype=np.float32) + 0.5) * (180.0 / target_height)
    source_rows = np.interp(target_latitudes, latitude_axis[::-1], np.arange(latitude_axis.size)[::-1])
    inside = (target_latitudes <= latitude_axis[0]) & (target_latitudes >= latitude_axis[-1])
    lower = np.floor(source_rows).astype(int)
    upper = np.minimum(lower + 1, latitude_axis.size - 1)
    fraction = (source_rows - lower)[:, None]
    projected = horizontal_values[lower] * (1.0 - fraction) + horizontal_values[upper] * fraction
    coverage = horizontal_good[lower] & horizontal_good[upper] & inside[:, None]
    projected = np.where(coverage, projected, 0.0).astype(np.float32)
    return projected, coverage


def _attribute_text(attributes, name):
    if name not in attributes:
        raise ValueError(f"GMGSI metadata is missing {name}")
    value = attributes[name]
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, np.bytes_):
        return bytes(value).decode("utf-8")
    return str(value)


def load_gmgsi(path):
    with h5py.File(path, "r") as source:
        for name in ("data", "dqf", "lat", "lon"):
            if name not in source:
                raise ValueError(f"GMGSI file is missing {name}")
        data = np.asarray(source["data"])
        quality = np.asarray(source["dqf"])
        if data.ndim != 3 or data.shape[0] != 1 or quality.shape != data.shape:
            raise ValueError("GMGSI data and quality must share one time slice")
        values = data[0].astype(np.float32)
        flags = quality[0]
        fill = float(np.asarray(source["data"].attrs.get("_FillValue", [-9999]))[0])
        good = (flags == 0) & np.isfinite(values) & (values != fill)
        metadata = {
            "observedFrom": _attribute_text(source.attrs, "time_coverage_start"),
            "observedTo": _attribute_text(source.attrs, "time_coverage_end"),
            "producedAt": _attribute_text(source.attrs, "date_created"),
            "version": _attribute_text(source.attrs, "history").strip().splitlines()[-1],
            "title": _attribute_text(source.attrs, "title"),
            "latitudeRange": [
                float(np.asarray(source.attrs["geospatial_lat_min"])[0]),
                float(np.asarray(source.attrs["geospatial_lat_max"])[0]),
            ],
            "optimalFraction": float(good.mean()),
        }
        return values, good, np.asarray(source["lat"]), np.asarray(source["lon"]), metadata


def _blur(values, radius):
    image = Image.fromarray(np.clip(values, 0, 255).astype(np.uint8), mode="L")
    return np.asarray(image.filter(ImageFilter.GaussianBlur(radius=radius)), dtype=np.float32)


def feather_coverage(coverage, radius):
    blurred = _blur(np.asarray(coverage, dtype=np.float32) * 255.0, radius) / 255.0
    return np.where(coverage, np.clip(blurred, 0.0, 1.0), 0.0).astype(np.float32)


def _area_weighted_fraction(coverage):
    latitudes = 90.0 - (np.arange(coverage.shape[0], dtype=np.float64) + 0.5) * (180.0 / coverage.shape[0])
    weights = np.cos(np.deg2rad(latitudes))[:, None]
    return float(np.sum(coverage * weights) / (coverage.shape[1] * np.sum(weights)))


def validate_observation_coverage(longwave_coverage, minimum_fraction=0.90):
    fraction = _area_weighted_fraction(longwave_coverage)
    if fraction < minimum_fraction:
        raise ValueError(f"GMGSI longwave coverage {fraction:.3f} is below {minimum_fraction:.3f}")
    return fraction


def compose(visible_path, longwave_path, cloud_path, density_path, metadata_path, width, height):
    visible, visible_good, visible_lat, visible_lon, visible_metadata = load_gmgsi(visible_path)
    longwave, longwave_good, longwave_lat, longwave_lon, longwave_metadata = load_gmgsi(longwave_path)
    for field in ("observedFrom", "observedTo"):
        if visible_metadata[field] != longwave_metadata[field]:
            raise ValueError(f"GMGSI visible/longwave {field} mismatch")
    if visible.shape != longwave.shape or not np.allclose(visible_lat, longwave_lat) or not np.allclose(visible_lon, longwave_lon):
        raise ValueError("GMGSI visible/longwave grids disagree")

    visible_map, visible_coverage = reproject_to_equirectangular(
        visible, visible_good, visible_lat, visible_lon, width, height
    )
    longwave_map, longwave_coverage = reproject_to_equirectangular(
        longwave, longwave_good, longwave_lat, longwave_lon, width, height
    )
    validate_observation_coverage(longwave_coverage)
    blur_radius = max(2.0, width / 320.0)
    opacity, confidence, visible_contribution = classify_cloud_pixels(
        visible_map,
        longwave_map,
        visible_coverage,
        longwave_coverage,
        _blur(visible_map, blur_radius),
        _blur(longwave_map, blur_radius),
        latitude_degrees=(90.0 - (np.arange(height, dtype=np.float32) + 0.5) * (180.0 / height))[:, None],
    )
    combined_coverage = visible_coverage | longwave_coverage
    coverage_feather = feather_coverage(combined_coverage, max(2.0, width / 512.0))
    opacity = np.where(combined_coverage, opacity * coverage_feather, 0.0)
    confidence = np.where(combined_coverage, confidence * coverage_feather, 0.0)

    cloud_brightness = 0.78 + 0.22 * np.maximum(visible_map, longwave_map) / 255.0
    cloud_luminance_alpha = np.stack([cloud_brightness, opacity], axis=-1)
    density_rgb = np.stack([
        opacity,
        confidence,
        visible_contribution,
    ], axis=-1)
    Image.fromarray(np.clip(cloud_luminance_alpha * 255.0, 0, 255).astype(np.uint8), mode="LA").save(cloud_path, optimize=True)
    Image.fromarray(np.clip(density_rgb * 255.0, 0, 255).astype(np.uint8), mode="RGB").save(density_path, optimize=True)

    latitude_min = max(visible_metadata["latitudeRange"][0], longwave_metadata["latitudeRange"][0])
    latitude_max = min(visible_metadata["latitudeRange"][1], longwave_metadata["latitudeRange"][1])
    result = {
        "observedFrom": visible_metadata["observedFrom"],
        "observedTo": visible_metadata["observedTo"],
        "producedAt": max(visible_metadata["producedAt"], longwave_metadata["producedAt"]),
        "version": visible_metadata["version"],
        "dimensions": {"width": width, "height": height},
        "coverage": {
            "observedFraction": _area_weighted_fraction(combined_coverage),
            "latitudeRange": [latitude_min, latitude_max],
            "visibleOptimalFraction": visible_metadata["optimalFraction"],
            "longwaveOptimalFraction": longwave_metadata["optimalFraction"],
        },
    }
    Path(metadata_path).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--visible", required=True)
    parser.add_argument("--longwave", required=True)
    parser.add_argument("--cloud", required=True)
    parser.add_argument("--density", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--height", type=int, default=2048)
    arguments = parser.parse_args()
    compose(
        arguments.visible,
        arguments.longwave,
        arguments.cloud,
        arguments.density,
        arguments.metadata,
        arguments.width,
        arguments.height,
    )


if __name__ == "__main__":
    main()
