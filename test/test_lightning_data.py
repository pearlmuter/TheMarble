import io
import sys
import unittest
from pathlib import Path
import h5py
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from lightning_data import decoded, times, read_glm, in_sector, li_body_window

class LightningDataTests(unittest.TestCase):
    def test_unsigned_packing_masks_fill_before_scale(self):
        with h5py.File(io.BytesIO(), 'w') as d:
            v=d.create_dataset('v',data=np.array([0,-32768,-1],dtype='i2'))
            v.attrs['_Unsigned']='true';v.attrs['_FillValue']=-1;v.attrs['scale_factor']=.5;v.attrs['add_offset']=-5
            a=decoded(v);self.assertEqual(a[0],-5);self.assertEqual(a[1],16379);self.assertTrue(np.isnan(a[2]))
    def test_big_endian_unsigned_packing(self):
        with h5py.File(io.BytesIO(), 'w') as d:
            v=d.create_dataset('v',data=np.array([1,258,-32768,-1],dtype='>i2'))
            v.attrs['_Unsigned']='true';v.attrs['_FillValue']=-1
            a=decoded(v);self.assertEqual(a[:3].tolist(),[1,258,32768]);self.assertTrue(np.isnan(a[3]))
    def test_li_body_windows_do_not_fill_missing_parts_of_an_archive(self):
        from lightning_data import timestamp
        start=timestamp('2026-09-09T09:00:00Z');end=start+600000
        first=li_body_window('X_BODY_OPE_20260909090000_20260909090010_N.nc',start,end)
        third=li_body_window('X_BODY_OPE_20260909090020_20260909090030_N.nc',start,end)
        self.assertEqual(first,(start,start+10000));self.assertEqual(third,(start+20000,start+30000))
        self.assertFalse(any(a <= start+15000 < b for a,b in [first,third]))
        self.assertRaises(ValueError,li_body_window,'BODY_unknown.nc',start,end)
    def test_source_time_units_not_file_arrival(self):
        with h5py.File(io.BytesIO(), 'w') as d:
            v=d.create_dataset('t',data=[.25]);v.attrs['units']='seconds since 1970-01-01 00:00:00.000'
            self.assertEqual(times(v)[0],250)
            v.attrs['units']='hours';self.assertRaises(ValueError,times,v)
    def test_glm_quality_area_energy_and_duration(self):
        b=io.BytesIO()
        with h5py.File(b,'w') as d:
            d.attrs['time_coverage_start']='2026-09-09T09:20:00Z';d.attrs['time_coverage_end']='2026-09-09T09:20:20Z'
            for name,data in {'flash_id':[1,2,3], 'flash_lat':[10,10,10],'flash_lon':[-80,-80,-120],'flash_quality_flag':[0,1,0], 'flash_area':[100e6]*3,'flash_energy':[1e-13]*3,'flash_time_offset_of_first_event':[1]*3,'flash_time_offset_of_last_event':[1.5]*3}.items():
                v=d.create_dataset(name,data=data)
                if 'time_offset' in name:v.attrs['units']='seconds since 2026-09-09 09:20:00.000'
            d['flash_area'].attrs['units']='m2';d['flash_energy'].attrs['units']='J'
        b.seek(0);r=read_glm(b,'goes19');self.assertEqual(len(r['events']),1);self.assertEqual(r['events'][0][4],500);self.assertEqual(r['events'][0][5],100);self.assertEqual(r['events'][0][1],r['start']+1000)
    def test_satellite_overlap_has_one_owner(self):
        for lon in range(-180,181):
            self.assertLessEqual(sum(in_sector(s,30,lon) for s in ['goes18','goes19','mtg']),1)
        self.assertTrue(in_sector('goes18',10,175));self.assertFalse(in_sector('goes19',75,-80))

if __name__=='__main__':unittest.main()
