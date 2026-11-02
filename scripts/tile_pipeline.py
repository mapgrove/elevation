"""Resumable GLO-90 -> geographic-0.1-v1 builder. No extrapolated source edges."""
import argparse
from collections import OrderedDict
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import ssl
import struct
import uuid
from urllib.request import urlopen
from urllib.parse import urlparse

import certifi
import numpy as np
import rasterio

from build_region import NOTICE, LICENSE_URL

BASE = 'https://copernicus-dem-90m.s3.amazonaws.com'
PRESETS = {'south-korea': [124.5, 33, 132, 39], 'world': [-180, -90, 180, 90]}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_bytes(data)
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def write_json(path, value):
    atomic(path, (json.dumps(value, indent=2, allow_nan=False) + '\n').encode())


def source_name(south, west):
    return f'Copernicus_DSM_COG_30_{"S" if south < 0 else "N"}{abs(south):02d}_00_{"W" if west < 0 else "E"}{abs(west):03d}_00_DEM'


def cell_id(value):
    if not re.fullmatch(r'(0|[1-9]\d*)/(0|[1-9]\d*)', value):
        raise ValueError('Invalid cell ID')
    row, col = map(int, value.split('/'))
    if not (0 <= row < 1800 and 0 <= col < 3600):
        raise ValueError('Cell outside grid')
    return row, col


def bounds_cells(bounds):
    west, south, east, north = bounds
    if not all(math.isfinite(v) for v in bounds) or not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south < north <= 90) or west == east:
        raise ValueError('Invalid nonempty bounding box')
    spans = [(west, east)] if west < east else [(west, 180), (-180, east)]
    for row in range(math.floor(round((south+90)*10, 10)), math.ceil(round((north+90)*10, 10))):
        for start, end in spans:
            for col in range(math.floor(round((start+180)*10, 10)), math.ceil(round((end+180)*10, 10))):
                yield f'{row}/{col}'


