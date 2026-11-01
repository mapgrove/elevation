import { tileFor, type Point } from "./index.ts";
const EARTH_RADIUS = 6_371_008.8;
const rad = (n: number) => (n * Math.PI) / 180;
const vector = (p: Point) => [
  Math.cos(rad(p.latitude)) * Math.cos(rad(p.longitude)),
  Math.cos(rad(p.latitude)) * Math.sin(rad(p.longitude)),
  Math.sin(rad(p.latitude)),
];
function angle(a: Point, b: Point) {
  const dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return (
    2 *
    Math.atan2(
      Math.sqrt(Math.max(0, Math.min(1, h))),
      Math.sqrt(Math.max(0, 1 - h)),
    )
  );
}
/** Great-circle distance on a sphere, in meters. Not a surveyed path length. */
export function distanceMeters(a: Point, b: Point) {
  tileFor(a);
  tileFor(b);
  return angle(a, b) * EARTH_RADIUS;
}
/** Insert great-circle samples so each consecutive pair is at most spacingMeters apart. */
export function sampleRoute(
  points: readonly Point[],
  options: { spacingMeters?: number; maxPoints?: number } = {},
): Point[] {
  const spacing = options.spacingMeters ?? 90,
    maxPoints = options.maxPoints ?? 100_000;
  if (!Number.isFinite(spacing) || spacing <= 0)
    throw new RangeError("spacingMeters must be positive and finite");
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 1)
    throw new RangeError("maxPoints must be a positive integer");
  for (const p of points) tileFor(p);
  if (points.length > maxPoints)
    throw new RangeError("Route exceeds maxPoints");
  if (!points.length) return [];
  const segments: { theta: number; steps: number }[] = [];
  let count = 1;
  for (let i = 1; i < points.length; i++) {
    const theta = angle(points[i - 1], points[i]);
    if (Math.PI - theta < 1e-7)
      throw new RangeError(
        "Antipodal route endpoints need an intermediate waypoint",
      );
    const steps = Math.max(1, Math.ceil((theta * EARTH_RADIUS) / spacing));
    count += steps;
    if (count > maxPoints)
      throw new RangeError(
        "Sampled route exceeds maxPoints; increase spacingMeters",
      );
    segments.push({ theta, steps });
  }
  const result: Point[] = [{ ...points[0] }];
  for (let i = 0; i < segments.length; i++) {
    const { theta, steps } = segments[i],
      a = vector(points[i]),
      b = vector(points[i + 1]);
    for (let step = 1; step < steps; step++) {
      const f = step / steps;
      const wa =
        theta < 1e-10 ? 1 - f : Math.sin((1 - f) * theta) / Math.sin(theta);
      const wb = theta < 1e-10 ? f : Math.sin(f * theta) / Math.sin(theta);
      const [x, y, z] = a.map((v, j) => wa * v + wb * b[j]);
      result.push({
        latitude: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
        longitude: (Math.atan2(y, x) * 180) / Math.PI,
      });
    }
    result.push({ ...points[i + 1] });
  }
  return result;
}
