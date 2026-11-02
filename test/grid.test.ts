import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GRID_V1,
  gridCellFor,
  gridCellBounds,
  gridNode,
  tileFor,
  createTerrain,
  type Manifest,
} from "../src/index.ts";

test("grid v1 fixes global IDs, half-open edges and dateline wrapping", () => {
  assert.equal(
    gridCellFor({ latitude: 37.6, longitude: 127.1 }).id,
    "1276/3071",
  );
  assert.equal(gridCellFor({ latitude: -90, longitude: -180 }).id, "0/0");
  assert.equal(gridCellFor({ latitude: 90, longitude: 180 }).id, "1799/0");
  assert.equal(
    gridCellFor({ latitude: 0, longitude: 180 - 1e-6 }).id,
    "900/3599",
  );
  assert.equal(
    gridCellFor({ latitude: 0, longitude: 180 - 1e-12 }).id,
    "900/0",
  );
  assert.equal(tileFor({ latitude: 0, longitude: 180 - 1e-12 }).id, "90/0");
  assert.equal(
    gridCellFor({ latitude: 37.599999, longitude: 127.099999 }).id,
    "1275/3070",
  );
  assert.deepEqual(gridCellBounds("0/0"), {
    south: -90,
    north: -89.9,
    west: -180,
    east: -179.9,
  });
  for (const id of ["1800/0", "0/3600", "01/2", "-1/0", "1.5/2", "../x"])
    assert.throws(() => gridCellBounds(id), RangeError);
});

test("shared nodes are identical across cell edges and latitude bands", () => {
  for (const latitude of [0, 50, 60, 70, 80, 85, -50, -60, -70, -80, -85]) {
    const row = (latitude + 90) * 10,
      col = 3079;
    for (const spacing of [1, 3] as const) {
      const intervals = 3600 / spacing / 10;
      assert.deepEqual(
        gridNode(`${row - 1}/${col}`, 10, intervals, spacing),
        gridNode(`${row}/${col}`, 10, 0, spacing),
      );
      assert.deepEqual(
        gridNode(`${row}/${col}`, intervals, 10, spacing),
        gridNode(`${row}/${col + 1}`, 0, 10, spacing),
      );
      assert.equal(gridNode(`${row}/${col}`, 0, 0, spacing).latitude, latitude);
    }
  }
  assert.equal(gridNode("1799/3599", 120, 120).longitude, 180);
  assert.equal(gridNode("1799/3599", 120, 120).latitude, 90);
  assert.equal(gridNode("0/0", 0, 0).latitude, -90);
  assert.throws(() => gridNode("0/0", 121, 0), RangeError);
  assert.throws(() => gridNode("0/0", 0, 0, 2 as 3), RangeError);
});

const fields = {
  schemaVersion: 1 as const,
  grid: GRID_V1.id,
  tilesPerDegree: 10,
  sampleSpacingArcSeconds: 3 as const,
  encoding: "float32-gzip-v1" as const,
  version: "synthetic-v1",
  attribution: "Synthetic",
  verticalDatum: "EGM2008 (EPSG:3855)",
};

test("versioned manifests reject incompatible declarations before I/O", () => {
  const manifest: Manifest = { ...fields, tiles: {} };
  const make = (changes: object) =>
    createTerrain({
      cacheDir: "/unused",
      manifest: { ...manifest, ...changes },
    });
  for (const change of [
    { schemaVersion: 2 },
    { grid: "unknown" },
    { tilesPerDegree: 20 },
    { sampleSpacingArcSeconds: 2 },
    { sampleSpacingArcSeconds: undefined },
    { encoding: "json" },
    { verticalDatum: "unknown" },
    { tiles: { "1800/0": {} } },
  ])
    assert.throws(() => make(change));
  assert.throws(
    () => make({ schemaVersion: undefined }),
    /require schemaVersion/,
  );
  assert.doesNotThrow(() => make({ sampleSpacingArcSeconds: 1 }));
  assert.doesNotThrow(() =>
    createTerrain({
      cacheDir: "/unused",
      manifest: {
        version: "legacy",
        attribution: "Synthetic",
        verticalDatum: "Synthetic",
        tiles: {},
      },
    }),
  );
});

function binary(id: string, side = 121) {
  const [row, col] = id.split("/").map(Number),
    raw = Buffer.alloc(20 + side * side * 4);
  raw.write("OEL1");
  raw.writeUInt32LE(side, 4);
  raw.writeUInt32LE(side, 8);
  raw.writeUInt32LE(row, 12);
  raw.writeUInt32LE(col, 16);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const point = gridNode(id, x, y);
      raw.writeFloatLE(
        point.latitude * 2 + point.longitude * 3,
        20 + (y * side + x) * 4,
      );
    }
  return gzipSync(raw);
}

test("versioned tiles interpolate consistently across a source and latitude-band seam", async () => {
  // A synthetic affine surface isolates grid geometry from source stitching (#3).
  const ids = ["1399/3079", "1399/3080", "1400/3079", "1400/3080"];
  const payloads = new Map(ids.map((id) => [id, binary(id)]));
  const server = createServer((req, res) => {
    const bytes = payloads.get(req.url!.slice(1));
    if (bytes) res.end(bytes);
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number },
    cacheDir = await mkdtemp(join(tmpdir(), "grid-contract-"));
  const manifest: Manifest = {
    ...fields,
    tiles: Object.fromEntries(
      ids.map((id) => {
        const bytes = payloads.get(id)!;
        return [
          id,
          {
            url: `http://127.0.0.1:${port}/${id}`,
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        ];
      }),
    ),
  };
  try {
    const sdk = createTerrain({ manifest, cacheDir });
    const points = [
      { latitude: 49.99999, longitude: 127.99999 },
      { latitude: 50, longitude: 128 },
      { latitude: 50.00001, longitude: 128.00001 },
      { latitude: 49.95, longitude: 128.05 },
      { latitude: 50.05, longitude: 127.95 },
    ];
    await sdk.download(await sdk.plan({ points }));
    await new Promise<void>((r) => server.close(() => r()));
    for (const p of points)
      assert.ok(
        Math.abs(
          (await sdk.getElevation(p)) - (p.latitude * 2 + p.longitude * 3),
        ) < 0.0001,
      );
    const bad = binary("1399/3079", 2),
      id = "1399/3079";
    const corruptManifest = {
      ...manifest,
      tiles: {
        [id]: {
          ...manifest.tiles[id],
          bytes: bad.length,
          sha256: createHash("sha256").update(bad).digest("hex"),
        },
      },
    };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(cacheDir, `${corruptManifest.tiles[id].sha256}.json`),
      bad,
    );
    await assert.rejects(
      createTerrain({ manifest: corruptManifest, cacheDir }).getElevation({
        latitude: 49.95,
        longitude: 127.95,
      }),
      /dimensions conflict/,
    );
  } finally {
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("upgraded Seoul manifest preserves existing tile bytes and addresses", async () => {
  const root = new URL("../data/seoul-90m/", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.grid, GRID_V1.id);
  for (const [id, a] of Object.entries(manifest.tiles)) {
    const asset = a as { sha256: string; bytes: number };
    const bytes = await readFile(
      new URL(`${id.replace("/", "-")}.oel.gz`, root),
    );
    assert.equal(bytes.length, asset.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
    );
  }
});
