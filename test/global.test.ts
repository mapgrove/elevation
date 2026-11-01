import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeArrayBuffer } from "geotiff";
import {
  createGlobalTerrain,
  loadGlobalCatalog,
  sourceName,
} from "../src/global.ts";
import { MissingTileError } from "../src/index.ts";

test("global catalog and source names cover hemispheres and high latitudes", async () => {
  const catalog = await loadGlobalCatalog();
  assert.equal(catalog.size, 26475);
  assert.ok(catalog.has(sourceName(-34, 18)));
  assert.ok(catalog.has(sourceName(51, -1)));
  assert.equal(sourceName(-1, -79), "Copernicus_DSM_COG_30_S01_00_W079_00_DEM");
  const sdk = createGlobalTerrain({ catalog, cacheDir: "/unused-test-cache" });
  const plan = await sdk.plan({
    points: [{ latitude: 51.5074, longitude: -0.1278 }],
  });
  assert.equal(plan.sourceTileIds[0], sourceName(51, -1));
  assert.equal(plan.downloadBytes, null);
  await assert.rejects(
    sdk.plan({ points: [{ latitude: 91, longitude: 0 }] }),
    RangeError,
  );
});

test("source COG download persists for offline native-sample lookup", async () => {
  const id = sourceName(37, 127),
    cacheDir = await mkdtemp(join(tmpdir(), "global-test-"));
  const bytes = Buffer.from(
    writeArrayBuffer(new Float32Array([10, 20, 30, 40]), {
      width: 2,
      height: 2,
      BitsPerSample: [32],
      SampleFormat: [3],
      SamplesPerPixel: 1,
      ModelPixelScale: [1 / 1200, 1 / 1200, 0],
      ModelTiepoint: [0, 0, 0, 127, 38, 0],
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 2,
      GeographicTypeGeoKey: 4326,
    }),
  );
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end(bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const options = {
    catalog: new Set([id]),
    cacheDir,
    sourceUrl: () => `http://127.0.0.1:${port}/tile`,
  };
  const point = { latitude: 38 - 1 / 1200, longitude: 127 + 1 / 1200 };
  try {
    const sdk = createGlobalTerrain(options);
    await assert.rejects(sdk.getElevation(point), MissingTileError);
    const plan = await sdk.plan({ points: [point, point] });
    assert.equal(plan.missingTileIds.length, 1);
    await sdk.download(plan);
    await sdk.download(plan);
    assert.equal(requests, 1);
    await new Promise<void>((r) => server.close(() => r()));
    const offline = createGlobalTerrain(options);
    assert.equal(await offline.getElevation(point), 40);
    assert.equal(
      (await offline.plan({ points: [point] })).missingTileIds.length,
      0,
    );
    assert.equal((await offline.cacheStatus()).totalBytes, bytes.length);
    assert.equal((await offline.getProfile([point, point]))[1].elevation, 40);
    await writeFile(join(cacheDir, `${id}.tif`), "bad");
    await assert.rejects(offline.getElevation(point), /Corrupt source cache/);
    await offline.removeTiles([id]);
    assert.equal((await offline.cacheStatus()).totalBytes, 0);
    await assert.rejects(offline.removeTiles(["../unrelated"]), RangeError);
  } finally {
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("missing coverage is explicit rather than assumed sea-level", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "global-missing-"));
  try {
    const sdk = createGlobalTerrain({ catalog: new Set(), cacheDir });
    const p = { latitude: 0, longitude: 0 };
    const plan = await sdk.plan({ points: [p] });
    assert.ok(plan.unavailableTileIds.length > 0);
    await assert.rejects(sdk.getElevation(p), MissingTileError);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});
