#!/usr/bin/env python3
"""Fuse observation-led clouds with disclosed polar, model, and static gap sources."""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


SOURCE_STATIC = np.uint8(0)
SOURCE_MODEL = np.uint8(1)
SOURCE_PRIMARY = np.uint8(2)
SOURCE_POLAR = np.uint8(3)
SOURCE_UNKNOWN = np.uint8(255)


@dataclass(frozen=True)
class ObservedCloudField:
    appearance: np.ndarray
    density: np.ndarray
    quality: np.ndarray
    age_seconds: np.ndarray


@dataclass(frozen=True)
class ModelCloudField:
    total_cloud: np.ndarray
    run_at: str
    forecast_hour: int


@dataclass(frozen=True)
class StaticCloudField:
    appearance: np.ndarray
    density: np.ndarray


@dataclass(frozen=True)
class GapThresholds:
    max_observation_age_seconds: int
    min_observation_quality: float
    seam_blend_pixels: int


def _require_grid_shape(field, shape, name):
    if np.asarray(field).shape != shape:
        raise ValueError(f"Cloud-gap {name} dimensions disagree")


def _validate_observation(field, shape, name):
    _require_grid_shape(field.appearance, (*shape, 2), f"{name} appearance")
    _require_grid_shape(field.density, (*shape, 3), f"{name} density")
    _require_grid_shape(field.quality, shape, f"{name} quality")
    _require_grid_shape(field.age_seconds, shape, f"{name} age")


def _eligible_observation(field, thresholds):
    finite = np.isfinite(field.appearance).all(axis=-1) & np.isfinite(field.density).all(axis=-1) \
        & np.isfinite(field.quality) & np.isfinite(field.age_seconds)
    return finite & (field.quality >= thresholds.min_observation_quality) \
        & (field.age_seconds >= 0) & (field.age_seconds <= thresholds.max_observation_age_seconds)


def _area_weighted_fraction(mask):
    height, width = mask.shape
    latitudes = 90.0 - (np.arange(height, dtype=np.float64) + 0.5) * (180.0 / height)
    weights = np.cos(np.deg2rad(latitudes))[:, None]
    return float(np.sum(mask * weights) / (width * np.sum(weights)))


def _model_textures(total_cloud):
    cloud = np.clip(total_cloud, 0.0, 1.0)
    opacity = 1.0 - np.exp(-cloud * 2.1)
    luminance = 0.42 + 0.45 * np.sqrt(cloud)
    appearance = np.stack([luminance, opacity], axis=-1).astype(np.float32)
    density = np.stack([cloud, np.full_like(cloud, 0.55), np.zeros_like(cloud)], axis=-1).astype(np.float32)
    return appearance, density


def _blur(values, radius):
    encoded = np.clip(np.asarray(values, dtype=np.float32) * 255.0, 0, 255).astype(np.uint8)
    padding = max(1, int(np.ceil(radius * 3)))
    padded = np.pad(encoded, ((0, 0), (padding, padding)), mode="wrap")
    padded = np.pad(padded, ((padding, padding), (0, 0)), mode="edge")
    image = Image.fromarray(padded, mode="L")
    blurred = np.asarray(image.filter(ImageFilter.GaussianBlur(radius=radius)), dtype=np.float32)
    return blurred[padding:-padding, padding:-padding] / 255.0


def _feather_higher_priority(appearance, density, higher_mask, lower_mask, radius, native_weight):
    if radius <= 0 or not np.any(higher_mask) or not np.any(lower_mask):
        return
    blurred_mask = _blur(higher_mask.astype(np.float32), radius)
    blend = np.where(lower_mask & (blurred_mask >= 0.05), np.minimum(blurred_mask, 0.45), 0.0)
    denominator = np.maximum(blurred_mask, 1e-6)
    for texture in (appearance, density):
        for channel in range(texture.shape[-1]):
            extrapolated = _blur(texture[..., channel] * higher_mask, radius) / denominator
            texture[..., channel] = texture[..., channel] * (1.0 - blend) + extrapolated * blend
    native_weight[lower_mask] *= 1.0 - blend[lower_mask]


