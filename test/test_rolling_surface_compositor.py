import unittest

import numpy as np

from scripts.rolling_surface_compositor import BASELINE_AGE, compose_rolling_surface


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
