"""Build a small, reproducible Copernicus GLO-90 regional SDK fixture.

Requires rasterio==1.4.4 and numpy==2.2.6. Source TIFFs remain outside Git.
Only source-interior grids are supported: never invent missing boundary samples.
"""
import argparse
import gzip
import hashlib
import json
import math
import struct
from pathlib import Path
import numpy as np
import rasterio

NOTICE = 'produced using Copernicus WorldDEM™-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.'
LICENSE_URL = 'https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf'
SOURCE_URL = 'https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_N37_00_E127_00_DEM/Copernicus_DSM_COG_30_N37_00_E127_00_DEM.tif'

def load(path):
    with rasterio.open(path) as source:
        if source.crs.to_epsg() != 4326 or source.transform.b or source.transform.d:
            raise ValueError('Requires an unrotated EPSG:4326 source')
        return source.read(1, masked=True).filled(np.nan), source.transform

def sample(source, transform, lat, lon):
    # Rasterio transforms locate pixel corners; heights live at pixel centers.
    x = (np.asarray(lon) - transform.c) / transform.a - 0.5
    y = (np.asarray(lat) - transform.f) / transform.e - 0.5
    x, y = np.broadcast_arrays(x, y)
    tolerance = 1e-7
    if x.min() < -tolerance or y.min() < -tolerance or x.max() > source.shape[1]-1+tolerance or y.max() > source.shape[0]-1+tolerance:
        raise ValueError('Requested grid needs neighboring source data; no edge extrapolation permitted')
    x, y = np.clip(x, 0, source.shape[1]-1), np.clip(y, 0, source.shape[0]-1)
    i, j = np.minimum(np.floor(x).astype(int), source.shape[1]-2), np.minimum(np.floor(y).astype(int), source.shape[0]-2)
    dx, dy = x-i, y-j
    result = np.zeros(x.shape)
    for offset_y, offset_x, weight in [(0,0,(1-dx)*(1-dy)),(0,1,dx*(1-dy)),(1,0,(1-dx)*dy),(1,1,dx*dy)]:
        result += np.where(weight > 1e-10, source[j+offset_y,i+offset_x] * weight, 0)
    return result

def tile(source, transform, row, col, n, intervals_per_degree):
    intervals = intervals_per_degree // n
    if intervals_per_degree % n: raise ValueError('Grid must divide the sampling rate')
    south, west = row/n-90, col/n-180
    lat = (row*intervals + np.arange(intervals+1)[:,None])/intervals_per_degree - 90
    lon = (col*intervals + np.arange(intervals+1)[None,:])/intervals_per_degree - 180
    values = sample(source, transform, lat, lon).astype('<f4')
    raw = struct.pack('<4sIIII', b'OEL1', intervals+1, intervals+1, row, col) + values.tobytes()
    return gzip.compress(raw, compresslevel=9, mtime=0), values

def route():
    return [{'latitude':37.55+i/39*.17,'longitude':127.03+i/39*.19} for i in range(40)]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source90', required=True)
    parser.add_argument('--source30')
    parser.add_argument('--output', default='data/seoul-90m')
    parser.add_argument('--base-url', default='https://github.com/mapgrove/elevation/releases/download/data-seoul-90m-v1')
    args = parser.parse_args()
    source, transform = load(args.source90)
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    manifest = {'schemaVersion':1,'grid':'geographic-0.1-v1','sampleSpacingArcSeconds':3,'version':'seoul-90m-v1','tilesPerDegree':10,'encoding':'float32-gzip-v1','attribution':NOTICE,'verticalDatum':'EGM2008 (EPSG:3855)','licenseUrl':LICENSE_URL,'sourceUrl':SOURCE_URL,'sourceSha256':hashlib.sha256(Path(args.source90).read_bytes()).hexdigest(),'coverage':{'south':37.5,'north':37.8,'west':127.0,'east':127.3},'tiles':{}}
    for row in range(1275,1278):
        for col in range(3070,3073):
            blob, values = tile(source,transform,row,col,10,1200)
            name = f'{row}-{col}.oel.gz'; (out/name).write_bytes(blob)
            manifest['tiles'][f'{row}/{col}'] = {'url':f'{args.base_url}/{name}','bytes':len(blob),'sha256':hashlib.sha256(blob).hexdigest()}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    points = route()
    references = [{'point':p,'elevation':float(sample(source,transform,p['latitude'],p['longitude']))} for p in points]
    (out/'references.json').write_text(json.dumps({'description':'Bilinear source raster references, not independent ground-truth measurements.','samples':references},indent=2)+'\n')
    rows=[]
    for resolution,path in [(90,args.source90),(30,args.source30)]:
        if not path: continue
        a,t=load(path)
        for n in [5,10,20]:
            sizes=[]; route_bytes=0; selected={(math.floor(p['latitude']*n+90*n),math.floor(p['longitude']*n+180*n)) for p in points}
            for row in range(round(127.4*n),round(127.8*n)):
                for col in range(307*n,round(307.4*n)):
                    blob,_=tile(a,t,row,col,n,3600 if resolution==30 else 1200)
                    sizes.append(len(blob))
                    if (row,col) in selected: route_bytes+=len(blob)
            rows.append({'nominalResolutionMeters':resolution,'tileDegrees':1/n,'tileCount':len(sizes),'totalBytes':sum(sizes),'minTileBytes':min(sizes),'maxTileBytes':max(sizes),'routeTileCount':len(selected),'routeBytes':route_bytes})
    (out/'benchmark.json').write_text(json.dumps({'region':{'south':37.4,'north':37.8,'west':127,'east':127.4},'route':'40 samples on a synthetic straight line from (37.55,127.03) to (37.72,127.22); not a trail or GPX route.','encoding':'gzip float32 with 20-byte header and duplicated boundary nodes','results':rows},indent=2)+'\n')
    print(json.dumps(rows,indent=2))

if __name__ == '__main__': main()
