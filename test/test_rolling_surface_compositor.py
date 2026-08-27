import unittest

import numpy as np

from scripts.rolling_surface_compositor import BASELINE_AGE, compose_rolling_surface, decode_provider_observation


def observation(rgb, **overrides):
    height, width = rgb.shape[:2]
    fields = {
        "product": "viirs-surface-reflectance",
        "reflectance": rgb,
        "land": np.ones((height, width), dtype=bool),
        "quality": np.full((height, width), 0.9, dtype=np.float32),
        "cloud": np.zeros((height, width), dtype=bool),
        "cloud_shadow": np.zeros((height, width), dtype=bool),
        "haze": np.zeros((height, width), dtype=bool),
        "geometry_quality": np.ones((height, width), dtype=np.float32),
        "age_days": np.ones((height, width), dtype=np.float32),
        "window_index": 7,
    }
    fields.update(overrides)
    return fields


class RollingSurfaceCompositorTests(unittest.TestCase):
    def test_clear_updates_and_rejected_pixels_retain_clean_surface_and_age(self):
        baseline = np.full((1, 5, 3), 0.1, dtype=np.float32)
        previous = np.full((1, 5, 3), 0.2, dtype=np.float32)
        previous_age = np.array([[2, 2, 2, 2, BASELINE_AGE]], dtype=np.uint16)
        previous_source = np.array([[1, 1, 1, 1, 0]], dtype=np.uint8)
        rgb = np.full((1, 5, 3), 0.3, dtype=np.float32)
        result = compose_rolling_surface(
            seasonal_baseline=baseline,
            previous_surface=previous,
            previous_age_days=previous_age,
            previous_source=previous_source,
            previous_window_index=np.array([[4, 4, 4, 4, 0]], dtype=np.uint8),
            observations=[observation(
                rgb,
                cloud=np.array([[False, True, False, False, False]]),
                cloud_shadow=np.array([[False, False, True, False, False]]),
                haze=np.array([[False, False, False, True, False]]),
                geometry_quality=np.array([[1.0, 1.0, 1.0, 1.0, 0.1]], dtype=np.float32),
            )],
            elapsed_days=3,
            max_daily_change=1,
            seam_feather_pixels=0,
        )

        self.assertTrue(result["updated"][0, 0])
        self.assertEqual(result["source"][0, 0], 2)
        self.assertEqual(result["window_index"][0, 0], 7)
        self.assertEqual(result["age_days"][0, 0], 1)
        np.testing.assert_array_equal(result["updated"][0, 1:], False)
        np.testing.assert_allclose(result["surface"][0, 1:4], previous[0, 1:4])
        np.testing.assert_array_equal(result["age_days"][0, 1:4], [5, 5, 5])
        np.testing.assert_array_equal(result["window_index"][0, 1:4], [4, 4, 4])
        np.testing.assert_allclose(result["surface"][0, 4], baseline[0, 4])
        self.assertEqual(result["age_days"][0, 4], BASELINE_AGE)
        self.assertEqual(result["source"][0, 4], 0)
        self.assertEqual(result["window_index"][0, 4], 0)

    def test_robust_normalization_reduces_a_scene_wide_brightness_jump(self):
        baseline = np.zeros((1, 2, 3), dtype=np.float32)
        previous = np.array([[[0.2, 0.2, 0.2], [0.4, 0.4, 0.4]]], dtype=np.float32)
        brighter = np.array([[[0.3, 0.3, 0.3], [0.6, 0.6, 0.6]]], dtype=np.float32)
        result = compose_rolling_surface(
            seasonal_baseline=baseline,
            previous_surface=previous,
            previous_age_days=np.array([[4, 4]], dtype=np.uint16),
            previous_source=np.array([[1, 1]], dtype=np.uint8),
            previous_window_index=np.array([[3, 3]], dtype=np.uint8),
            observations=[observation(brighter)],
            elapsed_days=1,
            max_daily_change=1,
        )

        np.testing.assert_allclose(result["normalization"][0]["gain"], [0.75, 0.75, 0.75])
        np.testing.assert_allclose(result["surface"], [[[0.225, 0.225, 0.225], [0.45, 0.45, 0.45]]], atol=1e-6)

    def test_swath_edges_are_feathered_inside_the_accepted_region(self):
        baseline = np.full((1, 7, 3), 0.2, dtype=np.float32)
        land = np.array([[False, False, True, True, True, False, False]])
        result = compose_rolling_surface(
            seasonal_baseline=baseline,
            observations=[observation(np.full((1, 7, 3), 0.6, dtype=np.float32), land=land)],
            elapsed_days=1,
            max_daily_change=1,
            seam_feather_pixels=2,
        )

        self.assertAlmostEqual(float(result["surface"][0, 1, 0]), 0.2, places=6)
        self.assertLess(float(result["surface"][0, 2, 0] - result["surface"][0, 1, 0]), 0.1)
        self.assertGreater(float(result["surface"][0, 3, 0]), float(result["surface"][0, 2, 0]))
        self.assertLess(float(result["surface"][0, 4, 0] - result["surface"][0, 5, 0]), 0.1)

    def test_delayed_clear_pixels_fill_older_land_without_overwriting_fresher_land(self):
        baseline = np.full((1, 2, 3), 0.1, dtype=np.float32)
        previous = np.full((1, 2, 3), 0.2, dtype=np.float32)
        delayed = observation(
            np.full((1, 2, 3), 0.4, dtype=np.float32),
            age_days=np.array([[8, 8]], dtype=np.float32),
        )
        result = compose_rolling_surface(
            seasonal_baseline=baseline,
            previous_surface=previous,
            previous_age_days=np.array([[1, 12]], dtype=np.uint16),
            previous_source=np.array([[2, 1]], dtype=np.uint8),
            previous_window_index=np.array([[2, 1]], dtype=np.uint16),
            observations=[delayed],
            elapsed_days=0,
            seam_feather_pixels=0,
            max_daily_change=1,
        )

        self.assertFalse(result["updated"][0, 0])
        self.assertTrue(result["updated"][0, 1])
        self.assertEqual(result["age_days"][0, 0], 1)
        self.assertEqual(result["age_days"][0, 1], 8)

    def test_contiguous_tiles_receive_independent_color_normalization(self):
        baseline = np.full((1, 4, 3), 0.3, dtype=np.float32)
        biased = np.array([[[0.4] * 3, [0.4] * 3, [0.2] * 3, [0.2] * 3]], dtype=np.float32)
        result = compose_rolling_surface(
            seasonal_baseline=baseline,
            observations=[observation(biased, tile_id=np.array([[1, 1, 2, 2]], dtype=np.uint16))],
            elapsed_days=1,
            seam_feather_pixels=0,
            max_daily_change=1,
        )

        self.assertLess(abs(float(result["surface"][0, 1, 0] - result["surface"][0, 2, 0])), 0.06)
        self.assertEqual(len(result["normalization"][0]["tiles"]), 2)

    def test_provider_qa_bits_are_decoded_before_composition(self):
        mcd = decode_provider_observation({
            "nbar_rgb": np.array([[[1000, 2000, 3000], [1000, 2000, 3000]]], dtype=np.uint16),
            "mandatory_quality_rgb": np.array([[[0, 0, 0], [1, 0, 0]]], dtype=np.uint8),
            "land": np.ones((1, 2), dtype=bool),
            "age_days": np.ones((1, 2), dtype=np.float32),
        }, "mcd43a4-nbar", 1)
        np.testing.assert_allclose(mcd["reflectance"][0, 0], [0.1, 0.2, 0.3], atol=1e-6)
        self.assertGreater(mcd["quality"][0, 0], 0.9)
        self.assertEqual(mcd["quality"][0, 1], 0)

        viirs = decode_provider_observation({
            "surface_reflectance_rgb": np.full((1, 3, 3), 2000, dtype=np.int16),
            "qf1": np.array([[3, 15, 3]], dtype=np.uint8),
            "qf2": np.array([[0, 0, 8]], dtype=np.uint8),
            "qf3": np.zeros((1, 3), dtype=np.uint8),
            "qf5": np.zeros((1, 3), dtype=np.uint8),
            "qf7": np.zeros((1, 3), dtype=np.uint8),
            "age_days": np.ones((1, 3), dtype=np.float32),
        }, "viirs-surface-reflectance", 2)
        self.assertFalse(viirs["cloud"][0, 0])
        self.assertTrue(viirs["cloud"][0, 1])
        self.assertTrue(viirs["cloud_shadow"][0, 2])

    def test_first_run_without_accepted_observations_is_only_the_seasonal_fallback(self):
        baseline = np.array([[[0.12, 0.18, 0.24]]], dtype=np.float32)
        rejected = observation(
            np.array([[[0.8, 0.8, 0.8]]], dtype=np.float32),
            quality=np.array([[0.2]], dtype=np.float32),
        )
        result = compose_rolling_surface(
            seasonal_baseline=baseline,
            observations=[rejected],
            elapsed_days=1,
        )

        np.testing.assert_allclose(result["surface"], baseline)
        self.assertEqual(result["source"][0, 0], 0)
        self.assertEqual(result["age_days"][0, 0], BASELINE_AGE)
        self.assertEqual(result["coverage"], {"rollingFraction": 0.0, "updatedFraction": 0.0, "baselineFraction": 1.0})


if __name__ == '__main__':
    unittest.main()
