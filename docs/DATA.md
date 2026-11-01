# Provisional data contract

Both JSON correctness fixtures and an experimental compressed binary regional format are supported. Neither is a frozen production format.

## Grid

EPSG:4326 coordinates, cells of `1 / tilesPerDegree` degrees (default: one degree), west/south inclusive and east/north exclusive. Longitude 180 wraps to -180. Latitude 90 belongs to the northernmost cell. IDs are `row/column`, indexed from (-90, -180), scaled by `tilesPerDegree`. At most 120 cells per degree are accepted. Decimal boundaries snap within 1e-9 grid units. Every tile stores both boundary edges so interpolation within a tile does not need a neighbor. Adjacent producers must agree on shared-edge values.

## Manifest

`version`, `attribution`, `verticalDatum`, optional `tilesPerDegree`, optional `encoding`, and `tiles` keyed by ID. Each tile has an HTTPS URL (HTTP allowed only for localhost tests), exact byte size and lowercase SHA-256. Missing entries mean unavailable coverage. Version manifests should be immutable.

## Tile

JSON object `{ id, width, height, values }`. At least 2 rows and 2 columns. Row-major values run south to north and west to east, including boundaries. Values are finite meters relative to the manifest datum; null means no data. Bilinear queries fail only if a sample with positive interpolation weight is missing.

## Cache

Cache keys use content SHA-256, avoiding collisions between manifest versions and providers. Bytes are verified on every read. Writes use a unique temporary file followed by rename. An interrupted download never becomes a complete tile. Explicit cache status and known-tile removal APIs are available. Automatic eviction is deferred.

## Binary encoding

`encoding: "float32-gzip-v1"` selects gzip-compressed payloads. The uncompressed header is 20 bytes: ASCII `OEL1`, then unsigned little-endian 32-bit width, height, row and column. Samples follow as row-major little-endian Float32 meters, south to north. NaN denotes no data; infinities are rejected. The uncompressed decoder limit is 64 MiB per tile. Exact byte length, dimensions and tile identity are verified after checksum and decompression. The cache extension remains `.json` for compatibility even for binary payloads; content is decoded using the manifest encoding.

The committed sample has 121×121 nodes per 0.1° tile at 3 arcsecond spacing. Its nine tiles are complete only within the declared half-open coverage. Outer east/north edges belong to adjacent tiles and are unavailable if those entries are absent. Source COG pixel centers and removed edges require explicit handling when building neighboring regions.
