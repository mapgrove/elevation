# Resumable small-grid builds

The builder converts cataloged Copernicus GLO-90 sources into versioned 0.1° tiles. Each tile has 121 × 121 Float32 samples on the global 3-arcsecond lattice. It produces files locally; it does not upload or publish them.

## Install and preview

From the repository root, use Python 3.11+ in a virtual environment:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r scripts/requirements.txt
python scripts/tile_pipeline.py --preset south-korea --dry-run
python scripts/tile_pipeline.py --preset world --limit 100 --dry-run
```

The South Korea preset is the bounding envelope `[124.5, 33, 132, 39]`, including surrounding sea and neighboring territory: 4,500 cells. It is not an administrative polygon or a completeness certification. The world envelope contains 6,480,000 possible cells including ocean and unavailable source areas. Raw byte estimates are uncompressed output, not download estimates. Dry runs never fetch sources.

## Build an area

```sh
python scripts/tile_pipeline.py --bounds 127 37.5 127.1 37.6 \
  --version example-v1 --output .cache/example-v1 \
  --base-url http://127.0.0.1:8080
# Repeat the identical command to resume. Cached original sources can be used offline:
python scripts/tile_pipeline.py --bounds 127 37.5 127.1 37.6 \
  --version example-v1 --output .cache/example-v1 \
  --base-url http://127.0.0.1:8080 --offline
python -m http.server 8080 --directory .cache/example-v1
```

Load `manifest.json` with `createTerrain` as described in [Usage](USAGE.md). Bounds are west/south/east/north, with exclusive east/north selection edges. West greater than east crosses the date line. Alternatively repeat `--cell ROW/COLUMN` for explicit cells. `--limit` selects the first cells in row order; it is a bounded trial, not a complete build. Individual invocations are limited to 5,000 selected cells. Use separate immutable output directories for larger batches; batch manifest aggregation is not implemented.

Sources are downloaded from the public AWS GLO-90 bucket and cached in `.cache/global`. Offline mode fails if a cataloged required source is absent from that cache. Source hash mismatches fail visibly. A resumed build also rejects changed source hashes against its recorded provenance, so repairs cannot silently mix source revisions. There is no paid service or API key, but internet transfer and local disk use still apply.

## Checkpoints and outputs

- `build-state.json`: immutable selection, catalog fingerprint, completed cell hashes and source provenance. Each completed cell is checkpointed atomically. Resume verifies output hashes and regenerates missing/corrupt files.
- `manifest.json`: only generated cells, with exact compressed sizes and SHA-256 hashes.
- `coverage.json`: requested, built and unavailable cell IDs. The published list stays empty.
- `provenance.json`: original URLs, bytes, hashes and missing neighboring sources.
- `report.json`: build counts and measured output bytes. `downloadedSourceBytesThisRun` counts source downloads in this invocation only.

Changing a build's selection, version, base URL or catalog requires a fresh output directory. Avoid concurrent writers to the same output directory. A failed build can be resumed; manifests/reports describe the last completed invocation until it finishes again.

## Sampling and missing data

Native source sample centers are checked against their georeferencing. GLO-90 source widths vary with latitude; horizontal linear interpolation places them on the fixed global lattice. Shared output edges use identical integer node coordinates, including source boundaries and the date line. Missing eastern or southern source support stays NaN rather than extending the last available height. No source coverage is treated as unknown, not automatically as sea level. An all-NaN cell is unavailable; a built cell can still have missing nodes. The South Pole has no retained source sample support.

These are surface elevations referenced to EGM2008, not bare-earth terrain. Preserve the manifest attribution and [Copernicus notice](../data/global/NOTICE.md) when redistributing data. Source cache integrity hashes record fetched bytes; they are not an independent vendor signature.

## Verification

```sh
python -m unittest discover -s scripts -p 'test_*.py'
```

Tests cover latitude-band resampling, source seams, date-line seams, missing coverage, offline failure, reproducible output, checkpoint resumption and repair. CI uses synthetic georeferenced sources and performs no terrain downloads. For the subsequent public envelope/staged builds and full validation results, see [Coverage](COVERAGE.md). A local real-source smoke build of cell `1275/3070` generated a 47,657-byte tile from the cached Seoul source; this is not nationwide coverage evidence.
