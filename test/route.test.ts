import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleRoute, distanceMeters } from "../src/index.ts";
test("route sampling preserves endpoints and bounds distance between samples", () => {
  const route = [
    { latitude: 37.55, longitude: 127.03 },
    { latitude: 37.72, longitude: 127.22 },
  ];
  const samples = sampleRoute(route, { spacingMeters: 90 });
  assert.deepEqual(samples[0], route[0]);
  assert.deepEqual(samples.at(-1), route[1]);
  assert.ok(samples.length > 200);
  for (let i = 1; i < samples.length; i++)
    assert.ok(distanceMeters(samples[i - 1], samples[i]) <= 90.00001);
  samples[0].latitude = 0;
  assert.equal(route[0].latitude, 37.55);
});
test("route sampling takes the short path across the antimeridian", () => {
  const samples = sampleRoute(
    [
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    ],
    { spacingMeters: 5000 },
  );
  assert.ok(samples.length < 10);
  assert.ok(samples.every((p) => Math.abs(p.longitude) > 179));
});
test("invalid, excessively dense and ambiguous routes fail before allocation", () => {
  assert.deepEqual(sampleRoute([]), []);
  assert.throws(() => sampleRoute([], { spacingMeters: 0 }), RangeError);
  assert.throws(
    () => sampleRoute([{ latitude: 91, longitude: 0 }]),
    RangeError,
  );
  assert.throws(
    () =>
      sampleRoute(
        [
          { latitude: 0, longitude: 0 },
          { latitude: 0, longitude: 1 },
        ],
        { spacingMeters: 1, maxPoints: 100 },
      ),
    RangeError,
  );
  assert.throws(
    () =>
      sampleRoute([
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 180 },
      ]),
    /Antipodal/,
  );
});
