import gzip
import importlib.util
import pathlib
import shutil
import tempfile
import unittest

import numpy as np
from PIL import Image


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "cryosphere_provider_adapter.py"
SPEC = importlib.util.spec_from_file_location("cryosphere_provider_adapter", SCRIPT)
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


class RegularGridReprojection(unittest.TestCase):
    def test_a_north_up_global_source_keeps_its_hemispheres(self):
        source = np.array([[1, 1], [2, 2]], dtype=np.float32)
        result = adapter.resample_regular(source, adapter.GLOBAL_BOUNDS, width=4, height=4)
        self.assertTrue(np.all(result[:2, :] == 1))
        self.assertTrue(np.all(result[2:, :] == 2))

    def test_a_south_up_source_is_flipped_rather_than_rendered_upside_down(self):
        source = np.array([[1, 1], [2, 2]], dtype=np.float32)
        bounds = dict(adapter.GLOBAL_BOUNDS, north_up=False)
        result = adapter.resample_regular(source, bounds, width=4, height=4)
        self.assertTrue(np.all(result[:2, :] == 2))
        self.assertTrue(np.all(result[2:, :] == 1))

    def test_a_zero_to_three_sixty_source_is_rotated_onto_the_bundle_seam(self):
        source = np.array([[10.0, 20.0]], dtype=np.float32)
        bounds = dict(adapter.GLOBAL_BOUNDS, longitude_from=0.0, longitude_to=360.0)
        result = adapter.resample_regular(source, bounds, width=2, height=1)
        self.assertEqual(result[0, 0], 20.0)
        self.assertEqual(result[0, 1], 10.0)

    def test_a_partial_source_extent_leaves_the_rest_of_the_globe_untouched(self):
        source = np.full((2, 4), 0.8, dtype=np.float32)
        bounds = dict(adapter.GLOBAL_BOUNDS, latitude_from=90.0, latitude_to=0.0)
        result = adapter.resample_regular(source, bounds, width=4, height=4, fill=np.float32(-1))
        self.assertTrue(np.all(result[:2, :] == np.float32(0.8)))
        self.assertTrue(np.all(result[2:, :] == np.float32(-1)))


