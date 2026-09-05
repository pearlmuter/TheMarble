"""Geographic invariants for both numerical polar providers."""
import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from polar_grid import sample_polar_grid

MAPPING = dict(grid_mapping_name='polar_stereographic',
               latitude_of_projection_origin=90., straight_vertical_longitude_from_pole=0.,
               standard_parallel=70., semi_major_axis=6378137., inverse_flattening=298.257223563)


class PolarGridTest(unittest.TestCase):
    def setUp(self):
        self.axis = np.arange(-4, 5) * 1_000_000.
        self.values = np.full((9, 9), .6, dtype=np.float32)
        self.values[4, 4] = 0

    def sample(self, values=None, x=None, y=None):
        return sample_polar_grid(self.values if values is None else values, MAPPING,
                                 self.axis if x is None else x, self.axis if y is None else y,
                                 360, 180, np.nan)

    def test_pole_has_no_longitude_holes_and_open_water_is_not_missing(self):
        result = self.sample()
        np.testing.assert_array_equal(result[0], 0)
        self.assertTrue(np.isnan(result[90:]).all())
        self.assertTrue(np.any(result[:90] == .6))

    def test_missing_polar_cell_stays_missing(self):
        self.values[4, 4] = np.nan
        self.assertTrue(np.isnan(self.sample()[0]).all())

    def test_reversing_provider_axes_preserves_geography(self):
        self.values[:4] = .2
        self.values[:, :4] = .8
        np.testing.assert_array_equal(self.sample(), self.sample(self.values[::-1, ::-1], self.axis[::-1], self.axis[::-1]))

    def test_invalid_grid_is_rejected(self):
        for axes in (np.zeros(9), self.axis ** 2, self.axis[:1]):
            with self.assertRaises(ValueError):
                self.sample(x=axes)
        with self.assertRaises(ValueError):
            self.sample(values=self.values[:2])


if __name__ == '__main__':
    unittest.main()
