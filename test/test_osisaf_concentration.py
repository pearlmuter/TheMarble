import importlib.util
import pathlib
import unittest
import numpy as np
import sys
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/"scripts"))

spec = importlib.util.spec_from_file_location('osisaf',pathlib.Path(__file__).parents[1]/'scripts/osisaf_concentration.py')
osi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(osi)

class ConcentrationFlags(unittest.TestCase):
    def test_decoded_percent_is_scaled_once_and_zero_remains_valid(self):
        values, confidence = osi.accepted_concentration(np.array([0.,35.,100.]),np.array([2,0,0]),np.array([0.,5.,10.]))
        np.testing.assert_allclose(values,[0,.35,1])
        np.testing.assert_allclose(confidence,[1,.95,.9])

    def test_land_lake_coast_missing_unknown_flags_and_uncertain_are_not_open_water(self):
        values, confidence = osi.accepted_concentration(np.full(8,50.),np.array([32,64,128,256,512,1,0,0]),np.array([0,0,0,0,0,0,21,np.nan]))
        self.assertTrue(np.isnan(values).all())
        self.assertTrue((confidence==0).all())

    def test_screened_open_water_and_nominal_ice_are_accepted(self):
        values, _ = osi.accepted_concentration(np.array([0.,0.,0.,0.,80.]),np.array([2,4,8,16,0]),np.zeros(5))
        np.testing.assert_allclose(values,[0,0,0,0,.8])