def fuse_cloud_gaps(*, primary, polar, model, static, thresholds):
    if thresholds.max_observation_age_seconds <= 0 or not 0 <= thresholds.min_observation_quality <= 1 \
        or thresholds.seam_blend_pixels < 0:
        raise ValueError("Invalid cloud-gap thresholds")
    appearance = np.asarray(static.appearance, dtype=np.float32).copy()
    density = np.asarray(static.density, dtype=np.float32).copy()
    if appearance.ndim != 3 or appearance.shape[-1] != 2:
        raise ValueError("Cloud-gap static appearance must be an LA grid")
    shape = appearance.shape[:2]
    _require_grid_shape(density, (*shape, 3), "static density")
    if not np.isfinite(appearance).all() or not np.isfinite(density).all():
        raise ValueError("Cloud-gap static fallback must be complete")
    _validate_observation(primary, shape, "primary")
    if polar is not None:
        _validate_observation(polar, shape, "polar")

    source_class = np.full(shape, SOURCE_STATIC, dtype=np.uint8)
    selected_quality = np.clip(density[..., 1], 0.0, 1.0)
    selected_age = np.full(shape, thresholds.max_observation_age_seconds, dtype=np.float32)

    if model is not None:
        _require_grid_shape(model.total_cloud, shape, "GFS total cloud")
        model_valid = np.isfinite(model.total_cloud) & (model.total_cloud >= 0) & (model.total_cloud <= 1)
        model_appearance, model_density = _model_textures(model.total_cloud)
        appearance[model_valid] = model_appearance[model_valid]
        density[model_valid] = model_density[model_valid]
        source_class[model_valid] = SOURCE_MODEL
        selected_quality[model_valid] = 0.55

    if polar is not None:
        polar_valid = _eligible_observation(polar, thresholds)
        appearance[polar_valid] = polar.appearance[polar_valid]
        density[polar_valid] = polar.density[polar_valid]
        source_class[polar_valid] = SOURCE_POLAR
        selected_quality[polar_valid] = polar.quality[polar_valid]
        selected_age[polar_valid] = polar.age_seconds[polar_valid]

    primary_valid = _eligible_observation(primary, thresholds)
    appearance[primary_valid] = primary.appearance[primary_valid]
    density[primary_valid] = primary.density[primary_valid]
    source_class[primary_valid] = SOURCE_PRIMARY
    selected_quality[primary_valid] = primary.quality[primary_valid]
    selected_age[primary_valid] = primary.age_seconds[primary_valid]

    primary_observed = source_class == SOURCE_PRIMARY
    polar_observed = source_class == SOURCE_POLAR
    observed = primary_observed | polar_observed
    model_assisted = source_class == SOURCE_MODEL
    fallback = source_class == SOURCE_STATIC
    native_weight = np.ones(shape, dtype=np.float32)
    _feather_higher_priority(
        appearance, density, model_assisted, fallback,
        thresholds.seam_blend_pixels, native_weight,
    )
    _feather_higher_priority(
        appearance, density, observed, ~observed,
        thresholds.seam_blend_pixels, native_weight,
    )
    provenance = np.stack([
        source_class.astype(np.float32) / float(SOURCE_POLAR),
        np.clip(selected_age / thresholds.max_observation_age_seconds, 0.0, 1.0),
        np.clip(selected_quality, 0.0, 1.0),
        native_weight,
    ], axis=-1)
    return {
        "appearance": appearance,
        "density": density,
        "provenance": provenance.astype(np.float32),
        "source_class": source_class,
        "coverage": {
            "observedFraction": _area_weighted_fraction(observed),
            "primaryObservedFraction": _area_weighted_fraction(primary_observed),
            "polarObservedFraction": _area_weighted_fraction(polar_observed),
            "modelAssistedFraction": _area_weighted_fraction(model_assisted),
            "fallbackFraction": _area_weighted_fraction(fallback),
        },
    }


def _resize(values, shape, nearest=False):
    values = np.asarray(values, dtype=np.float32)
    if values.shape[:2] == shape:
        return values
    mode = "L" if nearest else "F"
    resampling = Image.Resampling.NEAREST if nearest else Image.Resampling.BILINEAR
    if values.ndim == 2:
        source = np.clip(values * 255.0, 0, 255).astype(np.uint8) if nearest else values
        resized = Image.fromarray(source, mode=mode).resize((shape[1], shape[0]), resampling)
        result = np.asarray(resized, dtype=np.float32)
        return result / 255.0 if nearest else result
    return np.stack([_resize(values[..., channel], shape, nearest) for channel in range(values.shape[-1])], axis=-1)


def _load_appearance(path, shape=None):
    with Image.open(path) as source:
        image = source.resize((shape[1], shape[0]), Image.Resampling.BILINEAR) \
            if shape is not None and source.size != (shape[1], shape[0]) else source
        if image.mode == "LA":
            return np.asarray(image, dtype=np.float32) / 255.0
        rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    luminance = rgba[..., 0] * .2126 + rgba[..., 1] * .7152 + rgba[..., 2] * .0722
    return np.stack([luminance, rgba[..., 3]], axis=-1)


def _load_density(path, shape):
    with Image.open(path) as source:
        image = source.convert("RGB")
        if image.size != (shape[1], shape[0]):
            image = image.resize((shape[1], shape[0]), Image.Resampling.BILINEAR)
        return np.asarray(image, dtype=np.float32) / 255.0


def _load_age(path, shape, maximum_encoded_age_seconds=10_800):
    with Image.open(path) as source:
        image = source.convert("L")
        if image.size != (shape[1], shape[0]):
            image = image.resize((shape[1], shape[0]), Image.Resampling.BILINEAR)
        return np.asarray(image, dtype=np.float32) / 255.0 * maximum_encoded_age_seconds


