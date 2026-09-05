"""Decode OSI SAF L3 concentration values, never its rendered browse imagery.

Inverse projection samples every target pixel from the source grid, avoiding the
holes produced by scattering sparse polar samples onto a latitude/longitude map.
Land, lakes, coastal contamination, missing values, and uncertainty >20 percentage
points remain NaN. Zero is reserved for an accepted open-water retrieval.
"""
import numpy as np
from datetime import datetime, timedelta
from netCDF4 import Dataset
from polar_grid import sample_polar_grid


def accepted_concentration(concentration, flags, uncertainty):
    values = np.ma.asarray(concentration).filled(np.nan).astype(np.float32)
    status = np.ma.asarray(flags).filled(256).astype(np.int32)
    error = np.ma.asarray(uncertainty).filled(np.nan).astype(np.float32)
    valid = np.isfinite(values) & (values >= 0) & (values <= 100)
    valid &= (status & (1 | 32 | 64 | 128 | 256 | ~511)) == 0
    valid &= np.isfinite(error) & (error >= 0) & (error <= 20)
    return np.where(valid, values / 100, np.nan), np.where(valid, 1 - error / 100, 0)


def read_concentration(path, expected_day, width, height):
    with Dataset(path) as data:
        start = str(data.start_date)[:10]
        if start != expected_day:
            raise ValueError('OSI SAF observation date does not match the requested day')
        observed_from = datetime.fromisoformat(str(data.start_date))
        observed_to = datetime.fromisoformat(str(data.stop_date))
        if observed_to - observed_from != timedelta(days=1):
            raise ValueError('Unexpected OSI SAF daily observation interval')
        if str(data.product_version) != '4.1':
            raise ValueError('Unreviewed OSI SAF concentration product version')
        variable = data['ice_conc']
        if variable.units != '%' or variable.standard_name != 'sea_ice_area_fraction':
            raise ValueError('Unexpected OSI SAF concentration units or semantics')
        # netCDF4 applies the packed scale_factor; the decoded result is percent.
        values, quality = accepted_concentration(variable[0], data['status_flag'][0], data['total_uncertainty'][0])
        mapping = data[variable.grid_mapping]
        attributes = {name: mapping.getncattr(name) for name in mapping.ncattrs()}
        if data['xc'].units != 'km' or data['yc'].units != 'km':
            raise ValueError('Unexpected OSI SAF projected coordinate units')
        x, y = np.asarray(data['xc'][:])*1000, np.asarray(data['yc'][:])*1000
        result = sample_polar_grid(values, attributes, x, y, width, height, np.nan)
        confidence = sample_polar_grid(quality, attributes, x, y, width, height, 0)
        return result, confidence, {'observedFrom': observed_from.isoformat()+'Z', 'observedTo': observed_to.isoformat()+'Z'}
