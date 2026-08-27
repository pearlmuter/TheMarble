import importlib.util
import pathlib
import tempfile
import unittest

import h5py
import numpy as np


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "gmgsi_compositor.py"
SPEC = importlib.util.spec_from_file_location("gmgsi_compositor", SCRIPT)
gmgsi = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gmgsi)


class CloudReconstructionFixtures(unittest.TestCase):
    def test_visible_and_longwave_product_versions_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [pathlib.Path(directory) / name for name in ("visible.nc", "longwave.nc")]
            for path, version in zip(paths, ("v3r0", "v3r1")):
                with h5py.File(path, "w") as source:
                    source.create_dataset("data", data=np.zeros((1, 2, 4), dtype=np.uint8))
                    source.create_dataset("dqf", data=np.zeros((1, 2, 4), dtype=np.uint8))
                    source.create_dataset("lat", data=np.array([60, -60], dtype=np.float32))
                    source.create_dataset("lon", data=np.array([180, -90, 0, 90], dtype=np.float32))
                    source.attrs["time_coverage_start"] = "2026-08-25T17:00:00Z"
                    source.attrs["time_coverage_end"] = "2026-08-25T17:09:59Z"
                    source.attrs["date_created"] = "2026-08-25T17:43:00Z"
                    source.attrs["history"] = version
                    source.attrs["title"] = "GMGSI fixture"
                    source.attrs["geospatial_lat_min"] = np.array([-60], dtype=np.float32)
                    source.attrs["geospatial_lat_max"] = np.array([60], dtype=np.float32)

            with self.assertRaisesRegex(ValueError, "product versions"):
                gmgsi.compose(
                    paths[0], paths[1],
                    pathlib.Path(directory) / "cloud.png",
                    pathlib.Path(directory) / "density.png",
                    pathlib.Path(directory) / "metadata.json",
                    4, 4,
                )

    def test_representative_weather_and_ambiguity(self):
        # convection, thin cloud, clear desert, darkness, snow/ice ambiguity, no data
        visible = np.array([230, 110, 200, 0, 235, 0], dtype=np.float32)
        longwave = np.array([230, 140, 55, 210, 80, 0], dtype=np.float32)
        visible_background = np.array([80, 80, 200, 0, 235, 0], dtype=np.float32)
        longwave_background = np.array([90, 110, 55, 100, 80, 0], dtype=np.float32)
        visible_good = np.array([1, 1, 1, 0, 1, 0], dtype=bool)
        longwave_good = np.array([1, 1, 1, 1, 1, 0], dtype=bool)

        opacity, confidence, visible_contribution = gmgsi.classify_cloud_pixels(
            visible,
            longwave,
            visible_good,
            longwave_good,
            visible_background,
            longwave_background,
        )

        self.assertGreater(opacity[0], 0.8)
        self.assertGreater(opacity[1], 0.2)
        self.assertLess(opacity[1], 0.8)
        self.assertLess(opacity[2], 0.25)
        self.assertGreater(opacity[3], 0.7)
        self.assertLess(opacity[4], 0.4)
        self.assertEqual(opacity[5], 0)
        self.assertGreater(confidence[3], 0.8)
        self.assertEqual(confidence[5], 0)
        self.assertEqual(visible_contribution[3], 0)

    def test_reprojection_uses_longitude_seam_and_nonuniform_latitudes(self):
        values = np.array([
            [40, 10, 20, 30],
            [44, 11, 22, 33],
            [48, 12, 24, 36],
        ], dtype=np.float32)
        latitudes = np.array([60, 5, -60], dtype=np.float32)
        longitudes = np.array([180, -90, 0, 90], dtype=np.float32)

        projected, coverage = gmgsi.reproject_to_equirectangular(
            values,
            np.ones_like(values, dtype=bool),
            latitudes,
            longitudes,
            target_width=4,
            target_height=5,
        )

        np.testing.assert_allclose(projected[2], [11, 22, 33, 44], atol=0.6)
        self.assertFalse(coverage[0].any())
        self.assertFalse(coverage[-1].any())
        self.assertTrue(coverage[2].all())

    def test_incomplete_longwave_coverage_is_rejected_before_publication(self):
        coverage = np.ones((180, 360), dtype=bool)
        coverage[:, :90] = False

        with self.assertRaisesRegex(ValueError, "longwave coverage"):
            gmgsi.validate_observation_coverage(coverage, minimum_fraction=0.90)

    def test_cold_polar_surface_is_suppressed_but_structured_polar_cloud_survives(self):
        opacity, _, _ = gmgsi.classify_cloud_pixels(
            visible=np.array([0, 0], dtype=np.float32),
            longwave=np.array([210, 230], dtype=np.float32),
            visible_good=np.array([0, 0], dtype=bool),
            longwave_good=np.array([1, 1], dtype=bool),
            visible_background=np.array([0, 0], dtype=np.float32),
            longwave_background=np.array([200, 140], dtype=np.float32),
            latitude_degrees=np.array([70, 65], dtype=np.float32),
        )

        self.assertLess(opacity[0], 0.35)
        self.assertGreater(opacity[1], 0.65)

    def test_quality_gap_edges_are_feathered_without_claiming_coverage_inside_the_gap(self):
        coverage = np.ones((64, 64), dtype=bool)
        coverage[20:44, 20:44] = False

        feather = gmgsi.feather_coverage(coverage, radius=4)

        self.assertEqual(feather[32, 32], 0)
        self.assertEqual(feather[0, 0], 1)
        self.assertGreater(feather[19, 32], 0)
        self.assertLess(feather[19, 32], 1)


if __name__ == "__main__":
    unittest.main()
