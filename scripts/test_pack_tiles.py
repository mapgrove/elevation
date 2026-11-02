import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from pack_tiles import pack


class PackTests(unittest.TestCase):
    def test_pack_ranges_reproduce_original_payload_and_reject_corruption(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder)/'source', Path(folder)/'output'
            source.mkdir()
            tiles = {}
            originals = {}
            for id in ['1275/3070', '1275/3071', '1280/3070']:
                data = gzip.compress(id.encode(), mtime=0)
                originals[id] = data
                (source/(id.replace('/', '-')+'.oel.gz')).write_bytes(data)
                tiles[id] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'url': 'https://example.org/tile'}
            manifest = {'schemaVersion': 1, 'grid': 'geographic-0.1-v1', 'version': 'test-v1', 'attribution': 'Synthetic', 'tiles': tiles}
            (source/'manifest.json').write_text(json.dumps(manifest))
            report = pack(source, output, 'https://example.org/data')
            self.assertEqual(report['packs'], 2)
            packed = json.loads((output/'manifest.json').read_text())
            for id, a in packed['tiles'].items():
                data = (output/a['url'].rsplit('/',1)[-1]).read_bytes()
                start = a['range']['offset']
                self.assertEqual(len(data), a['range']['totalBytes'])
                self.assertEqual(data[start:start+a['bytes']], originals[id])
            before = (output/'manifest.json').read_bytes()
            pack(source, output, 'https://example.org/data')
            self.assertEqual(before, (output/'manifest.json').read_bytes())
            (source/'1275-3070.oel.gz').write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                pack(source, output, 'https://example.org/data')
            self.assertEqual(before, (output/'manifest.json').read_bytes())
            with self.assertRaises(ValueError):
                pack(source, source, 'https://example.org/data')


if __name__ == '__main__':
    unittest.main()
