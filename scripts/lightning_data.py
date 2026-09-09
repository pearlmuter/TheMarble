"""Decode satellite flash observations; no synthetic events or source-time changes."""
from datetime import datetime, timezone
import re
import h5py
import numpy as np


def text(value):
    return value.decode() if isinstance(value, bytes) else str(value)


def timestamp(value):
    return datetime.fromisoformat(text(value).replace('Z', '+00:00')).replace(tzinfo=timezone.utc).timestamp() * 1000


def decoded(variable):
    """CF packed values: mask before unsigned reinterpretation and scaling."""
    raw = np.asarray(variable[()])
    invalid = ~np.isfinite(raw)
    if '_FillValue' in variable.attrs:
        invalid |= raw == np.asarray(variable.attrs['_FillValue']).flat[0]
    if text(variable.attrs.get('_Unsigned', '')).lower() == 'true' and raw.dtype.kind == 'i':
        raw = raw.view(np.dtype(f'u{raw.dtype.itemsize}'))
    values = raw.astype(float)
    values = values * np.asarray(variable.attrs.get('scale_factor', 1)).flat[0] + np.asarray(variable.attrs.get('add_offset', 0)).flat[0]
    return np.where(invalid, np.nan, values)


def times(variable):
    units = text(variable.attrs.get('units', ''))
    match = re.fullmatch(r'(seconds|milliseconds|microseconds) since (.+)', units)
    if not match:
        raise ValueError(f'Unsupported time units: {units}')
    return timestamp(match[2]) + decoded(variable) * {'seconds': 1000, 'milliseconds': 1, 'microseconds': .001}[match[1]]


def in_sector(source, lat, lon):
    if source == 'goes18':
        return abs(lat) <= 55 and (lon < -105 or lon >= 150)
    if source == 'goes19':
        return abs(lat) <= 55 and -105 <= lon < -30
    return -60 <= lat <= 70 and -30 <= lon <= 80


def rows(source, product, ids, t, lat, lon, duration, area, energy, good):
    result = []
    for i in range(len(t)):
        values = [t[i], lat[i], lon[i], duration[i], area[i], energy[i]]
        if not good[i] or not np.isfinite(values).all():
            continue
        if not in_sector(source, lat[i], lon[i]) or not 0 <= duration[i] <= 30000 or area[i] <= 0 or energy[i] < 0:
            continue
        result.append([f'{product}:{int(ids[i])}', round(t[i]), round(lat[i], 5), round(lon[i], 5), round(duration[i]), round(area[i], 2), float(f'{energy[i]:.5g}')])
    return result


def read_glm(path, source):
    with h5py.File(path) as d:
        first, last = times(d['flash_time_offset_of_first_event']), times(d['flash_time_offset_of_last_event'])
        start, end = timestamp(d.attrs['time_coverage_start']), timestamp(d.attrs['time_coverage_end'])
        good = (decoded(d['flash_quality_flag']) == 0) & (first >= start - 5000) & (last <= end + 1000)
        if text(d['flash_area'].attrs['units']) != 'm2' or text(d['flash_energy'].attrs['units']) != 'J':
            raise ValueError('Unexpected GLM optical units')
        events = rows(source, str(round(start)), decoded(d['flash_id']), first, decoded(d['flash_lat']), decoded(d['flash_lon']), last-first, decoded(d['flash_area'])/1e6, decoded(d['flash_energy']), good)
        return {'start': start, 'end': end, 'events': events}


def read_li(path, product, start, end):
    with h5py.File(path) as f:
        d = f['data']
        t = times(d['flash_time'])
        duration = decoded(d['flash_duration'])
        if text(d['flash_duration'].attrs['units']) not in ('milliseconds', 'ms'):
            raise ValueError('Unexpected LI duration units')
        good = (t >= start-30000) & (t <= end)
        # A warning is not an absence of lightning; exclude suspect observations.
        for flag in ('l1b_geolocation_warning', 'l1b_radiometric_warning'):
            v = d[flag] if flag in d else f['state/processor'][flag]
            good &= np.broadcast_to(decoded(v), t.shape) == 0
        # LI footprint is a pixel count, not km². Use a representative 4.5 km
        # pixel solely for the illustrative glow size, not scientific area.
        area = decoded(d['flash_footprint']) * 4.5**2
        return {'start': start, 'end': end, 'events': rows('mtg', product, decoded(d['flash_id']), t, decoded(d['latitude']), decoded(d['longitude']), duration, area, decoded(d['radiance']), good)}
