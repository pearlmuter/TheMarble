#!/usr/bin/env python3
"""Harmonize one NASA SatCORPS global composite into render-ready cloud fields."""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


MAX_CLOUD_HEIGHT_KM = 20.0
MAX_OPTICAL_DEPTH = 150.0
MAX_OBSERVATION_AGE_SECONDS = 3 * 60 * 60
MIN_PIXEL_QUALITY = 0.5


@dataclass(frozen=True)
class SatcorpsFields:
    cloud_mask: np.ndarray
    optical_depth: np.ndarray
    reflectance: np.ndarray
    phase: np.ndarray
    height_km: np.ndarray
    age_seconds: np.ndarray
    quality: np.ndarray


def _same_shape(fields):
    shapes = {np.asarray(value).shape for value in fields}
    if len(shapes) != 1 or len(next(iter(shapes))) != 2:
        raise ValueError("SatCORPS physical fields must have the same shape on a two-dimensional grid")


def normalize_reflectance(values):
    values = np.asarray(values, dtype=np.float32)
    finite = values[np.isfinite(values)]
    maximum = float(finite.max()) if finite.size else 0.0
    if finite.size and (maximum > 100.0 or float(finite.min()) < 0.0):
        raise ValueError("SatCORPS reflectance must use fraction or percent units")
    return values / 100.0 if maximum > 1.0 else values


def quality_from_dqf(flags):
    return np.where(np.asarray(flags) == 0, 1.0, 0.0).astype(np.float32)


def select_quality(quality=None, dqf=None):
    if quality is not None:
        return np.clip(np.asarray(quality, dtype=np.float32), 0.0, 1.0)
    if dqf is not None:
        return quality_from_dqf(dqf)
    raise ValueError("SatCORPS file is missing quality or dqf")


def _area_weighted_fraction(values):
    height, width = values.shape
    latitudes = 90.0 - (np.arange(height, dtype=np.float64) + 0.5) * (180.0 / height)
    weights = np.cos(np.deg2rad(latitudes))[:, None]
    return float(np.sum(values * weights) / (width * np.sum(weights)))


def validate_usable_coverage(coverage_valid, minimum_fraction=0.90):
    coverage_valid = np.asarray(coverage_valid, dtype=bool)
    if coverage_valid.ndim != 2:
        raise ValueError("SatCORPS coverage validity must be a two-dimensional grid")
    fraction = _area_weighted_fraction(coverage_valid)
    if fraction < minimum_fraction:
        raise ValueError(f"SatCORPS usable coverage {fraction:.3f} is below {minimum_fraction:.3f}")
    return fraction


def harmonize_fields(cloud_mask, optical_depth, reflectance, phase, height_km, age_seconds, quality):
    arrays = [cloud_mask, optical_depth, reflectance, phase, height_km, age_seconds, quality]
    _same_shape(arrays)
    cloud_mask = np.asarray(cloud_mask, dtype=bool)
    optical_depth = np.asarray(optical_depth, dtype=np.float32)
    reflectance = np.asarray(reflectance, dtype=np.float32)
    phase = np.asarray(phase)
    height_km = np.asarray(height_km, dtype=np.float32)
    age_seconds = np.abs(np.asarray(age_seconds, dtype=np.float32))
    quality = np.asarray(quality, dtype=np.float32)

    quality_valid = np.isfinite(quality) & (quality >= MIN_PIXEL_QUALITY)
    finite = np.isfinite(optical_depth) & np.isfinite(reflectance) & np.isfinite(height_km) \
        & np.isfinite(age_seconds)
    physical = (optical_depth >= 0) & (optical_depth <= MAX_OPTICAL_DEPTH) \
        & (reflectance >= 0) & (reflectance <= 1) \
        & (height_km >= 0) & (height_km <= MAX_CLOUD_HEIGHT_KM) \
        & np.isin(phase, (1, 2))
    cloud_physical_valid = finite & physical
    coverage_valid = quality_valid & (~cloud_mask | cloud_physical_valid)
    usable = cloud_mask & coverage_valid

    tau = np.where(usable, optical_depth, 0.0)
    visible = np.where(usable, reflectance, 0.0)
    confidence = np.where(usable, np.clip(quality, 0.0, 1.0), 0.0)
    # SatCORPS optical depth is defined at visible wavelengths: transmission is exp(-tau).
    opacity = np.where(usable, 1.0 - np.exp(-tau), 0.0)
    # Reflectance is stored as cloud luminance; optical depth controls transmission/opacity.
    luminance = np.where(usable, 0.42 + 0.58 * np.sqrt(visible), 0.0)
    density = np.where(usable, 1.0 - np.exp(-tau * 0.12), 0.0)
    phase_unit = np.where(usable, np.where(phase == 2, 1.0, 0.0), 0.0)
    height_unit = np.where(usable, np.clip(height_km / MAX_CLOUD_HEIGHT_KM, 0.0, 1.0), 0.0)
    tau_unit = np.where(usable, np.log1p(tau) / np.log1p(MAX_OPTICAL_DEPTH), 0.0)
    age_unit = np.where(usable, np.clip(age_seconds / MAX_OBSERVATION_AGE_SECONDS, 0.0, 1.0), 0.0)

    return {
        "cloud_opacity": np.stack([luminance, opacity], axis=-1).astype(np.float32),
        "cloud_density": np.stack([density, confidence, visible], axis=-1).astype(np.float32),
        "cloud_physics": np.stack([tau_unit, phase_unit, height_unit, confidence], axis=-1).astype(np.float32),
        "cloud_age": age_unit.astype(np.float32),
        "usable": usable,
        "coverage_valid": coverage_valid,
    }


