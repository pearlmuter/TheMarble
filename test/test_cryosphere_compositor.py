import importlib.util
import pathlib
import unittest

import numpy as np


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "cryosphere_compositor.py"
SPEC = importlib.util.spec_from_file_location("cryosphere_compositor", SCRIPT)
cryosphere = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cryosphere)


class DailyCryosphereFixtures(unittest.TestCase):
    def compose(self, ims, fallback_snow=None, fallback_ice=None, viirs=None, quality=None):
        shape = ims.shape
        return cryosphere.compose_cryosphere(
            ims_classes=ims,
            fallback_snow=np.zeros(shape, dtype=np.float32) if fallback_snow is None else fallback_snow,
            fallback_sea_ice=np.zeros(shape, dtype=np.float32) if fallback_ice is None else fallback_ice,
            viirs_snow=viirs,
            viirs_quality=quality,
        )

    def test_daily_accumulation_from_ims_changes_land_albedo_not_cloud(self):
        ims = np.array([[2, 4], [1, 3]], dtype=np.uint8)
        snow, sea_ice, provenance, _ = self.compose(ims)

        np.testing.assert_array_equal(snow, [[0, 1], [0, 0]])
        np.testing.assert_array_equal(sea_ice, [[0, 0], [0, 1]])
        self.assertEqual(provenance[0, 1], cryosphere.SOURCE_IMS)

    def test_high_confidence_sunlit_clear_viirs_can_refine_a_snow_edge_during_melt(self):
        ims = np.array([[2, 4, 4], [2, 4, 4], [2, 4, 4]], dtype=np.uint8)
        viirs = np.ones((3, 3), dtype=np.float32)
        viirs[:, 1] = 0
        quality = np.ones((3, 3), dtype=np.float32)

        snow, _, provenance, _ = self.compose(ims, viirs=viirs, quality=quality)

        self.assertEqual(snow[1, 1], 0)
        self.assertEqual(provenance[1, 1], cryosphere.SOURCE_VIIRS)
        self.assertEqual(snow[1, 2], 1)

    def test_cloud_over_snow_cannot_erase_trusted_analysis(self):
        ims = np.full((3, 3), 4, dtype=np.uint8)
        viirs = np.zeros((3, 3), dtype=np.float32)
        quality = np.zeros((3, 3), dtype=np.float32)

        snow, _, provenance, _ = self.compose(ims, viirs=viirs, quality=quality)

        self.assertTrue(np.all(snow == 1))
        self.assertTrue(np.all(provenance == cryosphere.SOURCE_IMS))

    def test_darkness_cannot_erase_trusted_analysis(self):
        ims = np.array([[4, 4], [4, 4]], dtype=np.uint8)
        viirs = np.zeros((2, 2), dtype=np.float32)
        quality = np.full((2, 2), cryosphere.QUALITY_DARK, dtype=np.float32)

        snow, _, _, _ = self.compose(ims, viirs=viirs, quality=quality)

        self.assertTrue(np.all(snow == 1))

    def test_sea_ice_boundary_remains_separate_from_land_snow(self):
        ims = np.array([[2, 4, 1, 3]], dtype=np.uint8)
        snow, sea_ice, _, _ = self.compose(ims)

        np.testing.assert_array_equal(snow, [[0, 1, 0, 0]])
        np.testing.assert_array_equal(sea_ice, [[0, 0, 0, 1]])

    def test_global_analysis_fills_southern_and_missing_ims_coverage(self):
        ims = np.array([[4, 2], [0, 0]], dtype=np.uint8)
        fallback_snow = np.array([[0, 0], [.8, 0]], dtype=np.float32)
        fallback_ice = np.array([[0, 0], [0, .65]], dtype=np.float32)

        snow, sea_ice, provenance, sea_ice_provenance = self.compose(ims, fallback_snow, fallback_ice)

        self.assertEqual(snow[0, 0], 1)
        self.assertAlmostEqual(float(snow[1, 0]), .8)
        self.assertAlmostEqual(float(sea_ice[1, 1]), .65)
        self.assertEqual(provenance[1, 0], cryosphere.SOURCE_GLOBAL_FALLBACK)
        self.assertEqual(sea_ice_provenance[1, 1], cryosphere.SOURCE_GLOBAL_FALLBACK)


if __name__ == "__main__":
    unittest.main()


class NorthernOnlyAnalysis(unittest.TestCase):
    """No global analysis has a public endpoint that serves values, so IMS may be
    the only source. The globe outside it is unobserved, not bare ground."""

    def test_without_a_global_fallback_only_ims_is_claimed_as_observed(self):
        ims = np.zeros((8, 4), dtype=np.uint8)
        ims[:4, :] = 2
        ims[0, :] = 4
        unobserved = np.full(ims.shape, np.nan, dtype=np.float32)
        snow, sea_ice, snow_source, sea_ice_source = cryosphere.compose_cryosphere(ims, unobserved, unobserved)

        self.assertTrue(np.all(snow[0, :] == 1.0))
        self.assertTrue(np.all(snow[4:, :] == 0.0))
        self.assertTrue(np.all(snow_source[:4, :] == cryosphere.SOURCE_IMS))
        # Nothing is claimed south of the analysis.
        self.assertTrue(np.all(snow_source[4:, :] == cryosphere.SOURCE_NONE))
        self.assertTrue(np.all(sea_ice_source[4:, :] == cryosphere.SOURCE_NONE))

    def test_unobserved_cells_carry_no_confidence(self):
        ims = np.zeros((4, 2), dtype=np.uint8)
        ims[:2, :] = 2
        unobserved = np.full(ims.shape, np.nan, dtype=np.float32)
        _, _, snow_source, _ = cryosphere.compose_cryosphere(ims, unobserved, unobserved)
        texture = cryosphere._texture(np.zeros(ims.shape, dtype=np.float32), snow_source)
        self.assertTrue(np.all(texture[2:, :, 1] == 0.0))
        self.assertTrue(np.all(texture[:2, :, 1] == 1.0))
