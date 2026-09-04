#!/usr/bin/env python3
"""Synthesise a SatCORPS global cloud composite for local visual acceptance.

NASA Langley's SatCORPS granules are operations-owned, so nothing in local
development or in the public feed has ever carried a *retrieved* cloud optical
depth or cloud-top height. Every published state so far says "Cloud thickness ·
assumed". That leaves the renderer's retrieved-physics path -- the one that
shades a deck by the slope of its real top rather than by a thickness proxy --
unexercised everywhere, including in production.

This fixture stands in for that granule so the real compositor, manifest builder
and publisher can run end to end and the renderer can be shown the fields it
will eventually be given. Like the cryosphere fixture beside it, what it
produces is a plausible synthetic field and never an observation: the publisher
labels it, and its version string says so.

The field is deliberately structured rather than random, because the thing being
checked is whether cloud-top *slope* reads as relief, and a purely random field
would look like relief no matter how wrong the shading maths was. But it must
also carry structure down to a few texels: the renderer takes its cloud-top
gradient over a step of 0.001 in map coordinates, so a field whose only features
are continental-scale has a gradient of essentially zero everywhere and cannot
exercise the code at all. The first version of this fixture made exactly that
mistake and rendered perfectly smooth blobs.

So the field is a synoptic skeleton -- ITCZ, storm tracks, dry belts -- with
several octaves of detail laid over it, which is roughly how a real cloud field's
spatial spectrum is shaped.
"""

import argparse
from datetime import datetime, timedelta, timezone

import h5py
import numpy as np

FIXTURE_VERSION = "local-preview-fixture-satcorps-v1"
MAX_CLOUD_HEIGHT_KM = 20.0


def _grid(width, height):
    longitudes = -180.0 + (np.arange(width, dtype=np.float64) + 0.5) * (360.0 / width)
    latitudes = 90.0 - (np.arange(height, dtype=np.float64) + 0.5) * (180.0 / height)
    return np.meshgrid(longitudes, latitudes)


