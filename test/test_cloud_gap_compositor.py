import importlib.util
import pathlib
import tempfile
import unittest

import numpy as np
from PIL import Image


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "cloud_gap_compositor.py"
SPEC = importlib.util.spec_from_file_location("cloud_gap_compositor", SCRIPT)
cloud_gaps = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cloud_gaps)


def observation(opacity, quality, age_seconds):
    opacity = np.asarray([opacity], dtype=np.float32)
    quality = np.asarray([quality], dtype=np.float32)
    age_seconds = np.asarray([age_seconds], dtype=np.float32)
    appearance = np.stack([0.45 + opacity * 0.45, opacity], axis=-1)
    density = np.stack([opacity, quality, opacity * 0.3], axis=-1)
    return cloud_gaps.ObservedCloudField(appearance, density, quality, age_seconds)


class HonestCloudGapFusion(unittest.TestCase):
    def test_every_pixel_has_an_auditable_source_and_observation_priority(self):
        primary = observation(
            [0.8, 0.0, 0.6, 0.4, 0.0],
            [0.95, 0.0, 0.95, 0.2, 0.0],
            [300, 0, 14_000, 300, 0],
        )
        polar = observation(
            [0.2, 0.7, 0.3, 0.9, 0.0],
            [0.9, 0.96, 0.0, 0.92, 0.0],
            [240, 360, 0, 420, 0],
        )
        model = cloud_gaps.ModelCloudField(
            total_cloud=np.asarray([[0.95, 0.95, 0.65, 0.95, np.nan]], dtype=np.float32),
            run_at="2026-08-25T12:00:00Z",
            forecast_hour=4,
        )
        static = cloud_gaps.StaticCloudField(
            appearance=np.asarray([[[0.55, 0.35]] * 5], dtype=np.float32),
            density=np.asarray([[[0.35, 0.4, 0.0]] * 5], dtype=np.float32),
        )
        result = cloud_gaps.fuse_cloud_gaps(
            primary=primary,
            polar=polar,
            model=model,
            static=static,
            thresholds=cloud_gaps.GapThresholds(
                max_observation_age_seconds=10_800,
                min_observation_quality=0.72,
                seam_blend_pixels=0,
            ),
        )

        np.testing.assert_array_equal(
            result["source_class"],
            [[cloud_gaps.SOURCE_PRIMARY, cloud_gaps.SOURCE_POLAR, cloud_gaps.SOURCE_MODEL,
              cloud_gaps.SOURCE_POLAR, cloud_gaps.SOURCE_STATIC]],
        )
        self.assertAlmostEqual(result["coverage"]["observedFraction"], 0.6)
        self.assertAlmostEqual(result["coverage"]["primaryObservedFraction"], 0.2)
        self.assertAlmostEqual(result["coverage"]["polarObservedFraction"], 0.4)
        self.assertAlmostEqual(result["coverage"]["modelAssistedFraction"], 0.2)
        self.assertAlmostEqual(result["coverage"]["fallbackFraction"], 0.2)
        self.assertTrue(np.isfinite(result["appearance"]).all())
        self.assertTrue(np.isfinite(result["density"]).all())
        self.assertNotIn(cloud_gaps.SOURCE_UNKNOWN, result["source_class"])

    def test_visual_feathering_stays_on_the_gap_side_and_preserves_source_identity(self):
        primary = observation(
            [0.9, 0.9, 0.9, 0.0, 0.0, 0.0, 0.0],
            [0.95, 0.95, 0.95, 0.0, 0.0, 0.0, 0.0],
            [300, 300, 300, 0, 0, 0, 0],
        )
        model = cloud_gaps.ModelCloudField(
            total_cloud=np.zeros((1, 7), dtype=np.float32),
            run_at="2026-08-25T12:00:00Z",
            forecast_hour=4,
        )
        static = cloud_gaps.StaticCloudField(
            appearance=np.zeros((1, 7, 2), dtype=np.float32),
            density=np.zeros((1, 7, 3), dtype=np.float32),
        )
        result = cloud_gaps.fuse_cloud_gaps(
            primary=primary,
            polar=None,
            model=model,
            static=static,
            thresholds=cloud_gaps.GapThresholds(10_800, .72, 2),
        )

        opacity = result["appearance"][0, :, 1]
        self.assertAlmostEqual(opacity[2], 0.9)
        self.assertGreater(opacity[3], 0.0)
        self.assertLess(abs(float(opacity[2] - opacity[3])), 0.9)
        self.assertEqual(result["source_class"][0, 3], cloud_gaps.SOURCE_MODEL)
        self.assertLess(result["provenance"][0, 3, 3], 1.0)

    def test_polar_pixel_age_is_advanced_from_mosaic_time_to_target_frame(self):
        primary = observation([0.0], [0.0], [0.0])
        polar = observation([0.9], [0.95], [10_500])
        static = cloud_gaps.StaticCloudField(
            appearance=np.asarray([[[0.55, 0.35]]], dtype=np.float32),
            density=np.asarray([[[0.35, 0.4, 0.0]]], dtype=np.float32),
        )
        advanced = cloud_gaps.ObservedCloudField(
            polar.appearance, polar.density, polar.quality, polar.age_seconds + 600,
        )

        result = cloud_gaps.fuse_cloud_gaps(
            primary=primary,
            polar=advanced,
            model=None,
            static=static,
            thresholds=cloud_gaps.GapThresholds(10_800, .72, 0),
        )

        self.assertEqual(result["source_class"][0, 0], cloud_gaps.SOURCE_STATIC)

    def test_visual_feathering_wraps_across_the_equirectangular_longitude_seam(self):
        primary = observation(
            [0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [0.95, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [300, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        )
        model = cloud_gaps.ModelCloudField(
            total_cloud=np.zeros((1, 8), dtype=np.float32),
            run_at="2026-08-25T12:00:00Z",
            forecast_hour=4,
        )
        static = cloud_gaps.StaticCloudField(
            appearance=np.zeros((1, 8, 2), dtype=np.float32),
            density=np.zeros((1, 8, 3), dtype=np.float32),
        )

        result = cloud_gaps.fuse_cloud_gaps(
            primary=primary,
            polar=None,
            model=model,
            static=static,
            thresholds=cloud_gaps.GapThresholds(10_800, .72, 2),
        )

        self.assertGreater(result["appearance"][0, -1, 1], 0.0)
        self.assertEqual(result["source_class"][0, -1], cloud_gaps.SOURCE_MODEL)

    def test_file_composition_emits_gpu_textures_and_exhaustive_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            primary_cloud = root / "primary-cloud.png"
            primary_density = root / "primary-density.png"
            static_cloud = root / "static-cloud.png"
            static_density = root / "static-density.png"
            polar = root / "polar.npz"
            model = root / "gfs.npy"
            outputs = {
                "cloud": root / "completed-cloud.png",
                "density": root / "completed-density.png",
                "provenance": root / "completed-provenance.png",
                "metadata": root / "metadata.json",
            }
            Image.fromarray(np.asarray([[[180, 210], [0, 0], [0, 0], [0, 0]]], dtype=np.uint8), mode="LA").save(primary_cloud)
            Image.fromarray(np.asarray([[[210, 240, 20], [0, 0, 0], [0, 0, 0], [0, 0, 0]]], dtype=np.uint8), mode="RGB").save(primary_density)
            Image.fromarray(np.asarray([[[130, 100]] * 4], dtype=np.uint8), mode="LA").save(static_cloud)
            Image.fromarray(np.asarray([[[100, 100, 0]] * 4], dtype=np.uint8), mode="RGB").save(static_density)
            np.savez(
                polar,
                appearance=np.asarray([[[0, 0], [.7, .8], [0, 0], [0, 0]]], dtype=np.float32),
                density=np.asarray([[[0, 0, 0], [.8, .95, .1], [0, 0, 0], [0, 0, 0]]], dtype=np.float32),
                quality=np.asarray([[0, .95, 0, 0]], dtype=np.float32),
                age_seconds=np.asarray([[0, 300, 0, 0]], dtype=np.float32),
            )
            np.save(model, np.asarray([[.9, .9, .65, np.nan]], dtype=np.float32))

            metadata = cloud_gaps.compose(
                primary_cloud_path=primary_cloud,
                primary_density_path=primary_density,
                primary_age_seconds=600,
                polar_path=polar,
                model_path=model,
                static_cloud_path=static_cloud,
                static_density_path=static_density,
                cloud_path=outputs["cloud"],
                density_path=outputs["density"],
                provenance_path=outputs["provenance"],
                metadata_path=outputs["metadata"],
                thresholds=cloud_gaps.GapThresholds(10_800, .72, 0),
                model_run_at="2026-08-25T12:00:00Z",
                model_forecast_hour=4,
            )

            with Image.open(outputs["cloud"]) as image:
                self.assertEqual(image.size, (4, 1))
            with Image.open(outputs["provenance"]) as image:
                self.assertEqual(image.mode, "RGBA")
            self.assertAlmostEqual(sum(metadata["coverage"][key] for key in (
                "observedFraction", "modelAssistedFraction", "fallbackFraction",
            )), 1.0)
            self.assertEqual(metadata["coverage"]["latitudeRange"], [-90, 90])
            self.assertEqual(metadata["model"]["forecastHour"], 4)
            self.assertEqual(metadata["thresholds"]["minObservationQuality"], .72)


if __name__ == "__main__":
    unittest.main()
