import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fetchBytes, type DownloadOptions } from "./download.ts";
export type { DownloadOptions, DownloadProgress } from "./download.ts";
export { sampleRoute, distanceMeters } from "./route.ts";
import {
  tileFor,
  validateGridManifest,
  type Point,
  type VersionedGridFields,
} from "./grid.ts";
export {
  GRID_V1,
  gridCellFor,
  gridCellBounds,
  gridNode,
  tileFor,
} from "./grid.ts";
export type { Point, VersionedGridFields } from "./grid.ts";
import { cellsForArea, type AreaSelection } from "./area.ts";
export { cellsForBounds, cellsForArea, SOUTH_KOREA_ENVELOPE } from "./area.ts";
export type { Bounds, AreaSelection } from "./area.ts";
export type Asset = {
  url: string;
  bytes: number;
  sha256: string;
  range?: { offset: number; totalBytes: number };
};
export type AreaPlan = Plan & {
  requestedTileIds: string[];
  unavailableTileIds: string[];
};
export type Manifest = VersionedGridFields & {
  version: string;
  attribution: string;
  verticalDatum: string;
  tilesPerDegree?: number;
  encoding?: "json" | "float32-gzip-v1";
  tiles: Record<string, Asset>;
};
export type Plan = {
  tileIds: string[];
  missingTileIds: string[];
  downloadBytes: number;
};
export class MissingTileError extends Error {}
export class NoDataError extends Error {}
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export function createTerrain(options: {
  manifest: Manifest;
  cacheDir: string;
}) {
  const manifest = structuredClone(options.manifest);
  const expectedDimension = validateGridManifest(manifest);
  const tilesPerDegree = manifest.tilesPerDegree ?? 1;
  tileFor({ latitude: 0, longitude: 0 }, tilesPerDegree);
  if (
    manifest.encoding &&
    !["json", "float32-gzip-v1"].includes(manifest.encoding)
  )
    throw new Error("Unsupported encoding");
  for (const a of Object.values(manifest.tiles)) {
    if (
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      !Number.isSafeInteger(a.bytes) ||
      a.bytes <= 0
    )
      throw new Error("Invalid asset metadata");
    if (
      a.range &&
      (!Number.isSafeInteger(a.range.offset) ||
        a.range.offset < 0 ||
        !Number.isSafeInteger(a.range.totalBytes) ||
        a.range.totalBytes < a.range.offset + a.bytes ||
        !Number.isSafeInteger(a.range.offset + a.bytes))
    )
      throw new Error("Invalid asset range");
    const u = new URL(a.url);
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      )
    )
      throw new Error("HTTPS required");
  }
  function asset(id: string) {
    const a = manifest.tiles[id];
    if (!a) throw new MissingTileError(`No coverage: ${id}`);
    return a;
  }
  const path = (id: string) =>
    join(options.cacheDir, `${asset(id).sha256}.json`);
  function decode(
    b: Uint8Array,
    id: string,
  ): { id: string; width: number; height: number; values: (number | null)[] } {
    const a = asset(id);
    if (b.byteLength !== a.bytes || hash(b) !== a.sha256)
      throw new Error(`Integrity check failed: ${id}`);
    let t;
    if (manifest.encoding === "float32-gzip-v1") {
      const raw = gunzipSync(b, { maxOutputLength: 64 * 1024 * 1024 });
      if (raw.length < 20 || raw.toString("ascii", 0, 4) !== "OEL1")
        throw new Error(`Invalid binary tile: ${id}`);
      const width = raw.readUInt32LE(4),
        height = raw.readUInt32LE(8);
      const tileId = `${raw.readUInt32LE(12)}/${raw.readUInt32LE(16)}`;
      if (raw.length !== 20 + width * height * 4)
        throw new Error(`Invalid binary length: ${id}`);
      const values = Array.from({ length: width * height }, (_, i) => {
        const v = raw.readFloatLE(20 + i * 4);
        return Number.isNaN(v) ? null : v;
      });
      t = { id: tileId, width, height, values };
    } else t = JSON.parse(new TextDecoder().decode(b));
    if (
      t.id !== id ||
      !Number.isSafeInteger(t.width) ||
      !Number.isSafeInteger(t.height) ||
      t.width < 2 ||
      t.height < 2 ||
      !Array.isArray(t.values) ||
      t.values.length !== t.width * t.height ||
      !t.values.every(
        (v: unknown) =>
          v === null || (typeof v === "number" && Number.isFinite(v)),
      )
    )
      throw new Error(`Invalid tile: ${id}`);
    if (
      expectedDimension &&
      (t.width !== expectedDimension || t.height !== expectedDimension)
    )
      throw new Error(
        `Tile dimensions conflict with declared grid sample spacing: ${id}`,
      );
    return t;
  }
  async function cached(id: string) {
    let b: Buffer;
    try {
      b = await readFile(path(id));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    return decode(b, id);
  }
  async function plan({ points }: { points: Point[] }): Promise<Plan> {
    const tileIds = [
        ...new Set(points.map((p) => tileFor(p, tilesPerDegree).id)),
      ].sort(),
      missingTileIds: string[] = [];
    let downloadBytes = 0;
    for (const id of tileIds)
      if (!(await cached(id))) {
        missingTileIds.push(id);
        downloadBytes += asset(id).bytes;
      }
    return { tileIds, missingTileIds, downloadBytes };
  }
  async function planArea(selection: AreaSelection): Promise<AreaPlan> {
    if (manifest.schemaVersion !== 1)
      throw new Error("Area planning requires grid v1");
    const requestedTileIds = cellsForArea(selection);
    const tileIds = requestedTileIds.filter((id) => manifest.tiles[id]);
    const unavailableTileIds = requestedTileIds.filter(
      (id) => !manifest.tiles[id],
    );
    const missingTileIds: string[] = [];
    let downloadBytes = 0;
    for (const id of tileIds)
      if (!(await cached(id))) {
        missingTileIds.push(id);
        downloadBytes += asset(id).bytes;
      }
    return {
      requestedTileIds,
      unavailableTileIds,
      tileIds,
      missingTileIds,
      downloadBytes,
    };
  }
  async function download(p: Plan, downloadOptions: DownloadOptions = {}) {
    downloadOptions.signal?.throwIfAborted();
    let completedTiles = 0,
      downloadedBytes = 0;
    const tileIds = [...new Set(p.tileIds)];
    let totalTiles = 0;
    for (const id of tileIds) if (!(await cached(id))) totalTiles++;
    await mkdir(options.cacheDir, { recursive: true });
    for (const id of tileIds) {
      downloadOptions.signal?.throwIfAborted();
      if (await cached(id)) continue;
      const b = await fetchBytes(asset(id).url, {
        signal: downloadOptions.signal,
        maxBytes: asset(id).bytes,
        timeoutMs: 120_000,
        range: asset(id).range,
      });
      decode(b, id);
      const temp = `${path(id)}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, b, { flag: "wx" });
        await rename(temp, path(id));
      } finally {
        await unlink(temp).catch(() => {});
      }
      completedTiles++;
      downloadedBytes += b.byteLength;
      downloadOptions.onProgress?.({
        tileId: id,
        completedTiles,
        totalTiles,
        downloadedBytes,
      });
    }
    return { requests: completedTiles, downloadedBytes, completedTiles };
  }
  type Tile = NonNullable<Awaited<ReturnType<typeof cached>>>;
  async function getElevation(p: Point, profileCache?: Map<string, Tile>) {
    const c = tileFor(p, tilesPerDegree);
    const t = profileCache?.get(c.id) ?? (await cached(c.id));
    if (t && profileCache) {
      profileCache.delete(c.id);
      profileCache.set(c.id, t);
      if (profileCache.size > 8)
        profileCache.delete(profileCache.keys().next().value!);
    }
    if (!t) throw new MissingTileError(`Download required: ${c.id}`);
    const x = Math.max(
        0,
        Math.min(
          t.width - 1,
          (c.longitude - c.west) * tilesPerDegree * (t.width - 1),
        ),
      ),
      y = Math.max(
        0,
        Math.min(
          t.height - 1,
          (p.latitude - c.south) * tilesPerDegree * (t.height - 1),
        ),
      );
    const i = Math.min(Math.floor(x), t.width - 2),
      j = Math.min(Math.floor(y), t.height - 2),
      dx = x - i,
      dy = y - j;
    let result = 0;
    for (const [offset, weight] of [
      [0, (1 - dx) * (1 - dy)],
      [1, dx * (1 - dy)],
      [t.width, (1 - dx) * dy],
      [t.width + 1, dx * dy],
    ]) {
      if (!weight) continue;
      const value = t.values[j * t.width + i + offset];
      if (value === null) throw new NoDataError("No elevation sample");
      result += value * weight;
    }
    return result;
  }
  async function getProfile(points: Point[]) {
    const profile: { point: Point; elevation: number }[] = [];
    const profileCache = new Map<string, Tile>();
    for (const point of points)
      profile.push({
        point,
        elevation: await getElevation(point, profileCache),
      });
    return profile;
  }
  async function cacheStatus() {
    const tiles: { tileId: string; bytes: number }[] = [];
    for (const id of Object.keys(manifest.tiles))
      if (await cached(id)) tiles.push({ tileId: id, bytes: asset(id).bytes });
    return { tiles, totalBytes: tiles.reduce((sum, t) => sum + t.bytes, 0) };
  }
  async function removeTiles(ids: string[]) {
    const unique = [...new Set(ids)];
    for (const id of unique) asset(id);
    for (const id of unique)
      await unlink(path(id)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
  return {
    plan,
    planArea,
    download,
    getElevation: (p: Point) => getElevation(p),
    getProfile,
    cacheStatus,
    removeTiles,
  };
}
