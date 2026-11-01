# Provisional data contract

This JSON format exists to validate SDK behavior. Do not publish a global dataset in this format before size and performance benchmarks.

## Grid

EPSG:4326 coordinates, one-degree cells, west/south inclusive and east/north exclusive. Longitude 180 wraps to -180. Latitude 90 belongs to the northernmost cell. IDs are `row/column`, indexed from (-90, -180). Every tile stores both boundary edges so interpolation within a tile does not need a neighbor. Adjacent producers must agree on shared-edge values.

## Manifest

`version`, `attribution`, `verticalDatum`, and `tiles` keyed by ID. Each tile has an HTTPS URL (HTTP allowed only for localhost tests), exact byte size and lowercase SHA-256. Missing entries mean unavailable coverage. Version manifests should be immutable.

## Tile

JSON object `{ id, width, height, values }`. At least 2 rows and 2 columns. Row-major values run south to north and west to east, including boundaries. Values are finite meters relative to the manifest datum; null means no data. Bilinear queries fail only if a sample with positive interpolation weight is missing.

## Cache

Cache keys use content SHA-256, avoiding collisions between manifest versions and providers. Bytes are verified on every read. Writes use a unique temporary file followed by rename. An interrupted download never becomes a complete tile. Cache eviction and deletion APIs are deferred.
