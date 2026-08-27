import json
import pathlib
import unittest

import numpy as np
from PIL import Image


ROOT = pathlib.Path(__file__).parents[1]
PUBLIC = ROOT / "public"


class BundledCloudCoverage(unittest.TestCase):
    def test_static_fallback_confidence_does_not_remove_a_longitudinal_hemisphere(self):
        manifest = json.loads((PUBLIC / "earth-state" / "bundled-v1.json").read_text())
        descriptor = manifest["layers"]["cloudDensity"]
        texture_path = PUBLIC / descriptor["asset"]["href"].lstrip("/")
        confidence = np.asarray(Image.open(texture_path).convert("RGBA"), dtype=np.uint8)[..., 1]
        midpoint = confidence.shape[1] // 2
        hemisphere_means = [
            float(confidence[:, :midpoint].mean()),
            float(confidence[:, midpoint:].mean()),
        ]

        self.assertGreaterEqual(
            min(hemisphere_means),
            127,
            f"bundled cloud confidence suppresses a hemisphere: {hemisphere_means}",
        )


if __name__ == "__main__":
    unittest.main()