def _save(values, path, mode):
    Image.fromarray(np.clip(values * 255.0, 0, 255).astype(np.uint8), mode=mode).save(path, optimize=True)


def compose(
    *, primary_cloud_path, primary_density_path, primary_age_seconds, primary_age_path=None,
    polar_path, polar_age_offset_seconds=0, model_path, static_cloud_path, static_density_path,
    cloud_path, density_path, provenance_path, metadata_path, thresholds,
    model_run_at=None, model_forecast_hour=None,
):
    primary_appearance = _load_appearance(primary_cloud_path)
    shape = primary_appearance.shape[:2]
    primary_density = _load_density(primary_density_path, shape)
    primary_quality = primary_density[..., 1]
    primary = ObservedCloudField(
        primary_appearance,
        primary_density,
        primary_quality,
        np.full(shape, float(primary_age_seconds), dtype=np.float32)
        + (_load_age(primary_age_path, shape) if primary_age_path is not None else 0.0),
    )
    polar = None
    if polar_path is not None:
        with np.load(polar_path, allow_pickle=False) as source:
            required = {"appearance", "density", "quality", "age_seconds"}
            if not required.issubset(source.files):
                raise ValueError("Polar cloud fixture is missing appearance, density, quality, or age_seconds")
            polar = ObservedCloudField(
                _resize(source["appearance"], shape),
                _resize(source["density"], shape),
                _resize(source["quality"], shape),
                _resize(source["age_seconds"], shape) + float(polar_age_offset_seconds),
            )
    model = None
    if model_path is not None:
        if model_run_at is None or model_forecast_hour is None:
            raise ValueError("GFS assistance requires model run and forecast hour")
        model = ModelCloudField(
            total_cloud=_resize(np.load(model_path, allow_pickle=False), shape),
            run_at=model_run_at,
            forecast_hour=int(model_forecast_hour),
        )
    static = StaticCloudField(
        appearance=_load_appearance(static_cloud_path, shape),
        density=_load_density(static_density_path, shape),
    )
    result = fuse_cloud_gaps(primary=primary, polar=polar, model=model, static=static, thresholds=thresholds)
    _save(result["appearance"], cloud_path, "LA")
    _save(result["density"], density_path, "RGB")
    _save(result["provenance"], provenance_path, "RGBA")
    metadata = {
        "dimensions": {"width": shape[1], "height": shape[0]},
        "coverage": {**result["coverage"], "latitudeRange": [-90, 90]},
        "thresholds": {
            "maxObservationAgeSeconds": thresholds.max_observation_age_seconds,
            "minObservationQuality": thresholds.min_observation_quality,
            "seamBlendPixels": thresholds.seam_blend_pixels,
        },
        **({"model": {"runAt": model.run_at, "forecastHour": model.forecast_hour}} if model else {}),
        "sourceClasses": {"static": 0, "model": 1, "primaryObservation": 2, "polarObservation": 3},
    }
    Path(metadata_path).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--primary-cloud", required=True)
    parser.add_argument("--primary-density", required=True)
    parser.add_argument("--primary-age-seconds", type=float, required=True)
    parser.add_argument("--primary-age")
    parser.add_argument("--polar")
    parser.add_argument("--polar-age-offset-seconds", type=float, default=0)
    parser.add_argument("--model")
    parser.add_argument("--model-run-at")
    parser.add_argument("--model-forecast-hour", type=int)
    parser.add_argument("--static-cloud", required=True)
    parser.add_argument("--static-density", required=True)
    parser.add_argument("--cloud", required=True)
    parser.add_argument("--density", required=True)
    parser.add_argument("--provenance", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--max-observation-age-seconds", type=int, required=True)
    parser.add_argument("--min-observation-quality", type=float, required=True)
    parser.add_argument("--seam-blend-pixels", type=int, required=True)
    arguments = parser.parse_args()
    compose(
        primary_cloud_path=arguments.primary_cloud,
        primary_density_path=arguments.primary_density,
        primary_age_seconds=arguments.primary_age_seconds,
        primary_age_path=arguments.primary_age,
        polar_path=arguments.polar,
        polar_age_offset_seconds=arguments.polar_age_offset_seconds,
        model_path=arguments.model,
        static_cloud_path=arguments.static_cloud,
        static_density_path=arguments.static_density,
        cloud_path=arguments.cloud,
        density_path=arguments.density,
        provenance_path=arguments.provenance,
        metadata_path=arguments.metadata,
        thresholds=GapThresholds(
            arguments.max_observation_age_seconds,
            arguments.min_observation_quality,
            arguments.seam_blend_pixels,
        ),
        model_run_at=arguments.model_run_at,
        model_forecast_hour=arguments.model_forecast_hour,
    )


if __name__ == "__main__":
    main()