class ScatteredReprojection(unittest.TestCase):
    def test_polar_stereographic_cells_bin_into_the_target_cell_that_contains_them(self):
        latitudes = np.array([80.0, 80.0, 10.0], dtype=np.float64)
        longitudes = np.array([-170.0, -170.0, 170.0], dtype=np.float64)
        values = np.array([4, 4, 2], dtype=np.uint8)
        result = adapter.resample_scattered(values, latitudes, longitudes, width=4, height=4, aggregate="mode")
        self.assertEqual(result[0, 0], 4)
        self.assertEqual(result[1, 3], 2)
        self.assertEqual(result[3, 3], 0)

    def test_the_majority_class_wins_a_shared_target_cell_instead_of_the_last_writer(self):
        latitudes = np.array([80.0, 80.5, 81.0], dtype=np.float64)
        longitudes = np.array([-170.0, -171.0, -172.0], dtype=np.float64)
        values = np.array([4, 4, 3], dtype=np.uint8)
        result = adapter.resample_scattered(values, latitudes, longitudes, width=4, height=4, aggregate="mode")
        self.assertEqual(result[0, 0], 4)

    def test_fractions_average_across_a_shared_target_cell(self):
        latitudes = np.array([80.0, 80.5], dtype=np.float64)
        longitudes = np.array([-170.0, -171.0], dtype=np.float64)
        values = np.array([1.0, 0.0], dtype=np.float32)
        result = adapter.resample_scattered(values, latitudes, longitudes, width=4, height=4, aggregate="mean")
        self.assertAlmostEqual(float(result[0, 0]), 0.5, places=6)

    def test_samples_outside_the_globe_are_refused_rather_than_wrapped(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            adapter.resample_scattered(
                np.array([1], dtype=np.uint8),
                np.array([95.0], dtype=np.float64),
                np.array([0.0], dtype=np.float64),
                width=4, height=4, aggregate="mode",
            )


class DeclaredClassSemantics(unittest.TestCase):
    def test_a_documented_class_map_converts_provider_classes_into_fractions(self):
        classes = np.array([[0, 1], [2, 3]], dtype=np.uint8)
        result = adapter.map_classes(classes, {"0": 0.0, "1": 0.0, "2": 1.0, "3": 1.0}, "GMASI snow")
        self.assertTrue(np.array_equal(result, np.array([[0.0, 0.0], [1.0, 1.0]], dtype=np.float32)))

    def test_an_undocumented_class_value_is_refused_instead_of_silently_treated_as_bare_ground(self):
        classes = np.array([[0, 7]], dtype=np.uint8)
        with self.assertRaisesRegex(ValueError, "GMASI snow"):
            adapter.map_classes(classes, {"0": 0.0}, "GMASI snow")


class DeclaredClassValues(unittest.TestCase):
    def test_the_documented_ims_class_set_passes_through_unchanged(self):
        grid = np.array([[0, 1], [3, 4]], dtype=np.uint8)
        self.assertTrue(np.array_equal(adapter.require_classes(grid, adapter.IMS_CLASSES, "IMS"), grid))

    def test_rendered_symbology_is_refused_rather_than_published_as_an_analysis(self):
        # A rendered visualisation decodes as a smooth ramp, not a handful of classes.
        ramp = np.arange(0, 240, 2, dtype=np.uint8).reshape(12, 10)
        with self.assertRaisesRegex(ValueError, "rendered symbology"):
            adapter.require_classes(ramp, adapter.IMS_CLASSES, "IMS")


class ViirsQualityScreening(unittest.TestCase):
    def test_sunlit_clear_high_confidence_snow_is_kept_with_full_quality(self):
        ndsi = np.array([[80.0]], dtype=np.float32)
        snow, quality = adapter.screen_viirs(ndsi, np.array([[0]], dtype=np.uint8))
        self.assertGreaterEqual(float(quality[0, 0]), 0.9)
        self.assertGreater(float(snow[0, 0]), 0.0)

    def test_cloud_night_and_no_decision_sentinels_can_never_claim_snow(self):
        for sentinel in (adapter.VIIRS_CLOUD, adapter.VIIRS_NIGHT, adapter.VIIRS_NO_DECISION):
            ndsi = np.array([[float(sentinel)]], dtype=np.float32)
            snow, quality = adapter.screen_viirs(ndsi, np.array([[0]], dtype=np.uint8))
            self.assertEqual(float(quality[0, 0]), 0.0)
            self.assertEqual(float(snow[0, 0]), 0.0)

    def test_a_poor_quality_flag_disqualifies_an_otherwise_plausible_retrieval(self):
        ndsi = np.array([[80.0]], dtype=np.float32)
        snow, quality = adapter.screen_viirs(ndsi, np.array([[3]], dtype=np.uint8))
        self.assertLess(float(quality[0, 0]), 0.9)


class CoverageClaims(unittest.TestCase):
    def test_observed_fraction_is_area_weighted_rather_than_a_pixel_count(self):
        observed = np.zeros((4, 4), dtype=bool)
        observed[:2, :] = True
        self.assertAlmostEqual(adapter.observed_fraction(observed), 0.5, places=6)

        polar = np.zeros((4, 4), dtype=bool)
        polar[0, :] = True
        self.assertLess(adapter.observed_fraction(polar), 0.25)

    def test_the_reported_latitude_range_is_the_extent_actually_observed(self):
        observed = np.zeros((4, 4), dtype=bool)
        observed[:2, :] = True
        self.assertEqual(adapter.latitude_range(observed), (0.0, 90.0))

    def test_an_empty_grid_claims_no_coverage_at_all(self):
        self.assertEqual(adapter.observed_fraction(np.zeros((4, 4), dtype=bool)), 0.0)
        with self.assertRaisesRegex(ValueError, "no observed"):
            adapter.latitude_range(np.zeros((4, 4), dtype=bool))


class DeliveredFormats(unittest.TestCase):
    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def test_a_gzipped_ims_ascii_grid_decodes_to_its_documented_classes(self):
        path = self.directory / "ims2026242_24km_v1.3.asc.gz"
        with gzip.open(path, "wt", encoding="ascii") as handle:
            handle.write("IMS product header\n")
            handle.write("4321\n0124\n")
        self.assertTrue(np.array_equal(
            adapter._load_grid(path),
            np.array([[4, 3, 2, 1], [0, 1, 2, 4]], dtype=np.uint8),
        ))

    def test_a_single_band_geotiff_delivery_decodes_without_a_colour_channel_guess(self):
        path = self.directory / "gmasi.tif"
        Image.fromarray(np.array([[0, 1], [2, 3]], dtype=np.uint8)).save(path)
        self.assertTrue(np.array_equal(adapter._load_grid(path), np.array([[0, 1], [2, 3]], dtype=np.uint8)))

    def test_an_undeliverable_format_is_refused_rather_than_read_as_bytes(self):
        path = self.directory / "gmasi.hdf"
        path.write_bytes(b"not a grid")
        with self.assertRaisesRegex(ValueError, "Unsupported provider input format"):
            adapter._load_grid(path)


class AdaptedProductDescription(unittest.TestCase):
    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def test_an_adapted_northern_ims_delivery_reports_only_the_coverage_it_has(self):
        source_path = self.directory / "ims.npy"
        classes = np.zeros((8, 8), dtype=np.uint8)
        classes[:4, :] = 4
        np.save(source_path, classes)
        product = adapter.adapt_source({
            "product": "ims-snow-ice",
            "validAt": "2026-08-30T00:00:00Z",
            "producedAt": "2026-08-30T04:00:00Z",
            "version": "ims-v1.3",
            "input": {"path": str(source_path), "kind": "regular"},
            "semantics": {"type": "classes"},
        }, width=8, height=8, output_directory=self.directory / "out")
        self.assertEqual(product["coverage"]["latitudeRange"], [0.0, 90.0])
        self.assertAlmostEqual(product["coverage"]["observedFraction"], 0.5, places=3)
        self.assertEqual(product["arrayPath"], "ims-snow-ice.npy")
        self.assertNotIn("qualityArrayPath", product)

    def test_a_candidate_day_key_keeps_several_days_of_one_product_apart(self):
        source_path = self.directory / "ims.npy"
        np.save(source_path, np.full((4, 4), 4, dtype=np.uint8))
        product = adapter.adapt_source({
            "product": "ims-snow-ice",
            "key": "ims-snow-ice@2026-08-29",
            "validAt": "2026-08-29T00:00:00Z",
            "producedAt": "2026-08-29T04:00:00Z",
            "version": "ims-v1.3",
            "input": {"path": str(source_path), "kind": "regular"},
            "semantics": {"type": "classes"},
        }, width=4, height=4, output_directory=self.directory / "out")
        self.assertEqual(product["arrayPath"], "ims-snow-ice@2026-08-29.npy")
        self.assertEqual(product["product"], "ims-snow-ice")
        self.assertTrue((self.directory / "out" / "ims-snow-ice@2026-08-29.npy").exists())

    def test_an_adapted_viirs_delivery_publishes_its_quality_array_beside_the_snow_array(self):
        ndsi = np.full((4, 4), 80.0, dtype=np.float32)
        ndsi[2:, :] = float(adapter.VIIRS_CLOUD)
        np.save(self.directory / "ndsi.npy", ndsi)
        np.save(self.directory / "qa.npy", np.zeros((4, 4), dtype=np.uint8))
        product = adapter.adapt_source({
            "product": "viirs-snow",
            "validAt": "2026-08-30T00:00:00Z",
            "producedAt": "2026-08-30T04:00:00Z",
            "version": "vnp10-nrt-v2",
            "input": {"path": str(self.directory / "ndsi.npy"), "kind": "regular"},
            "semantics": {
                "type": "viirs",
                "quality": {"path": str(self.directory / "qa.npy"), "kind": "regular"},
            },
        }, width=4, height=4, output_directory=self.directory / "out")
        self.assertEqual(product["qualityArrayPath"], "viirs-snow-quality.npy")
        self.assertEqual(product["coverage"]["latitudeRange"], [0.0, 90.0])
        snow = np.load(self.directory / "out" / "viirs-snow.npy")
        self.assertTrue(np.all(snow[2:, :] == 0.0))


if __name__ == "__main__":
    unittest.main()


class PolarStereographicGridFiles(unittest.TestCase):
    """The IMS analysis ships as a square polar grid whose corners fall off the
    projection disc, with the latitude and longitude of every cell in separate
    raw binary files."""

    def test_a_declared_binary_grid_decodes_at_its_stated_shape_and_dtype(self):
        directory = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, directory, True)
        expected = np.arange(12, dtype="<f4").reshape(3, 4)
        path = directory / "grid.bin"
        path.write_bytes(expected.tobytes())
        loaded = adapter._load_grid({"path": str(path), "dtype": "<f4", "shape": [3, 4]})
        self.assertEqual(loaded.shape, (3, 4))
        np.testing.assert_allclose(loaded, expected)

    def test_a_gzipped_binary_grid_decodes_the_same_way(self):
        directory = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, directory, True)
        expected = np.arange(6, dtype="<f4").reshape(2, 3)
        path = directory / "grid.bin.gz"
        with gzip.open(path, "wb") as handle:
            handle.write(expected.tobytes())
        loaded = adapter._load_grid({"path": str(path), "dtype": "<f4", "shape": [2, 3]})
        np.testing.assert_allclose(loaded, expected)

    def test_a_binary_grid_that_is_not_the_declared_size_is_refused(self):
        directory = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, directory, True)
        path = directory / "grid.bin"
        path.write_bytes(np.arange(5, dtype="<f4").tobytes())
        with self.assertRaises(ValueError):
            adapter._load_grid({"path": str(path), "dtype": "<f4", "shape": [3, 4]})

    def test_cells_off_the_projection_disc_are_dropped_rather_than_binned_somewhere(self):
        # The corners of the IMS square carry no coordinate at all. Clipping a
        # NaN would deposit them in a real cell and invent an analysis there.
        latitudes = np.array([80.0, np.nan, 10.0], dtype=np.float64)
        longitudes = np.array([-170.0, np.nan, 170.0], dtype=np.float64)
        values = np.array([4, 4, 2], dtype=np.uint8)
        result = adapter.resample_scattered(values, latitudes, longitudes, width=4, height=4, aggregate="mode")
        self.assertEqual(result[0, 0], 4)
        self.assertEqual(result[1, 3], 2)
        # Nothing anywhere else, and in particular nothing at the clip corner.
        self.assertEqual(int((result > 0).sum()), 2)

    def test_a_dropped_coordinate_does_not_disturb_an_averaged_source(self):
        latitudes = np.array([80.0, np.nan], dtype=np.float64)
        longitudes = np.array([-170.0, np.nan], dtype=np.float64)
        values = np.array([0.5, 0.9], dtype=np.float32)
        result = adapter.resample_scattered(values, latitudes, longitudes, width=4, height=4, aggregate="mean")
        self.assertAlmostEqual(float(result[0, 0]), 0.5, places=6)
        self.assertEqual(int((result > 0).sum()), 1)