def _octaves(shape, seed, octaves=10, decay=0.78):
    """Value noise summed over octaves, periodic in longitude so the seam does not show.

    Ten octaves with a slow amplitude decay, because the finest octave has to reach the scale
    the renderer's gradient samples -- four texels at this resolution. Six octaves with a fast
    decay left the finest features at thirty-two texels and height steps of 36 m, below the
    78 m the compositor's 8-bit height encoding can even represent, so the field arrived at the
    shader perfectly flat.
    """
    height, width = shape
    generator = np.random.default_rng(seed)
    total = np.zeros(shape, dtype=np.float64)
    amplitude = 1.0
    normalisation = 0.0
    for octave in range(octaves):
        cells_x = max(4, (2 ** (octave + 2)))
        cells_y = max(2, cells_x // 2)
        lattice = generator.random((cells_y + 1, cells_x))
        # Wrap in longitude by reusing the first column, and clamp in latitude.
        lattice = np.concatenate([lattice, lattice[:, :1]], axis=1)
        rows = np.linspace(0, cells_y, height, endpoint=False)
        columns = np.linspace(0, cells_x, width, endpoint=False)
        row0 = np.floor(rows).astype(int)
        column0 = np.floor(columns).astype(int)
        row_fraction = (rows - row0)[:, None]
        column_fraction = (columns - column0)[None, :]
        # Smoothstep, so the interpolated field is continuous in its first derivative and the
        # gradient the renderer takes is not a lattice of steps.
        row_weight = row_fraction * row_fraction * (3 - 2 * row_fraction)
        column_weight = column_fraction * column_fraction * (3 - 2 * column_fraction)
        r0, r1 = np.clip(row0, 0, cells_y), np.clip(row0 + 1, 0, cells_y)
        c0, c1 = column0, column0 + 1
        top = lattice[r0][:, c0] * (1 - column_weight) + lattice[r0][:, c1] * column_weight
        bottom = lattice[r1][:, c0] * (1 - column_weight) + lattice[r1][:, c1] * column_weight
        total += amplitude * (top * (1 - row_weight) + bottom * row_weight)
        normalisation += amplitude
        amplitude *= decay
    return total / normalisation


def _bands(latitude, longitude, phase_offset):
    """A plausible general circulation: an ITCZ, two storm tracks, two dry belts.

    Cloud is placed where the real atmosphere puts it so that a capture can be
    read against a weather map rather than against noise.
    """
    itcz = np.exp(-(((latitude - 5.0 * np.cos(phase_offset)) / 7.0) ** 2))
    storm_north = np.exp(-(((latitude - 52.0) / 13.0) ** 2))
    storm_south = np.exp(-(((latitude + 55.0) / 13.0) ** 2))
    subtropical_dry = 1.0 - 0.75 * np.exp(-(((np.abs(latitude) - 25.0) / 9.0) ** 2))

    # Waves along each band so the field has structure to take a gradient of.
    wave = (
        0.55
        + 0.45 * np.sin(np.deg2rad(longitude * 3.0) + phase_offset)
        * np.cos(np.deg2rad(latitude * 4.0) + phase_offset * 0.5)
    )
    # Modulate the bands rather than gating them: a multiplicative gate zeroed half the globe
    # and left a cloud fraction near a tenth, where the real figure is around two thirds.
    envelope = np.clip(itcz * 1.25 + storm_north + storm_south + 0.12, 0.0, 1.8) * subtropical_dry
    # Weight the longitudinal wave heavily: without it the bands close into solid zonal belts
    # that no weather map has ever looked like, which makes a poor thing to compare against.
    modulated = envelope * (0.18 + 0.82 * wave)
    # Detail down to a few texels, which is the scale the renderer's gradient actually samples.
    detail = _octaves(latitude.shape, seed=int(phase_offset * 1000) + 17)
    return np.clip(modulated * (0.55 + 0.95 * detail), 0.0, 1.6)


def build_fields(width, height, phase_offset):
    longitude, latitude = _grid(width, height)
    field = _bands(latitude, longitude, phase_offset)
    # Threshold calibrated to an area-weighted cloud fraction near the observed global 0.67.
    cloud_mask = (field > 0.14).astype(np.int16)

    # Deep convection in the ITCZ, thin cirrus at the edges of every band.
    optical_depth = np.clip(field ** 2 * 34.0, 0.0, 120.0).astype(np.float32)
    # Tops follow thickness the way the atmosphere does: towers where the deck is
    # thick, low marine stratus where it is thin. This is the field whose slope
    # the renderer turns into a surface normal.
    # Tops carry their own fine structure as well as following thickness: a deck is not a
    # smooth function of how thick it is, and the renderer shades by this field's slope.
    relief = _octaves(latitude.shape, seed=int(phase_offset * 1000) + 91)
    height_km = np.clip(
        1.0 + field * 8.0 + np.exp(-(((latitude) / 9.0) ** 2)) * field * 5.0 + relief * field * 13.0,
        0.0, MAX_CLOUD_HEIGHT_KM,
    )
    reflectance = np.clip(0.08 + field * 0.62, 0.0, 1.0).astype(np.float32)
    # Ice above roughly nine kilometres, water below, which is where the phase
    # boundary actually sits.
    phase = np.where(height_km > 9.0, 2, 1).astype(np.int16)
    phase = np.where(cloud_mask > 0, phase, 0).astype(np.int16)

    # A scan pattern: a geostationary composite is not observed all at once.
    age_seconds = (np.abs(longitude) / 180.0 * 2100.0 + np.abs(latitude) / 90.0 * 400.0).astype(np.float32)
    # One unobserved wedge, so the coverage figure is honest and below one.
    unobserved = (longitude > 150.0) & (np.abs(latitude) < 40.0)
    quality = np.where(unobserved, 0.0, 0.93).astype(np.float32)

    return {
        "cloud_mask": cloud_mask,
        "cloud_optical_depth": optical_depth,
        "ref_0.63um": reflectance,
        "cloud_phase": phase,
        "cloud_eff_height": height_km.astype(np.float32),
        "relative_time": age_seconds,
        "quality": quality,
    }


def write_granule(path, valid_at, width, height, phase_offset):
    fields = build_fields(width, height, phase_offset)
    observed_from = valid_at - timedelta(minutes=10)
    stamp = lambda moment: moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    with h5py.File(path, "w") as target:
        for name, values in fields.items():
            target.create_dataset(name, data=values, compression="gzip", compression_opts=4)
        target.attrs["time_coverage_start"] = stamp(observed_from)
        target.attrs["time_coverage_end"] = stamp(valid_at)
        target.attrs["date_created"] = stamp(valid_at + timedelta(minutes=18))
        # The version travels into the dataset id the client displays, so the
        # word "fixture" reaches the provenance panel rather than stopping here.
        target.attrs["product_version"] = FIXTURE_VERSION
    return {
        "validAt": stamp(valid_at),
        "observedFrom": stamp(observed_from),
        "observedTo": stamp(valid_at),
        "producedAt": stamp(valid_at + timedelta(minutes=18)),
        "version": FIXTURE_VERSION,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, help="directory to write the granules into")
    parser.add_argument("--valid-at", required=True, help="ISO instant of the newer frame")
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--height", type=int, default=2048)
    parser.add_argument("--plan", required=True, help="where to write the frame descriptions")
    arguments = parser.parse_args()

    import json
    from pathlib import Path

    output = Path(arguments.output)
    output.mkdir(parents=True, exist_ok=True)
    newer = datetime.fromisoformat(arguments.valid_at.replace("Z", "+00:00"))
    frames = []
    for index, valid_at in enumerate([newer - timedelta(hours=1), newer]):
        path = output / f"satcorps-fixture-{index}.h5"
        frames.append({
            **write_granule(path, valid_at, arguments.width, arguments.height, phase_offset=index * 0.6),
            "path": str(path),
        })
    Path(arguments.plan).write_text(json.dumps({"frames": frames}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(frames)} SatCORPS fixture granules to {output}")


if __name__ == "__main__":
    main()
