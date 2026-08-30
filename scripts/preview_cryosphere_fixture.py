#!/usr/bin/env python3
"""Synthesise a daily cryosphere delivery for local visual acceptance.

Local development can reach the public NOAA GMGSI bucket without credentials,
but the daily IMS/GMASI/VIIRS endpoints are operations-owned. This fixture
stands in for them so `npm run preview:live` can exercise the real adapter,
compositor, and publisher end to end. The state it produces is a plausible
seasonal approximation, never an observation: the preview publisher labels
every layer it creates as a local fixture.
"""

import argparse
import json
import pathlib

import numpy as np


def _latitudes(height):
    return 90.0 - (np.arange(height, dtype=np.float64) + 0.5) * (180.0 / height)


def _seasonal_edge(day_of_year, summer_edge, winter_edge, southern):
    """Interpolate a polar edge between its summer minimum and winter maximum.

    The fixture stays inside the polar caps on purpose. It stands in for an
    unavailable analysis, so it must never invent mid-latitude snow or an
    ocean full of ice that a viewer could mistake for an observation.
    """
    # Northern winter peaks in early March, southern winter in early September.
    phase = np.cos(2.0 * np.pi * (day_of_year - (247 if southern else 65)) / 365.25)
    edge = summer_edge + (winter_edge - summer_edge) * (0.5 + 0.5 * phase)
    return -edge if southern else edge


def build(width, height, day_of_year):
    latitudes = _latitudes(height)
    grid = np.broadcast_to(latitudes[:, None], (height, width))
    northern_snow = _seasonal_edge(day_of_year, 72.0, 55.0, southern=False)
    southern_snow = _seasonal_edge(day_of_year, 70.0, 66.0, southern=True)
    northern_ice = _seasonal_edge(day_of_year, 76.0, 68.0, southern=False)
    southern_ice = _seasonal_edge(day_of_year, 68.0, 60.0, southern=True)

    snow = np.zeros((height, width), dtype=np.float32)
    snow[grid >= northern_snow] = 1.0
    snow[grid <= southern_snow] = 1.0
    sea_ice = np.zeros((height, width), dtype=np.float32)
    sea_ice[grid >= northern_ice] = 1.0
    sea_ice[grid <= southern_ice] = 1.0

    # IMS classes: 0 outside coverage, 2 snow-free land, 3 sea ice, 4 snow.
    ims = np.zeros((height, width), dtype=np.uint8)
    northern = grid >= 0.0
    ims[northern] = 2
    ims[northern & (snow > 0.5)] = 4
    ims[northern & (sea_ice > 0.5)] = 3
    return ims, snow, sea_ice


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--height", type=int, default=2048)
    parser.add_argument("--day-of-year", type=int, required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--valid-at", required=True)
    parser.add_argument("--produced-at", required=True)
    arguments = parser.parse_args()

    directory = pathlib.Path(arguments.output)
    directory.mkdir(parents=True, exist_ok=True)
    ims, snow, sea_ice = build(arguments.width, arguments.height, arguments.day_of_year)
    for name, array in (("ims", ims), ("snow", snow), ("sea-ice", sea_ice)):
        np.save(directory / f"delivered-{name}.npy", array)

    common = {
        "validAt": arguments.valid_at,
        "producedAt": arguments.produced_at,
        "input": {"kind": "regular"},
    }
    plan = {
        "retrievedAt": arguments.produced_at,
        "width": arguments.width,
        "height": arguments.height,
        "sources": [
            {
                **common,
                "product": "ims-snow-ice",
                "version": "local-preview-fixture",
                "attribution": "Local preview fixture (not an observation)",
                "input": {"kind": "regular", "path": str(directory / "delivered-ims.npy")},
                "semantics": {"type": "classes"},
            },
            {
                **common,
                "product": "gmasi-snow",
                "version": "local-preview-fixture",
                "attribution": "Local preview fixture (not an observation)",
                "input": {"kind": "regular", "path": str(directory / "delivered-snow.npy")},
                "semantics": {"type": "fraction"},
            },
            {
                **common,
                "product": "gmasi-sea-ice",
                "version": "local-preview-fixture",
                "attribution": "Local preview fixture (not an observation)",
                "input": {"kind": "regular", "path": str(directory / "delivered-sea-ice.npy")},
                "semantics": {"type": "fraction"},
            },
        ],
    }
    pathlib.Path(arguments.plan).write_text(json.dumps(plan, indent=2) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
