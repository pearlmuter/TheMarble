"""Validate the frozen production/reprocessed textures and independent source coordinates."""
import json
from pathlib import Path
import numpy as np
from PIL import Image
from netCDF4 import Dataset
from pyproj import CRS, Transformer

root = Path('artifacts/polar-cloud-review')
feed = root/'feed'

def layer(pointer):
    path = feed/pointer['manifest']['href']
    manifest = json.loads(path.read_text())
    image = np.asarray(Image.open(path.parent/manifest['layers']['seaIce']['asset']['href']))
    return image, manifest

before, _ = layer(json.loads((root/'before-latest.json').read_text()))
after, manifest = layer(json.loads((feed/'latest.json').read_text()))
report = {'beforePolarMissingFraction':float((before[:5,:,1]==0).mean()), 'afterPolarMissingFraction':float((after[:5,:,1]==0).mean())}
assert report['afterPolarMissingFraction'] == 0
# A constant polar classification should no longer alternate with unfilled columns.
report['afterPolarMeanConcentration'] = float(after[:5,:,0].mean()/255)
assert .1 < report['afterPolarMeanConcentration'] <= 1
report['svalbardSamples'] = []
for latitude, longitude in [(78,10),(79,10),(81,18),(82,18),(83,18),(84,18)]:
    row = int((90-latitude)/180*after.shape[0]); col = int((longitude+180)/360*after.shape[1])
    r,g,b = [int(x) for x in after[row,col]]
    report['svalbardSamples'].append({'latitude':latitude,'longitude':longitude,'fraction':r/255,'source':'concentration' if b==255 else 'extent','quality':g/255})
assert report['svalbardSamples'][0]['fraction'] == 0
assert any(0 < p['fraction'] < 1 for p in report['svalbardSamples'])
# Independently supplied per-cell lat/lon must agree with the CF inverse projection
# used in our adapter. This catches axis direction, metre/kilometre and pole mistakes.
with Dataset(root/'osi-nh-20260904.nc') as d:
    mapping=d['Polar_Stereographic_Grid']
    crs=CRS.from_cf({name:mapping.getncattr(name) for name in mapping.ncattrs()})
    transform=Transformer.from_crs(crs,'EPSG:4326',always_xy=True)
    residuals=[]
    for row,col in [(200,300),(400,300),(600,400),(700,450),(800,600)]:
        lon,lat=transform.transform(float(d['xc'][col])*1000,float(d['yc'][row])*1000)
        suppliedLat=float(d['lat'][row,col]);suppliedLon=float(d['lon'][row,col])
        residuals.append(max(abs(lat-suppliedLat),abs((lon-suppliedLon+180)%360-180)))
    report['sourceCoordinateMaxErrorDegrees']=max(residuals)
    assert max(residuals)<.0001
# IMS companion grids are north-up; the NetCDF y axis runs south-to-north.
# Check that convention explicitly rather than assuming the arrays share order.
import gzip
latitudes=np.frombuffer(gzip.decompress((root/'imslat4.bin.gz').read_bytes()),dtype='<f4').reshape(6144,6144)[::-1]
longitudes=np.frombuffer(gzip.decompress((root/'imslon4.bin.gz').read_bytes()),dtype='<f4').reshape(6144,6144)[::-1]
with Dataset('ims',memory=gzip.decompress((root/'ims4.nc.gz').read_bytes())) as d:
    mapping=d['projection']; transform=Transformer.from_crs(CRS.from_cf({a:mapping.getncattr(a) for a in mapping.ncattrs()}),'EPSG:4326',always_xy=True)
    errors=[]
    for row,col in [(3072,3072),(3400,3200),(3200,3400),(2800,3000),(4200,3000)]:
        lon,lat=transform.transform(float(d['x'][col]),float(d['y'][row]))
        errors.append(max(abs(lat-float(latitudes[row,col])),abs((lon-float(longitudes[row,col])+180)%360-180)))
    report['imsSourceCoordinateMaxErrorDegrees']=max(errors)
    assert max(errors)<.0001
ims=np.load(root/'cryosphere/ims-snow-ice@2026-09-04.npy')
for lat,lon,expected in [(72,-42,4),(23,10,2),(61,8,2),(30,-40,1),(50,-100,2)]:
    assert ims[int((90-lat)/180*ims.shape[0]),int((lon+180)/360*ims.shape[1])]==expected
report['provenance']=manifest['layers']['seaIce']['provenance']
(root/'data-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
