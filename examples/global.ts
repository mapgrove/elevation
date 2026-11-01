import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createGlobalTerrain,
  loadGlobalCatalog,
  globalAttribution,
} from "../src/global.ts";
const sdk = createGlobalTerrain({
  catalog: await loadGlobalCatalog(),
  cacheDir: ".cache/global",
});
const points = [
  { name: "Seoul", latitude: 37.5665, longitude: 127.05 },
  { name: "London", latitude: 51.5074, longitude: -0.1278 },
  { name: "Denver", latitude: 39.7392, longitude: -104.9903 },
  { name: "Cape Town", latitude: -33.9249, longitude: 18.4241 },
  { name: "Sydney", latitude: -33.8688, longitude: 151.2093 },
  { name: "Quito", latitude: -0.1807, longitude: -78.4678 },
];
const plan = await sdk.plan({ points });
console.log(
  "Global source mode: full one-degree COG downloads, nearest native sample.",
);
console.log(
  "Source tiles:",
  plan.sourceTileIds.length,
  "Missing:",
  plan.missingTileIds.length,
);
console.log(
  "Exact download bytes unknown until fetched; not the small-tile regional mode.",
);
if (process.argv.includes("--offline")) {
  globalThis.fetch = async () => {
    throw new Error("Network disabled for offline verification");
  };
  if (plan.missingTileIds.length)
    throw new Error("Run without --offline first to prepare the source cache");
} else await sdk.download(plan);
const reference = JSON.parse(
  await readFile(
    new URL("../data/global/verification.json", import.meta.url),
    "utf8",
  ),
);
for (const point of points) {
  const height = await sdk.getElevation(point);
  assert.equal(
    height,
    reference.samples.find((s: any) => s.name === point.name)
      .expectedNearestElevation,
  );
  console.log(point.name, height, "m EGM2008");
}
console.log(
  "Remaining downloads:",
  (await sdk.plan({ points })).missingTileIds.length,
);
console.log(globalAttribution);
