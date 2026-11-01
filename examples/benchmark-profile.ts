// Offline microbenchmark; first run demo:global to prepare the London source.
import assert from "node:assert/strict";
import { createGlobalTerrain, loadGlobalCatalog } from "../src/global.ts";
const sdk = createGlobalTerrain({
  catalog: await loadGlobalCatalog(),
  cacheDir: ".cache/global",
});
const points = Array.from({ length: 40 }, (_, i) => ({
  latitude: 51.5074 + i * 0.0001,
  longitude: -0.1278 + i * 0.0001,
}));
const plan = await sdk.plan({ points });
if (plan.missingTileIds.length)
  throw new Error("Run demo:global first; this benchmark never downloads");
globalThis.fetch = async () => {
  throw new Error("Network disabled");
};
let start = performance.now();
const individual = [];
for (const p of points) individual.push(await sdk.getElevation(p));
const individualMs = performance.now() - start;
start = performance.now();
const profile = await sdk.getProfile(points);
const profileMs = performance.now() - start;
assert.deepEqual(
  profile.map((p) => p.elevation),
  individual,
);
console.log(
  JSON.stringify(
    {
      samples: points.length,
      individualMs,
      profileMs,
      speedup: individualMs / profileMs,
      note: "One warm-disk-cache London source; not a universal performance guarantee.",
    },
    null,
    2,
  ),
);