class ForwardBinningGaps(unittest.TestCase):
    """A source coarser than the target leaves cells that no source cell landed
    in. Closing them is nearest-neighbour upsampling of the delivered analysis,
    not new information -- but it must respect the shape of the globe."""

    def test_a_cell_no_source_landed_in_takes_its_nearest_neighbour(self):
        grid = np.array([[0, 0, 0], [0, 4, 0], [0, 0, 0]], dtype=np.uint8)
        filled = adapter.close_resampling_gaps(grid, rounds=1)
        self.assertTrue(np.all(filled == 4))

    def test_an_observed_cell_is_never_overwritten(self):
        grid = np.array([[2, 0], [0, 4]], dtype=np.uint8)
        filled = adapter.close_resampling_gaps(grid, rounds=2)
        self.assertEqual(filled[0, 0], 2)
        self.assertEqual(filled[1, 1], 4)

    def test_longitude_wraps_around_the_seam_because_the_globe_does(self):
        grid = np.array([[4, 0, 0, 0]], dtype=np.uint8)
        filled = adapter.close_resampling_gaps(grid, rounds=1)
        # The last column touches the first across the antimeridian.
        self.assertEqual(filled[0, 1], 4)
        self.assertEqual(filled[0, 3], 4)

    def test_latitude_never_wraps_because_the_poles_are_not_neighbours(self):
        # Arctic sea ice must never leak onto Antarctica.
        grid = np.zeros((4, 2), dtype=np.uint8)
        grid[0, :] = 3
        filled = adapter.close_resampling_gaps(grid, rounds=1)
        self.assertTrue(np.all(filled[1, :] == 3))
        self.assertTrue(np.all(filled[3, :] == 0))

    def test_filling_is_bounded_so_a_hemispheric_source_stays_hemispheric(self):
        grid = np.zeros((16, 4), dtype=np.uint8)
        grid[:8, :] = 2
        filled = adapter.close_resampling_gaps(grid, rounds=2)
        self.assertTrue(np.all(filled[:10, :] == 2))
        self.assertTrue(np.all(filled[10:, :] == 0))

    def test_a_grid_with_nothing_in_it_is_left_alone(self):
        grid = np.zeros((3, 3), dtype=np.uint8)
        np.testing.assert_array_equal(adapter.close_resampling_gaps(grid, rounds=3), grid)


