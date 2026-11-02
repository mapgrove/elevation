"""Check generated tile integrity, every shared edge, and native center samples."""
import argparse
from collections import OrderedDict
import gzip
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
import rasterio

from tile_pipeline import cell_id, source_name, write_json


def validate(folder, source_cache):
    folder, source_cache = Path(folder), Path(source_cache)
    manifest_bytes = (folder/'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get('grid') != 'geographic-0.1-v1' or manifest.get('sampleSpacingArcSeconds') != 3:
        raise ValueError('Validation requires grid-v1 3-arcsecond output')
    sources, tiles = OrderedDict(), OrderedDict()
    def tile(id):
        if id in tiles:
            tiles.move_to_end(id)
            return tiles[id]
        row, col = cell_id(id)
        data = (folder/f'{row}-{col}.oel.gz').read_bytes()
        asset = manifest['tiles'][id]
        if len(data) != asset['bytes'] or hashlib.sha256(data).hexdigest() != asset['sha256']:
            raise ValueError(f'Integrity mismatch: {id}')
        raw = gzip.decompress(data)
        if len(raw) != 58584 or struct.unpack('<4sIIII',raw[:20]) != (b'OEL1',121,121,row,col):
            raise ValueError(f'Invalid header: {id}')
        a = np.frombuffer(raw, dtype='<f4', offset=20).reshape(121,121)
        if np.isinf(a).any(): raise ValueError(f'Infinite height: {id}')
        tiles[id] = a
        if len(tiles)>24: tiles.popitem(last=False)
        return a
    compared, missing_centers, edges, missing_nodes, partial = 0,0,0,0,0
    max_error = 0.0
    for id in sorted(manifest['tiles']):
        a=tile(id)
        row,col=cell_id(id)
        nan=int(np.isnan(a).sum())
        missing_nodes+=nan
        partial+=int(nan>0)
        # One exact native center per tile. All permitted native widths place .05° on a source node.
        lat=(row*120+60)/1200-90
        lon=(col*120+60)/1200-180
        name=source_name(int(np.floor(lat)),int(np.floor(lon)))
        path=source_cache/(name+'.tif')
        if path.exists():
            if name not in sources:
                with rasterio.open(path) as src:
                    sources[name]=(src.read(1,masked=True).filled(np.nan),src.transform)
                if len(sources)>4: sources.popitem(last=False)
            else: sources.move_to_end(name)
            values,transform=sources[name]
            # Rasterio's inverse transform locates the original sample independently.
            px,py=(~transform)*(lon,lat)
            expected=float(values[int(np.floor(py)),int(np.floor(px))])
        else: expected=float('nan')
        actual=float(a[60,60])
        if np.isnan(expected):
            if not np.isnan(actual): raise ValueError(f'Unexpected center coverage: {id}')
            missing_centers+=1
        else:
            error=abs(actual-expected)
            if not np.isfinite(actual) or error>0.001: raise ValueError(f'Source center differs: {id}: {actual} vs {expected}')
            max_error=max(max_error,error)
            compared+=1
        for neighbor,first,second in [(f'{row}/{(col+1)%3600}',a[:,-1],lambda b:b[:,0]),(f'{row+1}/{col}',a[-1,:],lambda b:b[0,:])]:
            if neighbor in manifest['tiles']:
                if not np.array_equal(first,second(tile(neighbor)),equal_nan=True): raise ValueError(f'Shared edge differs: {id} -> {neighbor}')
                edges+=1
    coverage=json.loads((folder/'coverage.json').read_text())
    built=set(manifest['tiles']); requested=set(coverage['requested']); unavailable=set(coverage['unavailable'])
    if built != set(coverage['built']) or built & unavailable or built | unavailable != requested:
        raise ValueError('Coverage partition mismatch')
    return {'manifestSha256':hashlib.sha256(manifest_bytes).hexdigest(),'requestedCells':len(requested),'builtCells':len(built),'unavailableCells':len(unavailable),'partialCells':partial,'missingNodesIncludingDuplicatedEdges':missing_nodes,'checkedSharedEdges':edges,'comparedNativeCenters':compared,'missingNativeCenters':missing_centers,'maximumCenterDifferenceMeters':max_error,'passed':True,'meaning':'Source consistency and output integrity; not an independent ground-truth accuracy test.'}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True)
    parser.add_argument('--source-cache',default='.cache/global')
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    report=validate(args.input,args.source_cache)
    write_json(args.output,report)
    print(json.dumps(report,indent=2))
