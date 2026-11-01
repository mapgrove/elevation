"""Refresh the public GLO-90 source index without downloading terrain rasters."""
import argparse
import gzip
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen
URL='https://copernicus-dem-90m.s3.amazonaws.com/tileList.txt'
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',help='Use a previously downloaded upstream tileList.txt')
    args=parser.parse_args()
    if args.input: raw=Path(args.input).read_bytes()
    else:
        with urlopen(URL,timeout=60) as response: raw=response.read()
    names=sorted(set(raw.decode().split()))
    pattern=re.compile(r'^Copernicus_DSM_COG_30_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM$')
    if not names or not all(pattern.fullmatch(n) for n in names): raise ValueError('Unexpected upstream catalog format')
    sample_bytes=0
    for name in names:
        m=pattern.fullmatch(name)
        south=int(m[2])*(-1 if m[1]=='S' else 1)
        latitude=abs(south+.5)
        width=1200 if latitude<50 else 800 if latitude<60 else 600 if latitude<70 else 400 if latitude<80 else 240 if latitude<85 else 120
        sample_bytes+=1200*width*4
    out=Path('data/global');out.mkdir(parents=True,exist_ok=True)
    out.joinpath('catalog.json.gz').write_bytes(gzip.compress(json.dumps(names,separators=(',',':')).encode(),mtime=0))
    out.joinpath('catalog-info.json').write_text(json.dumps({
        'dataset':'Copernicus DEM GLO-90 AWS 2021 release','source':URL,
        'accessed':datetime.now(timezone.utc).date().isoformat(),
        'sourceSha256':hashlib.sha256(raw).hexdigest(),'sourceTileCount':len(names),
        'catalogEncoding':'gzip JSON string array','totalSourceBytes':None,
        'derivedSamplePayloadBytes':sample_bytes,
        'derivedSamplePayloadMethod':'Sum 1200 rows × latitude-band width × 4-byte Float32 for catalog tiles using the AWS README dimension table; excludes compression, COG overviews, headers and auxiliary files. This is a planning calculation, not measured transfer/storage bytes.',
        'potentialSubtileCountAtPointOneDegrees':len(names)*100,
        'potentialSubtileCountAtPointZeroFiveDegrees':len(names)*400,
        'note':'Object sizes are not included in the published tile list. No exact global byte total has been measured.'
    },indent=2)+'\n')
    print('Indexed',len(names),'source tiles; derived uncompressed sample payload:',sample_bytes,'bytes')
if __name__=='__main__': main()