class PolarResamplingGaps(unittest.TestCase):
    """Meridians converge, so a fixed number of dilation rounds is a fixed distance
    only at the equator. Near the pole a whole target row spans tens of kilometres,
    and a 24 km analysis reaches only a handful of its cells."""

    @staticmethod
    def _forward_binned(height, width, source_km):
        grid = np.zeros((height, width), dtype=np.int64)
        latitudes = adapter.target_latitudes(height)
        for row in range(height):
            circumference = adapter.EARTH_CIRCUMFERENCE_KM * max(
                np.cos(np.deg2rad(latitudes[row])), 1e-9
            )
            hits = max(1, int(circumference / source_km))
            grid[row, (np.arange(hits) * width) // hits] = 3
        return grid

    def test_a_polar_row_is_closed_rather_than_left_striped(self):
        # The defect this covers reached production: the published sea ice texture
        # averaged 8 of 255 in the top rows against 189 a few degrees south, and the
        # renderer drew the alternating columns as a fan centred on the pole.
        height, width = 256, 512
        binned = self._forward_binned(height, width, source_km=24.0)
        self.assertLess((binned[0] > 0).mean(), 0.05, "the polar row should start almost empty")
        closed = adapter.close_resampling_gaps(binned, 4)
        self.assertEqual((closed[0] > 0).mean(), 1.0)
        self.assertEqual((closed[8] > 0).mean(), 1.0)

    def test_the_equatorial_reach_is_the_cell_count_it_always_was(self):
        # Expressing rounds as a distance must not change what they meant where they
        # were tuned. Four rounds on this grid reach four cells at the equator.
        height, width = 256, 512
        grid = np.zeros((height, width), dtype=np.int64)
        equator = height // 2
        grid[equator, 100] = 5
        closed = adapter.close_resampling_gaps(grid, 4)
        row = closed[equator]
        self.assertTrue((row[96:105] == 5).all(), "four cells either side should be reached")
        self.assertEqual(row[95], 0, "and nothing beyond that")
        self.assertEqual(row[105], 0)

    def test_a_latitude_the_source_never_reached_stays_unobserved(self):
        # The published waiver says the Southern Hemisphere is recorded as unobserved
        # rather than filled. Closing gaps must never quietly extend coverage.
        height, width = 128, 256
        grid = np.zeros((height, width), dtype=np.int64)
        grid[: height // 2] = 3
        closed = adapter.close_resampling_gaps(grid, 4)
        self.assertTrue((closed[height // 2 + 6 :] == 0).all())

    def test_the_fill_wraps_at_the_antimeridian(self):
        height, width = 128, 256
        grid = np.zeros((height, width), dtype=np.int64)
        equator = height // 2
        grid[equator, 0] = 7
        closed = adapter.close_resampling_gaps(grid, 4)
        self.assertEqual(closed[equator, width - 1], 7, "the grid meets itself at the antimeridian")
        self.assertEqual(closed[equator, width - 4], 7)
