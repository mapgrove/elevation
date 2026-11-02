# Data contract

The versioned output grid is **`geographic-0.1-v1`**: the same 0.1° geographic addresses for country and global datasets. See [the normative grid contract and compatibility rules](GRID_V1.md). This is a format decision; worldwide small-grid publication is separate work.

New manifests declare `schemaVersion: 1`, `grid`, `tilesPerDegree: 10`, `sampleSpacingArcSeconds: 3` (or `1`), `encoding: "float32-gzip-v1"` and `verticalDatum: "EGM2008 (EPSG:3855)"`, alongside dataset version, attribution and asset metadata. The decoder checks these declarations before reading files and verifies 121×121 (or 361×361) tile dimensions.

Each binary file is gzip-compressed OEL1: four magic bytes, little-endian uint32 width/height/row/column, then row-major little-endian Float32 heights. Rows run south to north; duplicated edge nodes use global integer coordinates. NaN is no-data; infinity is invalid. The manifest supplies exact compressed size and SHA-256. No positive-weight missing sample becomes zero.

## Legacy alpha support

Unversioned JSON and binary alpha manifests remain readable with their previous interpretation. The generic `tileFor` helper retains its historical default of one degree; use `gridCellFor` for public v1 output cells. Unversioned manifests cannot declare new grid or sample-spacing fields. One-degree global source COG mode is not the public output-grid format.

Legacy JSON tiles contain `{ id, width, height, values }`, finite heights or null, at least two rows/columns. Legacy binary tiles retain header and structural validation but are not assigned a new sample spacing automatically.

## Cache

Cache keys use content SHA-256. Every disk read verifies integrity. Unique temporary files and rename prevent interrupted downloads from becoming complete tiles. Explicit status and known-tile removal APIs are available; automatic eviction remains future work. The historical cache extension is `.json` even for binary payloads; the manifest controls decoding. Global source mode has its own original-COG cache.

The nine-tile Seoul fixture has been migrated by adding schema metadata while preserving existing payload bytes and hashes. Its outer east/north edges still belong to neighboring cells, so missing neighbor entries remain coverage errors. The reserved release URLs are not a hosted dataset service.
