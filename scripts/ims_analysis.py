"""Native IMS 4 km classes with the projection carried by the numerical product."""
import gzip
from datetime import datetime, timezone
import numpy as np
from netCDF4 import Dataset, num2date
from polar_grid import sample_polar_grid


def read_ims_analysis(path, expected_day, width, height):
    with Dataset('ims',memory=gzip.decompress(open(path,'rb').read())) as data:
        values = np.ma.filled(data['IMS_Surface_Values'][0],0).astype(np.uint8)
        if values.shape != (6144,6144) or not np.isin(values,[0,1,2,3,4]).all():
            raise ValueError('Unexpected IMS 4 km categories or dimensions')
        time=data['time']
        reference=num2date(time[0],time.units,only_use_cftime_datetimes=False,only_use_python_datetimes=True)
        day=datetime.fromisoformat(expected_day).replace(tzinfo=timezone.utc)
        age=(day-reference.replace(tzinfo=timezone.utc)).total_seconds()
        # NSIDC declares the filename's day authoritative for this daily nowcast.
        # Delivered 2026 files encode the prior 20Z reference despite a 00Z comment.
        # Accept only the documented 0–6h nowcast window, and retain that raw time.
        if not 0 <= age <= 6*3600:
            raise ValueError('IMS reference time is inconsistent with its analysis day')
        mapping=data[data['IMS_Surface_Values'].grid_mapping]
        attributes={name:mapping.getncattr(name) for name in mapping.ncattrs()}
        x,y=np.asarray(data['x'][:]),np.asarray(data['y'][:])
        if data['x'].units!='m' or data['y'].units!='m' or not np.allclose(np.abs(np.diff(x)),4000) or not np.allclose(np.abs(np.diff(y)),4000):
            raise ValueError('Unexpected IMS 4 km axes')
        return sample_polar_grid(values,attributes,x,y,width,height,0), reference.isoformat()+'Z'
