#!/usr/bin/env python3
"""Publish a rolling observed-flash window. stdout contains only safe status."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
import hashlib
import io
import json
import os
from pathlib import Path
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from lightning_data import read_glm, read_li, timestamp, li_body_window


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(200_000_001)
    if len(data) > 200_000_000:
        raise ValueError('Provider file exceeds size limit')
    return data


def cached(cache, key, download, decode):
    path = cache / (hashlib.sha256(('decoder-v2:'+key).encode()).hexdigest() + '.json')
    if path.exists():
        return json.loads(path.read_text())
    result = decode(io.BytesIO(download()))
    path.write_text(json.dumps(result, separators=(',', ':')))
    return result


def noaa(satellite, now, cache):
    source = f'goes{satellite}'
    base = f'https://noaa-goes{satellite}.s3.amazonaws.com/'
    cutoff = (now-timedelta(minutes=30)).timestamp()*1000
    keys = []
    for hour in sorted({now.replace(minute=0, second=0, microsecond=0), (now-timedelta(minutes=30)).replace(minute=0,second=0,microsecond=0)}):
        prefix = hour.strftime('GLM-L2-LCFA/%Y/%j/%H/')
        root = ET.fromstring(fetch(base+'?list-type=2&prefix='+prefix))
        for node in root.findall('{*}Contents'):
            key = node.findtext('{*}Key')
            encoded = key.split('_s')[1].split('_')[0]
            start = datetime.strptime(encoded[:13], '%Y%j%H%M%S').replace(tzinfo=timezone.utc).timestamp()*1000
            if cutoff-20000 <= start <= now.timestamp()*1000:
                keys.append(key)
    if not keys:
        raise ValueError('No recent GLM files')
    # A partially failed source is not advertised as continuous coverage.
    with ThreadPoolExecutor(max_workers=6) as pool:
        frames = list(pool.map(lambda key: cached(cache, source+key, lambda: fetch(base+key), lambda data: read_glm(data, source)), keys))
    return package(source, frames, 600_000, 'NOAA GOES GLM; public data', 'Radiant energy at the detector (J)')


def package(source, frames, delay, attribution, optical):
    intervals = sorted([[round(f['start']), round(f['end'])] for f in frames])
    unique = {e[0]: e for f in frames for e in f['events']}
    events = sorted(unique.values(), key=lambda e: e[1])
    return {'id': source, 'status': 'available', 'delayMs': delay, 'intervals': intervals, 'events': events, 'attribution': attribution, 'opticalMeasure': optical}


def eumetsat(now, cache):
    key, secret = os.environ.get('EUMETSAT_CONSUMER_KEY'), os.environ.get('EUMETSAT_CONSUMER_SECRET')
    if not key or not secret:
        return {'id': 'mtg', 'status': 'unconfigured', 'delayMs': 1200000, 'intervals': [], 'events': []}
    import eumdac
    token = eumdac.AccessToken((key, secret))
    collection = eumdac.DataStore(token).get_collection('EO:EUM:DAT:0691')
    products = list(collection.search(dtstart=now-timedelta(minutes=40), dtend=now))
    if not products:
        raise ValueError('No recent LI products')
    frames = []
    for product in products:
        # Official client handles authenticated entry downloads and token renewal.
        start, end = [timestamp(t) for t in product.metadata['properties']['date'].split('/')]
        for entry in product.entries:
            if 'BODY' not in entry or not entry.endswith('.nc'):
                continue
            def download():
                with product.open(entry=entry) as stream:
                    data = stream.read(200_000_001)
                    if len(data) > 200_000_000:
                        raise ValueError('LI file exceeds size limit')
                    return data
            body_start, body_end = li_body_window(entry, start, end)
            frames.append(cached(cache, str(product)+entry, download, lambda data: read_li(data, str(round(body_start)), body_start, body_end)))
    if not frames:
        raise ValueError('No LI body entries')
    return package('mtg', frames, 1200000, 'Contains modified EUMETSAT Meteosat LI data; CC BY 4.0', 'LI narrow-band radiance; native product units')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='artifacts/lightning/published/latest.json')
    parser.add_argument('--cache', default='artifacts/lightning/cache')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    cache = Path(args.cache);cache.mkdir(parents=True, exist_ok=True)
    sources = []
    for source, loader in [('mtg', lambda: eumetsat(now, cache)), ('goes19', lambda: noaa(19, now, cache)), ('goes18', lambda: noaa(18, now, cache))]:
        try:
            result = loader()
        except Exception as error:
            # Library exceptions can contain authenticated URLs. Never print them.
            print(json.dumps({'source': source, 'status': 'unavailable', 'errorType': type(error).__name__}))
            result = {'id': source, 'status': 'unavailable', 'delayMs': 1200000 if source == 'mtg' else 600000, 'intervals': [], 'events': []}
        sources.append(result)
    document = {'version': 1, 'publishedAt': round(datetime.now(timezone.utc).timestamp()*1000), 'sources': sources}
    output = Path(args.output);output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, separators=(',', ':'), allow_nan=False))
    for s in sources:
        print(json.dumps({'source': s['id'], 'status': s['status'], 'events': len(s['events']), 'latest': max([i[1] for i in s['intervals']], default=None)}))
    for path in cache.glob('*.json'):
        if path.stat().st_mtime < now.timestamp()-7200:
            path.unlink()


if __name__ == '__main__':
    main()
