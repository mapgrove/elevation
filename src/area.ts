import { gridCellBounds, gridCellFor, type Point } from "./grid.ts";

export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};
export type AreaSelection =
  | { bounds: Bounds; maxCells?: number }
  | { cells: readonly string[]; maxCells?: number }
  | { route: readonly Point[]; corridorMeters?: number; maxCells?: number };
export const SOUTH_KOREA_ENVELOPE: Bounds = Object.freeze({
  west: 124.5,
  south: 33,
  east: 132,
  north: 39,
});
function limit(value = 50_000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 6_480_000)
    throw new RangeError("maxCells must be an integer from 1 to 6480000");
  return value;
}
const snap = (v: number) =>
  Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v;
/** Cells intersecting a nonempty half-open envelope, including date-line crossings. */
export function cellsForBounds(b: Bounds, maxCells = 50_000): string[] {
  const cap = limit(maxCells);
  if (
    ![b.west, b.south, b.east, b.north].every(Number.isFinite) ||
    b.west < -180 ||
    b.west > 180 ||
    b.east < -180 ||
    b.east > 180 ||
    b.south < -90 ||
    b.north > 90 ||
    b.south >= b.north ||
    b.west === b.east
  )
    throw new RangeError("Invalid nonempty bounds");
  const spans =
    b.west < b.east
      ? [[b.west, b.east]]
      : [
          [b.west, 180],
          [-180, b.east],
        ];
  const rows = [
    Math.floor(snap((b.south + 90) * 10)),
    Math.ceil(snap((b.north + 90) * 10)),
  ];
  const columns = spans.map(([w, e]) => [
    Math.floor(snap((w + 180) * 10)),
    Math.ceil(snap((e + 180) * 10)),
  ]);
  const count =
    (rows[1] - rows[0]) * columns.reduce((s, [w, e]) => s + e - w, 0);
  if (count === 0) throw new RangeError("Invalid empty wrapped bounds");
  if (count > cap)
    throw new RangeError("Area exceeds maxCells; select a smaller area");
  const result: string[] = [];
  for (let row = rows[0]; row < rows[1]; row++)
    for (const [w, e] of columns)
      for (let col = w; col < e; col++) result.push(`${row}/${col}`);
  return result;
}
/** Conservative envelopes around sampled route segments; never just waypoint cells. */
export function cellsForArea(selection: AreaSelection): string[] {
  const cap = limit(selection.maxCells);
  if ("bounds" in selection) return cellsForBounds(selection.bounds, cap);
  const result = new Set<string>();
  const add = (id: string) => {
    result.add(id);
    if (result.size > cap)
      throw new RangeError("Area exceeds maxCells; select a smaller area");
  };
  if ("cells" in selection) {
    for (const id of selection.cells) {
      gridCellBounds(id);
      add(id);
    }
  } else {
    const width = selection.corridorMeters ?? 0;
    if (!Number.isFinite(width) || width < 0 || width > 1_000_000)
      throw new RangeError("corridorMeters must be between 0 and 1000000");
    if (selection.route.length > 100_000)
      throw new RangeError("Route exceeds 100000 points");
    for (const p of selection.route) add(gridCellFor(p).id);
    for (let i = 0; i < selection.route.length; i++) {
      const a = selection.route[Math.max(0, i - 1)],
        b = selection.route[i];
      // Longitude follows the shortest unwrapped segment. For great-circle paths,
      // pass sampleRoute output; these envelopes describe linear sampled segments.
      let delta = b.longitude - a.longitude;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const latPad = ((width / 6_371_008.8) * 180) / Math.PI;
      const south = Math.max(-90, Math.min(a.latitude, b.latitude) - latPad);
      const north = Math.min(90, Math.max(a.latitude, b.latitude) + latPad);
      const extreme = Math.max(Math.abs(south), Math.abs(north));
      const lonPad =
        extreme >= 90
          ? 180
          : Math.min(180, latPad / Math.cos((extreme * Math.PI) / 180));
      let west = Math.min(a.longitude, a.longitude + delta) - lonPad;
      let east = Math.max(a.longitude, a.longitude + delta) + lonPad;
      // Tiny padding includes boundary-owned endpoint cells and zero-width paths.
      const epsilon = 1e-8;
      const full = east - west >= 360;
      const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
      const bounds = {
        west: full ? -180 : wrap(west - epsilon),
        east: full ? 180 : wrap(east + epsilon),
        south: Math.max(-90, south - epsilon),
        north: Math.min(90, north + epsilon),
      };
      for (const id of cellsForBounds(bounds, cap)) add(id);
    }
  }
  return [...result].sort();
}
