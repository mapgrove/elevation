import gzip
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import rasterio
from rasterio.transform import from_origin

from tile_pipeline import Sources, source_name, build, digest, bounds_cells
from validate_build import validate


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cache = self.root/'sources'
        self.cache.mkdir()
        self.catalog = []

    def tearDown(self):
        self.temp.cleanup()

    def source(self, south, west, width=1200):
        name = source_name(south, west)
        path = self.cache/(name+'.tif')
        ys = south+1-np.arange(1200)[:, None]/1200
        xs = west+np.arange(width)[None, :]/width
        data = (ys*2+np.cos(xs*np.pi/180)*3).astype('float32')
        with rasterio.open(path, 'w', driver='GTiff', width=width, height=1200, count=1, dtype='float32', crs='EPSG:4326', transform=from_origin(west-.5/width, south+1+.5/1200, 1/width, 1/1200), nodata=float('nan'), compress='deflate') as dest:
            dest.write(data, 1)
            dest.update_tags(AREA_OR_POINT='Point')
        raw = path.read_bytes()
        path.with_suffix('.json').write_text(json.dumps({'sha256':digest(raw),'bytes':len(raw),'url':'synthetic://'+name}))
        self.catalog.append(name)

    @staticmethod
    def values(path):
        raw = gzip.decompress(path.read_bytes())
        return np.frombuffer(raw, dtype='<f4', offset=20).reshape(121,121)

    def test_source_and_latitude_band_seams_resume_and_repair(self):
        for south,width in [(49,1200),(50,800)]:
            for west in [127,128]: self.source(south,west,width)
        ids=['1399/3079','1400/3079','1400/3080']
        out=self.root/'build'
        report=build(ids,Sources(self.catalog,self.cache,True),out,'test-v1','https://example.com/tiles')
        self.assertEqual(report['builtCells'],3)
        checked=validate(out,self.cache)
        self.assertEqual(checked['comparedNativeCenters'],3)
        self.assertEqual(checked['checkedSharedEdges'],2)
        self.assertEqual(checked['maximumCenterDifferenceMeters'],0)
        lower=self.values(out/'1399-3079.oel.gz')
        upper=self.values(out/'1400-3079.oel.gz')
        east=self.values(out/'1400-3080.oel.gz')
        np.testing.assert_array_equal(lower[-1],upper[0])
        np.testing.assert_array_equal(upper[:,-1],east[:,0])
        self.assertTrue(np.isfinite(upper).all())
        self.assertAlmostEqual(float(upper[60,60]),50.05*2+np.cos(127.95*np.pi/180)*3,places=4)
        resumed=build(ids,Sources(self.catalog,self.root/'absent',True),out,'test-v1','https://example.com/tiles')
        self.assertEqual(resumed['resumedCells'],3)
        expected=(out/'1400-3079.oel.gz').read_bytes()
        (out/'1400-3079.oel.gz').write_bytes(b'corrupt')
        repaired=build(ids,Sources(self.catalog,self.cache,True),out,'test-v1','https://example.com/tiles')
        self.assertEqual(repaired['resumedCells'],2)
        self.assertEqual((out/'1400-3079.oel.gz').read_bytes(),expected)
        # A new self-consistent cache hash cannot silently change an existing build's source.
        name=source_name(50,127)
        metadata=self.cache/(name+'.json')
        original_metadata=metadata.read_text()
        changed=json.loads(original_metadata)
        changed['sha256']='0'*64
        metadata.write_text(json.dumps(changed))
        (out/'1400-3079.oel.gz').unlink()
        with self.assertRaisesRegex(ValueError,'Source changed'):
            build(ids,Sources(self.catalog,self.cache,True),out,'test-v1','https://example.com/tiles')
        metadata.write_text(original_metadata)
        build(ids,Sources(self.catalog,self.cache,True),out,'test-v1','https://example.com/tiles')
        with self.assertRaisesRegex(ValueError,'immutable'):
            build(ids,Sources(self.catalog,self.cache,True),out,'changed','https://example.com/tiles')

    def test_dateline_and_missing_coverage(self):
        self.source(0,179)
        self.source(0,-180)
        s=Sources(self.catalog,self.cache,True)
        a,_=s.tile('905/3599')
        b,_=s.tile('905/0')
        np.testing.assert_array_equal(np.frombuffer(gzip.decompress(a),dtype='<f4',offset=20).reshape(121,121)[:,-1],np.frombuffer(gzip.decompress(b),dtype='<f4',offset=20).reshape(121,121)[:,0])
        report=build(['1275/3070'],s,self.root/'missing','test','https://example.com')
        self.assertEqual(report['unavailableCells'],1)
        self.assertEqual(json.loads((self.root/'missing/manifest.json').read_text())['tiles'],{})
        self.assertFalse(report['published'])

    def test_bounds_and_corrupt_source(self):
        self.assertEqual(len(list(bounds_cells([124.5,33,132,39]))),4500)
        self.assertEqual(set(bounds_cells([179.9,0,-179.9,.1])),{'900/3599','900/0'})
        with self.assertRaises(ValueError): list(bounds_cells([0,1,0,2]))
        self.source(37,127)
        (self.cache/(source_name(37,127)+'.tif')).write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError,'Corrupt source cache'):
            Sources(self.catalog,self.cache,True).load(37,127)

    def test_validator_detects_source_difference_even_with_updated_payload_hash(self):
        self.source(37,127)
        out=self.root/'validated'
        build(['1275/3070'],Sources(self.catalog,self.cache,True),out,'test','https://example.com')
        path=out/'1275-3070.oel.gz'
        raw=bytearray(gzip.decompress(path.read_bytes()))
        import struct
        offset=20+(60*121+60)*4
        struct.pack_into('<f',raw,offset,struct.unpack_from('<f',raw,offset)[0]+10)
        data=gzip.compress(raw,mtime=0)
        path.write_bytes(data)
        manifest=json.loads((out/'manifest.json').read_text())
        manifest['tiles']['1275/3070'].update(bytes=len(data),sha256=digest(data))
        (out/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'Source center differs'):
            validate(out,self.cache)

    def test_offline_does_not_fetch_missing_sources(self):
        with self.assertRaises(FileNotFoundError):
            Sources([source_name(37,127)],self.cache,True).load(37,127)


if __name__ == '__main__': unittest.main()
