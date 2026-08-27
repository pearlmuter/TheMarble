import importlib.util
import pathlib
import unittest

import numpy as np


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "satcorps_compositor.py"
SPEC = importlib.util.spec_from_file_location("satcorps_compositor", SCRIPT)
satcorps = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(satcorps)


class SatcorpsPhysicalCloudFixtures(unittest.TestCase):
    def setUp(self):
        # clear, low liquid, thin ice cirrus, deep ice convection, rejected retrieval
        self.fields = {
            "cloud_mask": np.array([[0, 1, 1, 1, 1]], dtype=bool),
            "optical_depth": np.array([[0.0, 12.0, 0.7, 85.0, 30.0]], dtype=np.float32),
            "reflectance": np.array([[0.02, 0.62, 0.18, 0.94, 0.8]], dtype=np.float32),
            "phase": np.array([[0, 1, 2, 2, 1]], dtype=np.uint8),
            "height_km": np.array([[0.0, 1.5, 11.5, 15.8, 4.0]], dtype=np.float32),
            "age_seconds": np.array([[120, 180, 360, 480, 120]], dtype=np.float32),
            "quality": np.array([[1.0, 0.95, 0.9, 1.0, 0.1]], dtype=np.float32),
        }

    def test_physical_fields_pack_high_low_thin_and_dense_clouds_without_inventing_bad_pixels(self):
        result = satcorps.harmonize_fields(**self.fields)

        opacity = result["cloud_opacity"][0, :, 1]
        density = result["cloud_density"][0, :, 0]
        physics = result["cloud_physics"][0]
        age = result["cloud_age"][0]

        self.assertEqual(opacity[0], 0)
        self.assertGreater(opacity[1], opacity[2])
        self.assertLess(opacity[2], 0.6)
        self.assertGreater(opacity[3], 0.95)
        self.assertEqual(opacity[4], 0)
        self.assertEqual(density[4], 0)

        self.assertLess(physics[1, 2], 0.15)  # 1.5 km liquid deck
        self.assertGreater(physics[2, 2], 0.5)  # 11.5 km cirrus
        self.assertGreater(physics[3, 0], physics[1, 0])  # optical thickness
        self.assertLess(physics[1, 1], 0.25)  # liquid
        self.assertGreater(physics[2, 1], 0.75)  # ice
        self.assertGreater(age[3], age[1])
        self.assertEqual(physics[4, 3], 0)

    def test_shape_nonfinite_ranges_and_insufficient_usable_coverage_are_rejected(self):
        bad_shape = dict(self.fields, height_km=np.zeros((2, 5), dtype=np.float32))
        with self.assertRaisesRegex(ValueError, "same shape"):
            satcorps.harmonize_fields(**bad_shape)

        bad_values = dict(self.fields, optical_depth=self.fields["optical_depth"].copy())
        bad_values["optical_depth"][0, 2] = np.nan
        result = satcorps.harmonize_fields(**bad_values)
        self.assertEqual(result["cloud_opacity"][0, 2, 1], 0)

        quality = np.zeros((10, 100), dtype=np.float32)
        quality[:, :89] = 1.0
        with self.assertRaisesRegex(ValueError, "usable coverage"):
            satcorps.validate_usable_coverage(quality >= .5, minimum_fraction=.9)

        corrupt = dict(
            self.fields,
            cloud_mask=np.ones_like(self.fields["cloud_mask"], dtype=bool),
            optical_depth=np.full_like(self.fields["optical_depth"], np.nan),
        )
        corrupt_result = satcorps.harmonize_fields(**corrupt)
        with self.assertRaisesRegex(ValueError, "usable coverage"):
            satcorps.validate_usable_coverage(corrupt_result["coverage_valid"])

    def test_provider_scaling_and_quality_flags_are_normalized_before_harmonization(self):
        np.testing.assert_allclose(
            satcorps.normalize_reflectance(np.array([0, 18, 100], dtype=np.float32)),
            [0, .18, 1],
        )
        np.testing.assert_array_equal(
            satcorps.quality_from_dqf(np.array([0, 1, 2, 255], dtype=np.uint8)),
            [1, 0, 0, 0],
        )
        with self.assertRaisesRegex(ValueError, "quality or dqf"):
            satcorps.select_quality()
        with self.assertRaisesRegex(ValueError, "reflectance"):
            satcorps.normalize_reflectance(np.array([0, 101], dtype=np.float32))


if __name__ == "__main__":
    unittest.main()
