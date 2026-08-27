"""Compose a truthful rolling clear-land surface from standardized observations.

The scientific seam is ``compose_rolling_surface``. Provider adapters are expected
to decode MODIS/VIIRS products into the documented arrays before crossing it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


BASELINE_AGE = np.iinfo(np.uint16).max
SOURCE_BASELINE = 0
SOURCE_MCD43A4 = 1
SOURCE_VIIRS = 2
SOURCE_CODES = {
    "mcd43a4-nbar": SOURCE_MCD43A4,
    "viirs-surface-reflectance": SOURCE_VIIRS,
}


def decode_provider_observation(data: Any, product: str, window_index: int) -> dict[str, Any]:
    """Decode documented MCD43A4/VNP09 QA fields into the compositor interface."""
    if "reflectance" in data:
        return {
            "product": product,
            "window_index": window_index,
            **{name: np.asarray(data[name]) for name in [
                "reflectance", "land", "quality", "cloud", "cloud_shadow", "haze", "geometry_quality", "age_days",
            ]},
        }
    if product == "mcd43a4-nbar":
        reflectance = np.asarray(data["nbar_rgb"], dtype=np.float32) * 0.0001
        mandatory_quality = np.asarray(data["mandatory_quality_rgb"], dtype=np.uint8)
        if mandatory_quality.shape != reflectance.shape:
            raise ValueError("MCD43A4 mandatory_quality_rgb must match nbar_rgb")
        shape = reflectance.shape[:2]
        full_inversion = np.all((mandatory_quality & 1) == 0, axis=2)
        valid = np.all(np.isfinite(reflectance) & (reflectance >= 0) & (reflectance <= 1.6), axis=2)
        return {
            "product": product,
            "window_index": window_index,
            "reflectance": reflectance,
            "land": _array(data["land"], shape, "land", bool),
            "quality": np.where(full_inversion & valid, 0.98, 0).astype(np.float32),
            "cloud": np.zeros(shape, dtype=bool),
            "cloud_shadow": np.zeros(shape, dtype=bool),
            "haze": np.zeros(shape, dtype=bool),
            "geometry_quality": np.ones(shape, dtype=np.float32),
            "age_days": _array(data["age_days"], shape, "age_days", np.float32),
        }
    if product == "viirs-surface-reflectance":
        reflectance = np.asarray(data["surface_reflectance_rgb"], dtype=np.float32) * 0.0001
        shape = reflectance.shape[:2]
        qf1 = _array(data["qf1"], shape, "qf1", np.uint8)
        qf2 = _array(data["qf2"], shape, "qf2", np.uint8)
        qf4 = _array(data["qf4"], shape, "qf4", np.uint8)
        qf6 = _array(data["qf6"], shape, "qf6", np.uint8)
        qf7 = _array(data["qf7"], shape, "qf7", np.uint8)
        cloud_quality = qf1 & 0b11
        cloud_confidence = (qf1 >> 2) & 0b11
        cloud = (cloud_quality < 2) | (cloud_confidence >= 2) | ((qf1 & 0b00010000) != 0) | ((qf1 & 0b00100000) != 0)
        land_class = qf2 & 0b111
        land = (land_class == 0) | (land_class == 1)
        shadow = (qf2 & 0b00001000) != 0
        haze = ((qf2 & 0b11010000) != 0) | ((qf7 & 0b00010010) != 0) | (((qf7 >> 2) & 0b11) == 3)
        bad_rgb = ((qf4 & 0b00001110) != 0) | ((qf6 & 0b00111000) != 0)
        valid = np.all(np.isfinite(reflectance) & (reflectance >= -0.01) & (reflectance <= 1.6), axis=2)
        geometry = np.ones(shape, dtype=np.float32)
        if "sensor_zenith_degrees" in data:
            sensor_zenith = np.abs(_array(data["sensor_zenith_degrees"], shape, "sensor_zenith_degrees", np.float32))
            geometry = np.clip((70 - sensor_zenith) / 15, 0, 1)
        accepted = land & ~cloud & ~shadow & ~haze & ~bad_rgb & valid
        return {
            "product": product,
            "window_index": window_index,
            "reflectance": reflectance,
            "land": land,
            "quality": np.where(accepted, 0.95, 0).astype(np.float32),
            "cloud": cloud,
            "cloud_shadow": shadow,
            "haze": haze | bad_rgb,
            "geometry_quality": geometry,
            "age_days": _array(data["age_days"], shape, "age_days", np.float32),
        }
    raise ValueError(f"unsupported rolling-surface product: {product}")


def _array(value: Any, shape: tuple[int, ...], name: str, dtype: Any | None = None) -> np.ndarray:
    array = np.asarray(value, dtype=dtype)
    if array.shape != shape:
        raise ValueError(f"{name} must have shape {shape}, received {array.shape}")
    return array


def _area_weights(height: int, width: int) -> np.ndarray:
    latitude = 90.0 - (np.arange(height, dtype=np.float64) + 0.5) * (180.0 / height)
    return np.broadcast_to(np.cos(np.deg2rad(latitude))[:, None], (height, width))


def _fraction(mask: np.ndarray, weights: np.ndarray) -> float:
    return float(weights[mask].sum() / weights.sum())


def _normalize_observation(
    reflectance: np.ndarray,
    reference: np.ndarray,
    eligible: np.ndarray,
) -> tuple[np.ndarray, list[float]]:
    gains = np.ones(3, dtype=np.float32)
    for channel in range(3):
        observed = reflectance[..., channel][eligible]
        expected = reference[..., channel][eligible]
        usable = np.isfinite(observed) & np.isfinite(expected) & (observed > 0.02) & (expected > 0.02)
        if np.any(usable):
            ratio = np.median(expected[usable]) / np.median(observed[usable])
            gains[channel] = np.clip(ratio, 0.75, 1.25)
    return np.clip(reflectance * gains, 0.0, 1.0), [float(value) for value in gains]


def _erode(mask: np.ndarray) -> np.ndarray:
    north = np.vstack((mask[:1], mask[:-1]))
    south = np.vstack((mask[1:], mask[-1:]))
    return mask & north & south & np.roll(mask, 1, axis=1) & np.roll(mask, -1, axis=1)


def _feather_weights(mask: np.ndarray, pixels: int) -> np.ndarray:
    if pixels <= 0:
        return mask.astype(np.float32)
    weights = np.zeros(mask.shape, dtype=np.float32)
    remaining = mask.copy()
    for distance in range(1, pixels + 1):
        eroded = _erode(remaining)
        weights[remaining & ~eroded] = distance / (pixels + 1)
        remaining = eroded
    weights[remaining] = 1
    return weights


def compose_rolling_surface(
    *,
    seasonal_baseline: np.ndarray,
    observations: list[dict[str, Any]],
    elapsed_days: int | float,
    previous_surface: np.ndarray | None = None,
    previous_age_days: np.ndarray | None = None,
    previous_source: np.ndarray | None = None,
    previous_window_index: np.ndarray | None = None,
    min_quality: float = 0.72,
    min_geometry_quality: float = 0.5,
    max_daily_change: float = 0.12,
    seam_feather_pixels: int = 3,
) -> dict[str, Any]:
    """Return the next clean surface, age/provenance fields, and audit summary.

    Inputs are north-up EPSG:4326 arrays. Age uses whole days; ``65535`` is the
    permanent seasonal-baseline sentinel and must never be interpreted as fresh.
    """

    baseline = np.asarray(seasonal_baseline, dtype=np.float32)
    if baseline.ndim != 3 or baseline.shape[2] != 3:
        raise ValueError("seasonal_baseline must be an H×W×3 RGB array")
    if not np.all(np.isfinite(baseline)):
        raise ValueError("seasonal_baseline contains non-finite values")
    baseline = np.clip(baseline, 0.0, 1.0)
    height, width = baseline.shape[:2]
    pixel_shape = (height, width)

    previous_fields = (previous_surface, previous_age_days, previous_source, previous_window_index)
    if any(value is None for value in previous_fields) and not all(value is None for value in previous_fields):
        raise ValueError("previous surface, age, and source must be supplied together")

    if previous_surface is None:
        surface = baseline.copy()
        age_days = np.full(pixel_shape, BASELINE_AGE, dtype=np.uint16)
        source = np.full(pixel_shape, SOURCE_BASELINE, dtype=np.uint8)
        window_index = np.zeros(pixel_shape, dtype=np.uint16)
    else:
        prior_surface = _array(previous_surface, baseline.shape, "previous_surface", np.float32)
        prior_age = _array(previous_age_days, pixel_shape, "previous_age_days", np.uint16)
        source = _array(previous_source, pixel_shape, "previous_source", np.uint8).copy()
        window_index = _array(previous_window_index, pixel_shape, "previous_window_index", np.uint16).copy()
        known = source != SOURCE_BASELINE
        surface = np.where(known[..., None], np.clip(prior_surface, 0.0, 1.0), baseline).astype(np.float32)
        elapsed = max(0, int(round(float(elapsed_days))))
        progressed = np.minimum(prior_age.astype(np.uint32) + elapsed, BASELINE_AGE - 1).astype(np.uint16)
        age_days = np.where(known, progressed, BASELINE_AGE).astype(np.uint16)
        window_index = np.where(known, window_index, 0).astype(np.uint16)

    updated = np.zeros(pixel_shape, dtype=bool)
    normalization: list[dict[str, Any]] = []
    permitted_delta = max(0.0, float(max_daily_change)) * max(1.0, float(elapsed_days))

    for item in observations:
        product = item.get("product")
        if product not in SOURCE_CODES:
            raise ValueError(f"unsupported rolling-surface product: {product}")
        observation_window_index = item.get("window_index")
        if not isinstance(observation_window_index, int) or not 1 <= observation_window_index <= 65534:
            raise ValueError("observation window_index must be an integer from 1 through 65534")
        reflectance = _array(item.get("reflectance"), baseline.shape, "reflectance", np.float32)
        land = _array(item.get("land"), pixel_shape, "land", bool)
        quality = _array(item.get("quality"), pixel_shape, "quality", np.float32)
        cloud = _array(item.get("cloud"), pixel_shape, "cloud", bool)
        shadow = _array(item.get("cloud_shadow"), pixel_shape, "cloud_shadow", bool)
        haze = _array(item.get("haze"), pixel_shape, "haze", bool)
        geometry = _array(item.get("geometry_quality"), pixel_shape, "geometry_quality", np.float32)
        observation_age = _array(item.get("age_days"), pixel_shape, "age_days", np.float32)
        finite = np.all(np.isfinite(reflectance), axis=2) & np.isfinite(quality) & np.isfinite(geometry) & np.isfinite(observation_age)
        eligible = (
            ~updated & land & finite & ~cloud & ~shadow & ~haze
            & (quality >= min_quality) & (geometry >= min_geometry_quality) & (observation_age >= 0)
        )
        normalized, gains = _normalize_observation(reflectance, surface, eligible)
        limited = np.clip(normalized, surface - permitted_delta, surface + permitted_delta)
        feather = _feather_weights(eligible, int(seam_feather_pixels))
        alpha = feather[eligible][:, None]
        surface[eligible] = surface[eligible] * (1 - alpha) + limited[eligible] * alpha
        source[eligible] = SOURCE_CODES[product]
        window_index[eligible] = observation_window_index
        age_days[eligible] = np.minimum(np.rint(observation_age[eligible]), BASELINE_AGE - 1).astype(np.uint16)
        updated |= eligible
        normalization.append({
            "product": product,
            "gain": gains,
            "acceptedPixelCount": int(np.count_nonzero(eligible)),
        })

    weights = _area_weights(height, width)
    rolling = source != SOURCE_BASELINE
    return {
        "surface": surface,
        "age_days": age_days,
        "source": source,
        "window_index": window_index,
        "updated": updated,
        "normalization": normalization,
        "coverage": {
            "rollingFraction": _fraction(rolling, weights),
            "updatedFraction": _fraction(updated, weights),
            "baselineFraction": _fraction(~rolling, weights),
        },
    }


def _load_rgb(path: str | Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0


def _load_age(path: str | Path) -> tuple[np.ndarray, np.ndarray]:
    with Image.open(path) as image:
        rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    age = (rgba[..., 0].astype(np.uint16) << 8) | rgba[..., 1].astype(np.uint16)
    window_index = (rgba[..., 2].astype(np.uint16) << 8) | rgba[..., 3].astype(np.uint16)
    return age, window_index


def _save_result(result: dict[str, Any], surface_path: Path, age_path: Path) -> None:
    surface = np.rint(np.clip(result["surface"], 0, 1) * 255).astype(np.uint8)
    Image.fromarray(surface, mode="RGB").save(surface_path, format="PNG", optimize=True)
    age = result["age_days"].astype(np.uint16)
    rgba = np.empty((*age.shape, 4), dtype=np.uint8)
    rgba[..., 0] = age >> 8
    rgba[..., 1] = age & 255
    window_index = result["window_index"].astype(np.uint16)
    rgba[..., 2] = window_index >> 8
    rgba[..., 3] = window_index & 255
    Image.fromarray(rgba, mode="RGBA").save(age_path, format="PNG", optimize=True)


def _observation_from_npz(item: dict[str, Any]) -> dict[str, Any]:
    with np.load(item["path"], allow_pickle=False) as data:
        return decode_provider_observation(data, item["product"], item["windowIndex"])


def _run_request(request_path: Path, surface_path: Path, age_path: Path, metadata_path: Path) -> None:
    request = json.loads(request_path.read_text(encoding="utf-8"))
    baseline_spec = request["seasonalBaseline"]
    baseline_from = _load_rgb(baseline_spec["from"])
    baseline_to = _load_rgb(baseline_spec["to"])
    if baseline_from.shape != baseline_to.shape:
        raise ValueError("seasonal baseline frames must have matching dimensions")
    mix = float(baseline_spec["mix"])
    if not 0 <= mix <= 1:
        raise ValueError("seasonal baseline mix must be between zero and one")
    baseline = baseline_from * (1 - mix) + baseline_to * mix
    previous = request.get("previous")
    previous_args: dict[str, Any] = {}
    if previous:
        previous_args["previous_surface"] = _load_rgb(previous["surface"])
        previous_args["previous_age_days"], previous_args["previous_window_index"] = _load_age(previous["age"])
        window_sources = {int(index): int(source) for index, source in previous["windowSources"].items()}
        previous_args["previous_source"] = np.vectorize(lambda index: window_sources.get(int(index), 0), otypes=[np.uint8])(previous_args["previous_window_index"])
    observations = [_observation_from_npz(item) for item in request.get("observations", [])]
    result = compose_rolling_surface(
        seasonal_baseline=baseline,
        observations=observations,
        elapsed_days=request.get("elapsedDays", 1),
        min_quality=request.get("minQuality", 0.72),
        min_geometry_quality=request.get("minGeometryQuality", 0.5),
        max_daily_change=request.get("maxDailyChange", 0.12),
        seam_feather_pixels=request.get("seamFeatherPixels", 3),
        **previous_args,
    )
    surface_path.parent.mkdir(parents=True, exist_ok=True)
    age_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    _save_result(result, surface_path, age_path)
    observed = result["age_days"][result["source"] != SOURCE_BASELINE]
    metadata = {
        "coverage": result["coverage"],
        "oldestPixelAgeDays": int(observed.max()) if observed.size else None,
        "newestPixelAgeDays": int(observed.min()) if observed.size else None,
        "sourceProducts": [entry["product"] for entry in result["normalization"] if entry["acceptedPixelCount"] > 0],
        "usedWindowIndices": [int(value) for value in np.unique(result["window_index"]) if value > 0],
        "normalization": result["normalization"],
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--surface-output", required=True, type=Path)
    parser.add_argument("--age-output", required=True, type=Path)
    parser.add_argument("--metadata-output", required=True, type=Path)
    options = parser.parse_args()
    _run_request(options.request, options.surface_output, options.age_output, options.metadata_output)


if __name__ == "__main__":
    main()
