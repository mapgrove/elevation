/** Geographic coordinates in degrees. */
export type Point = { latitude: number; longitude: number };

/** Public grid v1: the same cell addresses for country and world datasets. */
export const GRID_V1 = Object.freeze({
  id: "geographic-0.1-v1" as const,
  crs: "EPSG:4326" as const,
  tilesPerDegree: 10,
  rows: 1800,
  columns: 3600,
});

/** Legacy generic addressing; new datasets must declare GRID_V1 explicitly. */
export function tileFor(p: Point, tilesPerDegree = 1) {
  if (
    !Number.isSafeInteger(tilesPerDegree) ||
    tilesPerDegree < 1 ||
    tilesPerDegree > 120
  )
    throw new RangeError("tilesPerDegree must be an integer from 1 to 120");
  if (
    !Number.isFinite(p.latitude) ||
    !Number.isFinite(p.longitude) ||
    Math.abs(p.latitude) > 90 ||
    Math.abs(p.longitude) > 180
  )
    throw new RangeError("Invalid geographic coordinates");
  const lon = p.longitude === 180 ? -180 : p.longitude;
  const snapFloor = (v: number) =>
    Math.floor(Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v);
  const row = Math.min(
    180 * tilesPerDegree - 1,
    snapFloor(p.latitude * tilesPerDegree + 90 * tilesPerDegree),
  );
  // A value just below +180 may snap onto the final edge: wrap, never emit an out-of-range column.
  const col =
    snapFloor(lon * tilesPerDegree + 180 * tilesPerDegree) %
    (360 * tilesPerDegree);
  return {
    id: `${row}/${col}`,
    south: row / tilesPerDegree - 90,
    west: col / tilesPerDegree - 180,
    longitude: col === 0 && lon > 179 ? lon - 360 : lon,
  };
}

export function gridCellFor(point: Point) {
  return tileFor(point, GRID_V1.tilesPerDegree);
}

export function gridCellBounds(id: string) {
  if (!/^(0|[1-9]\d*)\/(0|[1-9]\d*)$/.test(id))
    throw new RangeError("Invalid grid cell ID");
  const [row, column] = id.split("/").map(Number);
  if (row >= GRID_V1.rows || column >= GRID_V1.columns)
    throw new RangeError("Grid cell ID outside global bounds");
  return {
    south: row / 10 - 90,
    north: (row + 1) / 10 - 90,
    west: column / 10 - 180,
    east: (column + 1) / 10 - 180,
  };
}

/** Compute nodes from global integer indices, ensuring shared edges use identical coordinates. */
export function gridNode(
  id: string,
  x: number,
  y: number,
  sampleSpacingArcSeconds: 1 | 3 = 3,
): Point {
  gridCellBounds(id);
  if (sampleSpacingArcSeconds !== 1 && sampleSpacingArcSeconds !== 3)
    throw new RangeError("Unsupported sample spacing");
  const samplesPerDegree = 3600 / sampleSpacingArcSeconds;
  const intervals = samplesPerDegree / GRID_V1.tilesPerDegree;
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x > intervals ||
    y > intervals
  )
    throw new RangeError("Node outside cell bounds");
  const [row, column] = id.split("/").map(Number);
  return {
    latitude: (row * intervals + y) / samplesPerDegree - 90,
    longitude: (column * intervals + x) / samplesPerDegree - 180,
  };
}

export type VersionedGridFields = {
  schemaVersion?: 1;
  grid?: typeof GRID_V1.id;
  sampleSpacingArcSeconds?: 1 | 3;
};

/** Validate schema declarations before any filesystem or network access. */
export function validateGridManifest(
  manifest: VersionedGridFields & {
    tilesPerDegree?: number;
    encoding?: string;
    verticalDatum: string;
    tiles: Record<string, unknown>;
  },
) {
  if (manifest.schemaVersion === undefined) {
    if (
      manifest.grid !== undefined ||
      manifest.sampleSpacingArcSeconds !== undefined
    )
      throw new Error("Grid declarations require schemaVersion 1");
    return undefined; // Existing alpha manifests remain readable without reinterpretation.
  }
  if (manifest.schemaVersion !== 1)
    throw new Error("Unsupported manifest schemaVersion");
  if (
    manifest.grid !== GRID_V1.id ||
    manifest.tilesPerDegree !== GRID_V1.tilesPerDegree
  )
    throw new Error("Unsupported or conflicting grid declaration");
  if (
    manifest.sampleSpacingArcSeconds !== 1 &&
    manifest.sampleSpacingArcSeconds !== 3
  )
    throw new Error("Unsupported sample spacing");
  if (manifest.encoding !== "float32-gzip-v1")
    throw new Error("Grid v1 requires float32-gzip-v1");
  if (manifest.verticalDatum !== "EGM2008 (EPSG:3855)")
    throw new Error("Grid v1 requires EGM2008 (EPSG:3855)");
  for (const id of Object.keys(manifest.tiles)) gridCellBounds(id);
  return 3600 / manifest.sampleSpacingArcSeconds / GRID_V1.tilesPerDegree + 1;
}
