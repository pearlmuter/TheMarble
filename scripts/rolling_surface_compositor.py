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
        surface[eligible] = limited[eligible]
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
        return {
            "product": item["product"],
            "window_index": item["windowIndex"],
            "reflectance": data["reflectance"].astype(np.float32),
            "land": data["land"].astype(bool),
            "quality": data["quality"].astype(np.float32),
            "cloud": data["cloud"].astype(bool),
            "cloud_shadow": data["cloud_shadow"].astype(bool),
            "haze": data["haze"].astype(bool),
            "geometry_quality": data["geometry_quality"].astype(np.float32),
            "age_days": data["age_days"].astype(np.float32),
        }


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
