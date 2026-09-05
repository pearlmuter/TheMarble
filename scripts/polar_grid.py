"""Inverse sampling of a provider-declared regular polar stereographic grid."""
import numpy as np
from pyproj import CRS, Transformer


def sample_polar_grid(values, mapping, x, y, width, height, fill):
    if len(x) < 2 or len(y) < 2 or width < 1 or height < 1:
        raise ValueError('Polar grid and target dimensions must be positive')
    crs = CRS.from_cf(mapping)
    transform = Transformer.from_crs('EPSG:4326', crs, always_xy=True)
    dx, dy = float(x[1]-x[0]), float(y[1]-y[0])
    if not np.isfinite([dx, dy]).all() or dx == 0 or dy == 0 or not np.allclose(np.diff(x),dx) or not np.allclose(np.diff(y),dy):
        raise ValueError('Polar grid axes are not regular')
    if values.shape != (len(y),len(x)):
        raise ValueError('Polar grid axes disagree with data dimensions')
    target = np.full((height,width),fill,dtype=values.dtype)
    longitude = -180 + (np.arange(width)+.5)*360/width
    for row in range(height):
        latitude = 90-(row+.5)*180/height
        if latitude * float(mapping['latitude_of_projection_origin']) <= 0:
            continue
        east,north = transform.transform(longitude,np.full(width,latitude))
        col = np.rint((np.asarray(east)-x[0])/dx).astype(np.int64)
        line = np.rint((np.asarray(north)-y[0])/dy).astype(np.int64)
        inside=(col>=0)&(col<len(x))&(line>=0)&(line<len(y))
        target[row,inside]=values[line[inside],col[inside]]
    return target
