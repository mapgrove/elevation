"""Pack a completed build into immutable one-degree objects with per-tile byte ranges."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

from tile_pipeline import atomic, write_json, cell_id


def pack(source, output, base_url):
    source, output = Path(source), Path(output)
    if source.resolve() == output.resolve():
        raise ValueError('Packed output must be separate from input')
    url = urlparse(base_url)
    if url.scheme not in ('http', 'https') or not url.netloc or url.query or url.fragment:
        raise ValueError('Expected absolute HTTP(S) base URL')
    manifest = json.loads((source/'manifest.json').read_text())
    if manifest.get('grid') != 'geographic-0.1-v1' or manifest.get('schemaVersion') != 1:
        raise ValueError('Packing requires grid v1')
    groups = {}
    for id in manifest['tiles']:
        row, col = cell_id(id)
        groups.setdefault(f'{row//10}-{col//10}', []).append(id)
    assets, shards = {}, {}
    for group, ids in sorted(groups.items()):
        payload, offsets = bytearray(), {}
        for id in sorted(ids):
            row, col = cell_id(id)
            data = (source/f'{row}-{col}.oel.gz').read_bytes()
            original = manifest['tiles'][id]
            if len(data) != original['bytes'] or hashlib.sha256(data).hexdigest() != original['sha256']:
                raise ValueError(f'Input integrity failed: {id}')
            offsets[id] = len(payload)
            payload.extend(data)
        sha = hashlib.sha256(payload).hexdigest()
        filename = f'{group}-{sha}.pack'
        atomic(output/filename, payload)
        entries = {}
        for id in sorted(ids):
            a = manifest['tiles'][id]
            entries[id] = {'url': f'{base_url.rstrip("/")}/{filename}', 'bytes': a['bytes'], 'sha256': a['sha256'], 'range': {'offset': offsets[id], 'totalBytes': len(payload)}}
        assets.update(entries)
        shard = {**manifest, 'tiles': entries}
        shard_hash = hashlib.sha256(json.dumps(shard, sort_keys=True).encode()).hexdigest()
        shard_name = f'{group}-{shard_hash}.manifest.json'
        write_json(output/shard_name, shard)
        shards[group] = {'manifestUrl': f'{base_url.rstrip("/")}/{shard_name}', 'tileCount': len(entries), 'packBytes': len(payload), 'packSha256': sha}
    packed = {**manifest, 'tiles': assets}
    write_json(output/'manifest.json', packed)
    write_json(output/'distribution.json', {'grid': manifest['grid'], 'version': manifest['version'], 'shards': shards, 'published': False})
    report = {'tiles': len(assets), 'packs': len(shards), 'packBytes': sum(s['packBytes'] for s in shards.values()), 'published': False}
    write_json(output/'pack-report.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--base-url', required=True)
    args = parser.parse_args()
    print(json.dumps(pack(args.input, args.output, args.base_url), indent=2))
