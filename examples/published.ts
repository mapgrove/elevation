// Explicit online preparation, followed by persistent offline profiles.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createTerrain,
  sampleRoute,
  NoDataError,
  type Manifest,
} from "../src/index.ts";
import { fetchBytes } from "../src/download.ts";
const args = process.argv.slice(2);
const dataset =
  args.find((a) => a.startsWith("--dataset="))?.split("=")[1] ?? "south-korea";
if (!["south-korea", "world-stage"].includes(dataset))
  throw new Error("Expected --dataset=south-korea or world-stage");
const prepare = args.includes("--prepare");
const forbidNetwork = async () => {
  throw new Error("Offline verification forbids network access");
};
if (!prepare) globalThis.fetch = forbidNetwork;
const cacheDir =
  args
    .find((a) => a.startsWith("--cache-dir="))
    ?.slice("--cache-dir=".length) ?? `.cache/published-${dataset}`;
const manifestPath = join(cacheDir, "manifest.json");
let manifestBytes = 0;
if (prepare) {
  const bytes = await fetchBytes(
    `https://github.com/mapgrove/elevation/releases/download/data-${dataset}-alpha-v1/manifest.json`,
    { maxBytes: 16 * 1024 * 1024, timeoutMs: 120000 },
  );
  manifestBytes = bytes.length;
  const parsed = JSON.parse(bytes.toString()) as Manifest;
  createTerrain({ manifest: parsed, cacheDir }); // Validate before replacing the cached manifest.
  await mkdir(cacheDir, { recursive: true });
  await writeFile(manifestPath, bytes);
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
const sdk = createTerrain({ manifest, cacheDir });
const locations =
  dataset === "south-korea"
    ? ([
        ["Seoul", 37.5665, 126.978],
        ["Busan", 35.1796, 129.0756],
        ["Jeju", 33.4996, 126.5312],
        ["Ulleungdo", 37.4845, 130.9057],
        ["Dokdo", 37.2411, 131.865],
      ] as const)
    : ([
        ["Seoul", 37.55, 127.05],
        ["London", 51.55, -0.15],
        ["Denver", 39.75, -104.85],
        ["Cape Town region", -33.95, 18.45],
        ["Sydney", -33.8688, 151.2093],
        ["Quito region", -0.15, -78.55],
        ["Svalbard", 78.2232, 15.6469],
        ["Date line east", -16.75, 179.95],
        ["Date line west", -16.75, -179.95],
      ] as const);
let requests = 0,
  downloadedBytes = 0;
const routes = [];
const start = performance.now();
for (const [name, latitude, longitude] of locations) {
  const points = sampleRoute(
    [
      { latitude, longitude },
      { latitude: latitude + 0.002, longitude: longitude + 0.002 },
    ],
    { spacingMeters: 90 },
  );
  const plan = await sdk.planArea({ route: points });
  if (plan.unavailableTileIds.length)
    throw new Error(
      `Manifest coverage gap: ${name}: ${plan.unavailableTileIds}`,
    );
  if (prepare) {
    const result = await sdk.download(plan);
    requests += result.requests;
    downloadedBytes += result.downloadedBytes;
  }
  try {
    const profile = await sdk.getProfile(points);
    routes.push({
      name,
      samples: profile.length,
      firstElevation: profile[0].elevation,
      lastElevation: profile.at(-1)!.elevation,
    });
  } catch (error) {
    if (!(error instanceof NoDataError)) throw error;
    routes.push({ name, noData: true });
  }
}
const elapsedMs = performance.now() - start;
globalThis.fetch = forbidNetwork;
const warmStart = performance.now();
let warmSamples = 0;
for (const [, latitude, longitude] of locations) {
  try {
    await sdk.getElevation({ latitude, longitude });
    warmSamples++;
  } catch (error) {
    if (!(error instanceof NoDataError)) throw error;
  }
}
console.log(
  JSON.stringify(
    {
      dataset,
      mode: prepare ? "explicit preparation" : "offline",
      manifestBytes,
      requests,
      downloadedBytes,
      elapsedMs,
      warmLookupMs: performance.now() - warmStart,
      warmSamples,
      cacheBytes: (await sdk.cacheStatus()).totalBytes,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      routes,
      meaning:
        "Surface height examples and runtime measurements; not ground-truth accuracy.",
    },
    null,
    2,
  ),
);
