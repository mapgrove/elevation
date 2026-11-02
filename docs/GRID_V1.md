# Grid contract v1

Decision for issue #2. This contract defines output data independently of upstream Copernicus source-file boundaries. It does not claim that nationwide or worldwide output files have already been generated or published.

## Decision: 0.1-degree cells

Use `geographic-0.1-v1` for both South Korea and worldwide datasets. A country is a coverage selection of the same cells, never a separate grid origin or a renumbered country index. Coordinates use EPSG:4326 longitude/latitude degrees; API objects are named `{ latitude, longitude }` to avoid axis-order ambiguity.

The existing 0.1° fixture already exercises this extent. The regional benchmark shows that 0.05° reduces excess bytes along a narrow route, but would increase the estimated global object count from 2,647,500 to 10,590,000 before filtering. Request latency, real route workloads and global distribution are not yet measured. Keep 0.1° as v1 to preserve addresses and limit object count; evaluate packing/range delivery separately in #4. A future extent change gets a different grid ID. This decision does not assume millions of individual files will be hosted on GitHub.

Tile extent and height sampling are separate: GLO-90 output samples use 3 arcseconds (nominally 90 m north/south), while an optional GLO-30 dataset uses 1 arcsecond. Neither value describes vertical accuracy. Longitude distances shrink toward the poles; a degree grid is not an equal-area or fixed-meter grid.

## Addressing

- Origin: latitude -90°, longitude -180°.
- 10 cells per degree; 1,800 rows and 3,600 columns.
- IDs: canonical decimal `row/column`, with no signs or leading zeros except `0` itself.
- Row increases northward; column increases eastward.
- Bounds: `[south, north) × [west, east)`. Exactly +90° belongs to the final row. Exactly +180° is normalized to -180°.
- Coordinates within 1e-9 grid units of an edge snap to that edge before assignment. Snapping onto +180° also wraps to column zero; an ID at column 3600 is never valid.
- Polar points retain a longitude for addressing. Producers must make valid physical pole-node heights agree across longitudes, or represent absent source support as no-data; no extrapolation is permitted.

`gridCellFor(point)` selects the v1 cell. `gridCellBounds(id)` checks an ID and returns its extent. `tileFor(point, tilesPerDegree)` remains a legacy generic helper, whose historical default is one degree. New callers should not mistake that compatibility default for the public output grid.

## Nodes and shared edges

A 3-arcsecond cell has 120 intervals and **121 × 121** nodes, including all four edges. At 1 arcsecond it has 360 intervals and **361 × 361** nodes. Node coordinates must be computed from global integer indices:

```text
intervalsPerCell = (3600 / sampleSpacingArcSeconds) / 10
latitude  = (row    * intervalsPerCell + y) / (3600 / sampleSpacingArcSeconds) - 90
longitude = (column * intervalsPerCell + x) / (3600 / sampleSpacingArcSeconds) - 180
```

`gridNode(id, x, y, spacing)` implements this convention. Adjacent cells use identical coordinates for duplicated nodes. Across the dateline, the +180° and -180° node edges describe the same meridian and must agree in value. A border query belongs to its north/east cell, except at the pole and dateline exceptions above; storing duplicated nodes does not expand coverage.

Output longitude spacing stays regular when upstream native COG widths change at latitude bands. The builder must stitch/resample neighboring sources onto these nodes, including the removed south/east edges in AWS COGs. It must not pretend interpolated output nodes are new independent native measurements. Ingestion and real seam validation belong to #3 and #5. Synthetic tests in this PR validate output addressing/continuity, not completed source stitching.

## Versioned manifests

New datasets explicitly declare:

```json
{
  "schemaVersion": 1,
  "grid": "geographic-0.1-v1",
  "tilesPerDegree": 10,
  "sampleSpacingArcSeconds": 3,
  "encoding": "float32-gzip-v1",
  "verticalDatum": "EGM2008 (EPSG:3855)",
  "version": "dataset-specific-immutable-version",
  "attribution": "Dataset attribution and applicable notices",
  "tiles": {}
}
```

`schemaVersion` versions manifest semantics, `grid` versions cell geometry and IDs, and `version` identifies an immutable dataset release. Publish new dataset versions for changed heights, coverage or processing. Attribution/license/provenance must accompany actual datasets. Missing asset entries mean unavailable or unbuilt coverage, not known ocean. Coverage reporting and sharded manifests are follow-up delivery work.

The SDK rejects unknown schemas/grids, conflicting extent fields, unsupported spacing/encoding/datum, noncanonical/out-of-world IDs and tile dimensions inconsistent with declared spacing. Validation begins before cache or network access.

## Encoding and missing values

Each tile is gzip-compressed with an uncompressed 20-byte header: ASCII `OEL1`, followed by unsigned little-endian uint32 `width`, `height`, `row`, `column`. Row-major samples follow as little-endian Float32 meters, running south to north and west to east. Width and height must match the manifest spacing. A tile is not self-describing without its versioned manifest; the OEL1 header alone does not encode the grid extent or datum.

NaN encodes no-data; infinity is invalid. Interpolation fails if a positively weighted node is missing and never substitutes zero. Shared edges must have identical Float32 values and no-data masks after processing. The manifest includes exact compressed bytes and SHA-256 for every file. Decoding verifies size, hash, header identity, dimensions and values before cache commit. The existing 64 MiB decompressed limit remains.

## Compatibility and migration

Unversioned alpha manifests continue to use their explicit `tilesPerDegree`, or the historical one-degree default when absent. They retain their original encoding and dimension rules. Grid or spacing declarations without `schemaVersion` are rejected to avoid partial upgrades. Unknown future schema versions fail closed rather than being treated as legacy.

To migrate an existing 0.1° binary dataset, confirm EGM2008, canonical IDs, correct 121/361 dimensions and shared edges, then add schema/grid/spacing fields. The unpublished nine-tile Seoul fixture now declares schema v1; its payload bytes, hashes, IDs and source attribution are unchanged. A published immutable manifest should get a new dataset version instead of being edited in place. Other extents or one-degree source COGs cannot be relabeled as v1: they need conversion. Source mode remains a documented fallback and has not become small-grid delivery.

## Evidence

`test/grid.test.ts` checks global extent, decimal boundaries, poles/dateline, canonical IDs, bit-identical shared node coordinates across all documented latitude bands, an affine synthetic surface across the 50°/integer-longitude seam, incompatible manifests/dimensions and the unchanged real Seoul payload hashes. Existing offline raster-reference tests continue to validate the upgraded fixture.