def _dataset(source, *names):
    for name in names:
        if name in source:
            dataset = source[name]
            values = np.asarray(dataset, dtype=np.float32)
            fill = dataset.attrs.get("_FillValue")
            if fill is not None:
                values = np.where(values == float(np.asarray(fill).reshape(-1)[0]), np.nan, values)
            scale = float(np.asarray(dataset.attrs.get("scale_factor", 1.0)).reshape(-1)[0])
            offset = float(np.asarray(dataset.attrs.get("add_offset", 0.0)).reshape(-1)[0])
            return values * scale + offset
    raise ValueError(f"SatCORPS file is missing {names[0]}")


def _attribute(source, name):
    if name not in source.attrs:
        raise ValueError(f"SatCORPS metadata is missing {name}")
    value = source.attrs[name]
    if isinstance(value, (bytes, np.bytes_)):
        return bytes(value).decode("utf-8")
    return str(value)


def load_satcorps(path):
    try:
        import h5py
    except ImportError as error:
        raise RuntimeError("SatCORPS composition requires h5py") from error
    with h5py.File(path, "r") as source:
        mask = _dataset(source, "cloud_mask") > 0
        tau = _dataset(source, "cloud_optical_depth")
        reflectance = normalize_reflectance(_dataset(source, "ref_0.63um", "cloud_reflectance"))
        phase = np.rint(_dataset(source, "cloud_phase")).astype(np.int16)
        height = _dataset(source, "cloud_eff_height", "cloud_top_height")
        relative_time = _dataset(source, "relative_time")
        quality = select_quality(
            _dataset(source, "quality") if "quality" in source else None,
            _dataset(source, "dqf") if "dqf" in source else None,
        )
        metadata = {
            "observedFrom": _attribute(source, "time_coverage_start"),
            "observedTo": _attribute(source, "time_coverage_end"),
            "producedAt": _attribute(source, "date_created"),
            "version": _attribute(source, "product_version"),
        }
    return SatcorpsFields(mask, tau, reflectance, phase, height, relative_time, quality), metadata


def _save(values, path, mode):
    Image.fromarray(np.clip(values * 255.0, 0, 255).astype(np.uint8), mode=mode).save(path, optimize=True)


def compose(source_path, cloud_path, density_path, physics_path, age_path, metadata_path):
    fields, metadata = load_satcorps(source_path)
    result = harmonize_fields(
        cloud_mask=fields.cloud_mask,
        optical_depth=fields.optical_depth,
        reflectance=fields.reflectance,
        phase=fields.phase,
        height_km=fields.height_km,
        age_seconds=fields.age_seconds,
        quality=fields.quality,
    )
    usable_fraction = validate_usable_coverage(result["coverage_valid"])
    _save(result["cloud_opacity"], cloud_path, "LA")
    _save(result["cloud_density"], density_path, "RGB")
    _save(result["cloud_physics"], physics_path, "RGBA")
    _save(result["cloud_age"], age_path, "L")
    metadata["dimensions"] = {"width": int(fields.cloud_mask.shape[1]), "height": int(fields.cloud_mask.shape[0])}
    metadata["coverage"] = {"observedFraction": usable_fraction, "latitudeRange": [-90, 90]}
    metadata["quality"] = {"usableFraction": usable_fraction}
    metadata["channels"] = {
        "cloudOpacity": {"l": "0.63 um reflectance appearance", "a": "optical-depth transmission opacity"},
        "cloudDensity": {"r": "optical density", "g": "retrieval quality", "b": "0.63 um reflectance"},
        "cloudPhysics": {"r": "log optical depth", "g": "thermodynamic phase", "b": "height / 20 km", "a": "retrieval quality"},
        "cloudAge": {"l": "absolute observation age / 3 hours"},
    }
    Path(metadata_path).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--cloud", required=True)
    parser.add_argument("--density", required=True)
    parser.add_argument("--physics", required=True)
    parser.add_argument("--age", required=True)
    parser.add_argument("--metadata", required=True)
    args = parser.parse_args()
    compose(args.source, args.cloud, args.density, args.physics, args.age, args.metadata)


if __name__ == "__main__":
    main()
