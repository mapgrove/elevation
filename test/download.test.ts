import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTerrain,
  MissingTileError,
  type DownloadProgress,
} from "../src/index.ts";
const point = { latitude: 37.5, longitude: 127.5 };
async function setup(mode: "normal" | "oversize" | "abort" = "normal") {
  const bytes = Buffer.from(
    JSON.stringify({
      id: "127/307",
      width: 2,
      height: 2,
      values: [0, 10, 20, 30],
    }),
  );
  const controller = new AbortController();
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    if (mode === "oversize") {
      res.writeHead(200, { "Content-Length": bytes.length + 10 });
      res.end(Buffer.concat([bytes, Buffer.alloc(10)]));
    } else if (mode === "abort") {
      res.writeHead(200);
      res.write(bytes.subarray(0, 10));
      setImmediate(() => controller.abort());
    } else res.end(bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number },
    cacheDir = await mkdtemp(join(tmpdir(), "elevation-download-"));
  const sdk = createTerrain({
    cacheDir,
    manifest: {
      version: "test",
      attribution: "Synthetic",
      verticalDatum: "Synthetic",
      tiles: {
        "127/307": {
          url: `http://127.0.0.1:${port}/`,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    },
  });
  return {
    sdk,
    bytes,
    cacheDir,
    controller,
    requests: () => requests,
    clean: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(cacheDir, { recursive: true, force: true });
    },
  };
}
test("progress reports committed bytes and cache removal leaves unrelated files", async () => {
  const f = await setup();
  try {
    const events: DownloadProgress[] = [];
    const plan = await f.sdk.plan({ points: [point] });
    await f.sdk.download(plan, { onProgress: (e) => events.push(e) });
    assert.deepEqual(events, [
      {
        tileId: "127/307",
        completedTiles: 1,
        totalTiles: 1,
        downloadedBytes: f.bytes.length,
      },
    ]);
    await f.sdk.download(plan, { onProgress: (e) => events.push(e) });
    assert.equal(events.length, 1);
    assert.equal(f.requests(), 1);
    assert.equal((await f.sdk.cacheStatus()).totalBytes, f.bytes.length);
    await writeFile(join(f.cacheDir, "unrelated.txt"), "keep");
    await f.sdk.removeTiles(["127/307"]);
    assert.equal((await f.sdk.cacheStatus()).totalBytes, 0);
    assert.equal(
      await readFile(join(f.cacheDir, "unrelated.txt"), "utf8"),
      "keep",
    );
    await assert.rejects(f.sdk.getElevation(point), MissingTileError);
  } finally {
    await f.clean();
  }
});
test("cancelled stream does not publish a partial tile", async () => {
  const f = await setup("abort");
  try {
    const plan = await f.sdk.plan({ points: [point] });
    await assert.rejects(f.sdk.download(plan, { signal: f.controller.signal }));
    assert.equal(f.requests(), 1);
    assert.deepEqual(await readdir(f.cacheDir), []);
  } finally {
    await f.clean();
  }
});
test("oversized payload is rejected before cache commit", async () => {
  const f = await setup("oversize");
  try {
    await assert.rejects(
      f.sdk.download(await f.sdk.plan({ points: [point] })),
      /byte limit/,
    );
    assert.deepEqual(await readdir(f.cacheDir), []);
  } finally {
    await f.clean();
  }
});
