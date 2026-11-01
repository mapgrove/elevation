import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createTerrain, tileFor } from "../src/index.ts";

test("subdegree grid assigns decimal boundaries and poles consistently", () => {
  assert.equal(
    tileFor({ latitude: 37.6, longitude: 127.1 }, 10).id,
    "1276/3071",
  );
  assert.equal(tileFor({ latitude: 90, longitude: 180 }, 10).id, "1799/0");
  assert.equal(tileFor({ latitude: -0.1, longitude: -0.1 }, 10).id, "899/1799");
  assert.throws(() => tileFor({ latitude: 0, longitude: 0 }, 1.5), RangeError);
});

test("real regional data agrees with source raster samples offline", async () => {
  const root = new URL("../data/seoul-90m/", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  );
  const references = JSON.parse(
    await readFile(new URL("references.json", root), "utf8"),
  ).samples;
  let requests = 0;
  const server = createServer(async (req, res) => {
    const id = req.url!.slice(1);
    if (!/^\d+-\d+\.oel\.gz$/.test(id)) {
      res.writeHead(404).end();
      return;
    }
    try {
      requests++;
      res.end(await readFile(new URL(id, root)));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const cacheDir = await mkdtemp(join(tmpdir(), "regional-elevation-"));
  try {
    for (const [id, asset] of Object.entries(manifest.tiles))
      (asset as { url: string }).url =
        `http://127.0.0.1:${port}/${id.replace("/", "-")}.oel.gz`;
    const sdk = createTerrain({ manifest, cacheDir });
    const points = references.map((r: any) => r.point);
    const plan = await sdk.plan({ points });
    assert.equal(plan.tileIds.length, 4);
    await sdk.download(plan);
    assert.equal(requests, plan.tileIds.length);
    await new Promise<void>((r) => server.close(() => r()));
    const offline = createTerrain({ manifest, cacheDir });
    const profile = await offline.getProfile(points);
    for (let i = 0; i < profile.length; i++)
      assert.ok(
        Math.abs(profile[i].elevation - references[i].elevation) < 0.001,
        `source mismatch at ${i}`,
      );
    assert.equal((await offline.plan({ points })).downloadBytes, 0);
  } finally {
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("binary decoder rejects inconsistent payload length after valid checksum", async () => {
  const raw = Buffer.alloc(20);
  raw.write("OEL1");
  raw.writeUInt32LE(2, 4);
  raw.writeUInt32LE(2, 8);
  raw.writeUInt32LE(90, 12);
  raw.writeUInt32LE(180, 16);
  const bytes = gzipSync(raw),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const server = createServer((_req, res) => res.end(bytes));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const cacheDir = await mkdtemp(join(tmpdir(), "bad-elevation-"));
  try {
    const sdk = createTerrain({
      cacheDir,
      manifest: {
        version: "test",
        attribution: "Synthetic",
        verticalDatum: "Synthetic",
        encoding: "float32-gzip-v1",
        tiles: {
          "90/180": {
            url: `http://127.0.0.1:${port}/`,
            bytes: bytes.length,
            sha256,
          },
        },
      },
    });
    await assert.rejects(
      sdk.download(await sdk.plan({ points: [{ latitude: 0, longitude: 0 }] })),
      /binary length/,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(cacheDir, { recursive: true, force: true });
  }
});
