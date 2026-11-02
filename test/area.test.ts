import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cellsForBounds,
  cellsForArea,
  gridCellFor,
  gridCellBounds,
  createTerrain,
  type Manifest,
  SOUTH_KOREA_ENVELOPE,
} from "../src/index.ts";

test("AOI bounds use half-open grid edges, date-line spans and allocation limits", () => {
  assert.deepEqual(
    cellsForBounds({ west: 127, south: 37.5, east: 127.1, north: 37.6 }),
    ["1275/3070"],
  );
  assert.deepEqual(
    cellsForBounds({ west: 179.9, south: 0, east: -179.9, north: 0.1 }),
    ["900/3599", "900/0"],
  );
  assert.equal(cellsForBounds(SOUTH_KOREA_ENVELOPE).length, 4500);
  assert.throws(
    () => cellsForBounds({ west: -180, south: -90, east: 180, north: 90 }),
    /maxCells/,
  );
  assert.throws(() => cellsForBounds({ west: 0, south: 0, east: 0, north: 1 }));
  assert.throws(() => cellsForArea({ cells: ["00/0"] }));
});
test("sampled route envelopes include intermediate cells, corridor and date line", () => {
  const route = [
    { latitude: 37.55, longitude: 127.05 },
    { latitude: 37.55, longitude: 127.35 },
  ];
  const ids = cellsForArea({ route });
  for (const lon of [127.05, 127.15, 127.25, 127.35])
    assert.ok(
      ids.includes(gridCellFor({ latitude: 37.55, longitude: lon }).id),
    );
  assert.ok(cellsForArea({ route, corridorMeters: 12000 }).length > ids.length);
  const date = cellsForArea({
    route: [
      { latitude: 0.05, longitude: 179.95 },
      { latitude: 0.05, longitude: -179.95 },
    ],
  });
  assert.deepEqual(date, ["900/0", "900/3599"]);
  assert.deepEqual(cellsForArea({ cells: ["900/0", "900/0"] }), ["900/0"]);
  assert.throws(() => cellsForArea({ route, corridorMeters: -1 }));
});

test("area plans show gaps; packed range download transfers one small cell and remains offline", async () => {
  const original = JSON.parse(
    await readFile(
      new URL("../data/seoul-90m/manifest.json", import.meta.url),
      "utf8",
    ),
  ) as Manifest;
  const [id, a] = Object.entries(original.tiles)[0];
  const file = new URL(
    `../data/seoul-90m/${new URL(a.url).pathname.split("/").pop()}`,
    import.meta.url,
  );
  const data = await readFile(file);
  const prefix = Buffer.alloc(5000, 8),
    suffix = Buffer.alloc(100000, 9);
  const packed = Buffer.concat([prefix, data, suffix]);
  let requests = 0,
    transferred = 0,
    mode = "range";
  const server = createServer((req, res) => {
    requests++;
    if (mode === "ignore") {
      res.writeHead(200);
      res.end(packed);
      return;
    }
    const end = prefix.length + data.length - 1;
    assert.equal(req.headers.range, `bytes=${prefix.length}-${end}`);
    res.writeHead(206, {
      "Content-Range": `bytes ${prefix.length}-${end}/${mode === "bad" ? packed.length + 1 : packed.length}`,
      "Content-Length": data.length,
    });
    transferred += data.length;
    res.end(data);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const cacheDir = await mkdtemp(join(tmpdir(), "area-test-"));
  const manifest: Manifest = {
    ...original,
    tiles: {
      [id]: {
        ...a,
        url: `http://127.0.0.1:${port}/pack`,
        range: { offset: prefix.length, totalBytes: packed.length },
      },
    },
  };
  const sdk = createTerrain({ manifest, cacheDir });
  try {
    const plan = await sdk.planArea({ cells: [id, "0/0"] });
    assert.deepEqual(plan.unavailableTileIds, ["0/0"]);
    assert.equal(plan.downloadBytes, data.length);
    const result = await sdk.download(plan);
    assert.deepEqual(result, {
      requests: 1,
      downloadedBytes: data.length,
      completedTiles: 1,
    });
    assert.equal(transferred, data.length);
    assert.ok(transferred < packed.length);
    assert.equal((await sdk.planArea({ cells: [id] })).downloadBytes, 0);
    assert.equal((await sdk.download(plan)).requests, 0);
    assert.equal(requests, 1);
    const bounds = gridCellBounds(id);
    assert.ok(
      Number.isFinite(
        await sdk.getElevation({
          latitude: (bounds.south + bounds.north) / 2,
          longitude: (bounds.west + bounds.east) / 2,
        }),
      ),
    );
    assert.equal(requests, 1);
    await sdk.removeTiles([id]);
    mode = "ignore";
    await assert.rejects(sdk.download(plan), /exact byte range/);
    assert.deepEqual(await readdir(cacheDir), []);
    mode = "bad";
    await assert.rejects(sdk.download(plan), /exact byte range/);
    assert.deepEqual(await readdir(cacheDir), []);
    assert.throws(
      () =>
        createTerrain({
          cacheDir,
          manifest: {
            ...manifest,
            tiles: {
              [id]: {
                ...manifest.tiles[id],
                range: { offset: -1, totalBytes: packed.length },
              },
            },
          },
        }),
      /range/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(cacheDir, { recursive: true, force: true });
  }
});
