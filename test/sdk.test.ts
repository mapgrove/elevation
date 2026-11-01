import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTerrain,
  tileFor,
  MissingTileError,
  NoDataError,
} from "../src/index.ts";
async function fixture(values: (number | null)[] = [0, 10, 20, 30]) {
  const bytes = Buffer.from(
    JSON.stringify({ id: "127/307", width: 2, height: 2, values }),
  );
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end(bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  const cacheDir = await mkdtemp(join(tmpdir(), "offline-elevation-"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    version: "synthetic-v1",
    attribution: "Synthetic",
    verticalDatum: "Synthetic",
    tiles: {
      "127/307": {
        url: `http://127.0.0.1:${port}/tile`,
        bytes: bytes.length,
        sha256,
      },
    },
  };
  const stop = async () => {
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
  };
  return {
    manifest,
    cacheDir,
    sha256,
    requests: () => requests,
    stop,
    clean: async () => {
      await stop();
      await rm(cacheDir, { recursive: true, force: true });
    },
  };
}
test("minimal download, persistent cache and network-free interpolation", async () => {
  const f = await fixture();
  try {
    const sdk = createTerrain(f),
      point = { latitude: 37.5, longitude: 127.5 };
    await assert.rejects(sdk.getElevation(point), MissingTileError);
    const plan = await sdk.plan({ points: [point, point] });
    assert.equal(plan.tileIds.length, 1);
    assert.equal(plan.downloadBytes, f.manifest.tiles["127/307"].bytes);
    await sdk.download(plan);
    await sdk.download(plan);
    assert.equal(f.requests(), 1);
    await f.stop();
    const offline = createTerrain(f);
    assert.equal(await offline.getElevation(point), 15);
    assert.equal((await offline.getProfile([point]))[0].elevation, 15);
    assert.equal((await offline.plan({ points: [point] })).downloadBytes, 0);
  } finally {
    await f.clean();
  }
});
test("geographic edges and invalid coordinates", () => {
  assert.equal(tileFor({ latitude: 90, longitude: 180 }).id, "179/0");
  assert.equal(tileFor({ latitude: -90, longitude: -180 }).id, "0/0");
  assert.throws(() => tileFor({ latitude: NaN, longitude: 0 }), RangeError);
  assert.throws(() => tileFor({ latitude: 0, longitude: 181 }), RangeError);
});
test("distinguishes no-data, zero, and absent coverage", async () => {
  const f = await fixture([0, null, 20, 30]);
  try {
    const sdk = createTerrain(f);
    await sdk.download(
      await sdk.plan({ points: [{ latitude: 37, longitude: 127 }] }),
    );
    assert.equal(await sdk.getElevation({ latitude: 37, longitude: 127 }), 0);
    await assert.rejects(
      sdk.getElevation({ latitude: 37.5, longitude: 127.5 }),
      NoDataError,
    );
    await assert.rejects(
      sdk.plan({ points: [{ latitude: 0, longitude: 0 }] }),
      MissingTileError,
    );
  } finally {
    await f.clean();
  }
});
test("rejects corrupted downloads and cache", async () => {
  const f = await fixture();
  try {
    const point = { latitude: 37.5, longitude: 127.5 },
      bad = structuredClone(f.manifest);
    bad.tiles["127/307"].sha256 = "0".repeat(64);
    const broken = createTerrain({ ...f, manifest: bad });
    await assert.rejects(
      broken.download(await broken.plan({ points: [point] })),
      /Integrity/,
    );
    assert.deepEqual(await readdir(f.cacheDir), []);
    const sdk = createTerrain(f);
    await sdk.download(await sdk.plan({ points: [point] }));
    await writeFile(join(f.cacheDir, `${f.sha256}.json`), "broken");
    await assert.rejects(sdk.getElevation(point), /Integrity/);
  } finally {
    await f.clean();
  }
});