class Sources:
    def __init__(self, catalog, cache, offline=False, base_url=BASE):
        self.catalog = set(catalog)
        self.cache = Path(cache)
        self.offline = offline
        self.base_url = base_url.rstrip('/')
        self.memory = OrderedDict()
        self.provenance = {}
        self.download_bytes = 0
        self.missing = set()

    def load(self, south, west):
        name = source_name(south, west)
        if name not in self.catalog:
            self.missing.add(name)
            return None
        if name in self.memory:
            self.memory.move_to_end(name)
            return self.memory[name]
        path = self.cache / (name+'.tif')
        meta = self.cache / (name+'.json')
        if not (path.exists() and meta.exists()):
            if self.offline:
                raise FileNotFoundError(f'Source not cached: {name}')
            url = f'{self.base_url}/{name}/{name}.tif'
            with urlopen(url, timeout=120, context=ssl.create_default_context(cafile=certifi.where())) as response:
                data = response.read(64*1024*1024+1)
            if len(data) > 64*1024*1024:
                raise ValueError('Source exceeds 64 MiB')
            # Parse/validate before publishing bytes.
            with rasterio.MemoryFile(data) as mem:
                with mem.open() as source:
                    self.validate(source, south, west)
            atomic(path, data)
            write_json(meta, {'sha256': digest(data), 'bytes': len(data), 'url': url})
            self.download_bytes += len(data)
        data = path.read_bytes()
        metadata = json.loads(meta.read_text())
        if digest(data) != metadata['sha256'] or len(data) != metadata['bytes']:
            raise ValueError(f'Corrupt source cache: {name}')
        with rasterio.open(path) as source:
            self.validate(source, south, west)
            values = source.read(1, masked=True).filled(np.nan)
            if np.isinf(values).any():
                raise ValueError(f'Infinite source heights: {name}')
            info = (values, source.width)
        self.provenance[name] = metadata
        self.memory[name] = info
        if len(self.memory) > 4:
            self.memory.popitem(last=False)
        return info

    @staticmethod
    def validate(source, south, west):
        if source.crs is None or source.crs.to_epsg() != 4326 or source.height != 1200 or source.width not in [1200, 800, 600, 400, 240, 120]:
            raise ValueError('Unsupported GLO-90 raster dimensions/CRS')
        t = source.transform
        ox, oy = t.c + t.a/2, t.f + t.e/2
        if t.b or t.d or abs(t.a-1/source.width) > 1e-10 or abs(t.e+1/1200) > 1e-10 or abs(ox-west) > 1e-8 or abs(oy-(south+1)) > 1e-8:
            raise ValueError('Unexpected source sample-center transform')

    def row_samples(self, global_y, global_x):
        # Retained source rows own their north edge; the removed south edge is
        # resolved from the southern neighbor. Integer arithmetic avoids clamping.
        south = max(-90, min(89, (int(global_y)-1)//1200-90))
        y = (south+91)*1200-int(global_y)
        result = np.full(len(global_x), np.nan, dtype=np.float64)
        if not 0 <= y < 1200:
            return result  # Missing physical South Pole sample support.
        xs = np.asarray(global_x, dtype=np.int64) % (360*1200)
        wests = xs//1200-180
        for west in np.unique(wests):
            mask = wests == west
            source = self.load(south, int(west))
            if source is None:
                continue
            values, width = source
            local = xs[mask] % 1200
            # Rational interpolation: no rounding drift at native samples.
            numerator = local*width
            left = numerator//1200
            weight = (numerator % 1200)/1200
            a = values[y, left].astype(np.float64)
            b = a.copy()
            need = weight > 0
            inside = need & (left+1 < width)
            b[inside] = values[y, left[inside]+1]
            outside = need & (left+1 >= width)
            if outside.any():
                neighbor = self.load(south, -180 if west == 179 else int(west)+1)
                b[outside] = np.nan if neighbor is None else neighbor[0][y, 0]
            result[mask] = np.where(need, a*(1-weight)+b*weight, a)
        return result

    def tile(self, id):
        row, col = cell_id(id)
        xs = col*120 + np.arange(121)
        values = np.stack([self.row_samples(row*120+y, xs) for y in range(121)]).astype('<f4')
        raw = struct.pack('<4sIIII', b'OEL1', 121, 121, row, col) + values.tobytes()
        return gzip.compress(raw, compresslevel=9, mtime=0), int(np.isfinite(values).sum())


def build(ids, sources, output, version, base_url):
    parsed = urlparse(base_url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError('Base URL must be an absolute HTTP(S) directory URL without query/fragment')
    output = Path(output)
    config = {'version': version, 'cells': ids, 'baseUrl': base_url.rstrip('/'), 'grid': 'geographic-0.1-v1', 'catalogHash': digest('\n'.join(sorted(sources.catalog)).encode())}
    state_path = output/'build-state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'config': config, 'cells': {}, 'sources': {}, 'missingSources': []}
    if state['config'] != config:
        raise ValueError('Output already belongs to a different immutable build configuration; use a new output/version')
    resumed = 0
    for id in ids:
        row, col = cell_id(id)
        path = output/f'{row}-{col}.oel.gz'
        prior = state['cells'].get(id)
        if prior and prior['status'] == 'built' and path.exists() and digest(path.read_bytes()) == prior['sha256']:
            resumed += 1
            continue
        if prior and prior['status'] == 'unavailable':
            resumed += 1
            continue
        blob, valid = sources.tile(id)
        if valid:
            atomic(path, blob)
            state['cells'][id] = {'status': 'built', 'bytes': len(blob), 'sha256': digest(blob), 'validNodes': valid, 'url': f'{base_url.rstrip("/")}/{path.name}'}
        else:
            state['cells'][id] = {'status': 'unavailable', 'reason': 'No valid source support; not assumed ocean'}
        state['sources'].update(sources.provenance)
        state['missingSources'] = sorted(set(state['missingSources']) | sources.missing)
        write_json(state_path, state)  # Checkpoint after every cell, including unavailable ones.
    entries = {id: {k: record[k] for k in ['url', 'bytes', 'sha256']} for id, record in state['cells'].items() if record['status'] == 'built'}
    manifest = {'schemaVersion': 1, 'grid': 'geographic-0.1-v1', 'sampleSpacingArcSeconds': 3, 'tilesPerDegree': 10, 'encoding': 'float32-gzip-v1', 'verticalDatum': 'EGM2008 (EPSG:3855)', 'version': version, 'attribution': NOTICE, 'licenseUrl': LICENSE_URL, 'tiles': entries}
    report = {'grid': manifest['grid'], 'requestedCells': len(ids), 'builtCells': len(entries), 'unavailableCells': len(ids)-len(entries), 'resumedCells': resumed, 'compressedBytes': sum(a['bytes'] for a in entries.values()), 'downloadedSourceBytesThisRun': sources.download_bytes, 'sources': len(state['sources']), 'published': False, 'coverageMeaning': 'Explicit selected grid cells; a preset bounding envelope is not an administrative boundary or proof of nationwide completeness.'}
    write_json(output/'manifest.json', manifest)
    write_json(output/'coverage.json', {'built': sorted(entries), 'unavailable': sorted(set(ids)-set(entries)), 'published': [], 'requested': ids})
    write_json(output/'provenance.json', {'sources': state['sources'], 'missingSources': state['missingSources'], 'method': 'Native GLO-90 rows with horizontal linear interpolation onto global 3-arcsecond nodes; missing support remains NaN.'})
    write_json(output/'report.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--bounds', type=float, nargs=4, metavar=('WEST','SOUTH','EAST','NORTH'))
    group.add_argument('--preset', choices=PRESETS)
    group.add_argument('--cell', action='append', help='Explicit row/column cell, repeatable')
    parser.add_argument('--catalog', default='data/global/catalog.json.gz')
    parser.add_argument('--source-cache', default='.cache/global')
    parser.add_argument('--output', default='.cache/build')
    parser.add_argument('--version', default='local-v1')
    parser.add_argument('--base-url', default='http://127.0.0.1:8080')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    if args.limit is not None and args.limit <= 0:
        parser.error('--limit must be positive')
    if args.cell:
        ids = list(dict.fromkeys(args.cell))
        for id in ids: cell_id(id)
        count = len(ids)
        if args.limit: ids = ids[:args.limit]
    else:
        bounds = PRESETS[args.preset] if args.preset else args.bounds
        # Count lazily even for worldwide requests; do not allocate millions of IDs.
        count = sum(1 for _ in bounds_cells(bounds))
        import itertools
        ids = list(itertools.islice(bounds_cells(bounds), args.limit or min(count, 5001)))
    if args.dry_run:
        print(json.dumps({'requestedCellCount': count, 'selectedCellCount': len(ids), 'selectionTruncated': len(ids)<count, 'rawBytesPerTile': 20+121*121*4, 'rawBytesForRequestedCells': count*(20+121*121*4), 'compressedBytes': None, 'published': False, 'note': 'No terrain downloaded; a world envelope includes unavailable/ocean cells.'}, indent=2))
        return
    if len(ids) > 5000:
        parser.error('Use --limit or smaller batches for more than 5000 cells')
    catalog = json.loads(gzip.decompress(Path(args.catalog).read_bytes()))
    report = build(ids, Sources(catalog, args.source_cache, args.offline), args.output, args.version, args.base_url)
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
