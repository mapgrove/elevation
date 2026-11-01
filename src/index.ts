import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export type Point = { latitude: number; longitude: number };
export type Asset = { url: string; bytes: number; sha256: string };
export type Manifest = { version: string; attribution: string; verticalDatum: string; tiles: Record<string, Asset> };
export type Plan = { tileIds: string[]; missingTileIds: string[]; downloadBytes: number };
export class MissingTileError extends Error {}
export class NoDataError extends Error {}
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export function tileFor(p: Point) {
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180) throw new RangeError('Invalid geographic coordinates');
  const lon = p.longitude === 180 ? -180 : p.longitude;
  const row = Math.min(179, Math.floor(p.latitude + 90)), col = Math.floor(lon + 180);
  return { id: `${row}/${col}`, south: row - 90, west: col - 180, longitude: lon };
}
export function createTerrain(options: { manifest: Manifest; cacheDir: string }) {
  const manifest = structuredClone(options.manifest);
  for (const a of Object.values(manifest.tiles)) {
    if (!/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes <= 0) throw new Error('Invalid asset metadata');
    const u = new URL(a.url);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) throw new Error('HTTPS required');
  }
  function asset(id: string) { const a = manifest.tiles[id]; if (!a) throw new MissingTileError(`No coverage: ${id}`); return a; }
  const path = (id: string) => join(options.cacheDir, `${asset(id).sha256}.json`);
  function decode(b: Uint8Array, id: string): { id: string; width: number; height: number; values: (number | null)[] } {
    const a = asset(id);
    if (b.byteLength !== a.bytes || hash(b) !== a.sha256) throw new Error(`Integrity check failed: ${id}`);
    const t = JSON.parse(new TextDecoder().decode(b));
    if (t.id !== id || !Number.isSafeInteger(t.width) || !Number.isSafeInteger(t.height) || t.width < 2 || t.height < 2 || !Array.isArray(t.values) || t.values.length !== t.width * t.height || !t.values.every((v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v)))) throw new Error(`Invalid tile: ${id}`);
    return t;
  }
  async function cached(id: string) {
    let b: Buffer;
    try { b = await readFile(path(id)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    return decode(b, id);
  }
  async function plan({ points }: { points: Point[] }): Promise<Plan> {
    const tileIds = [...new Set(points.map(p => tileFor(p).id))].sort(), missingTileIds: string[] = [];
    let downloadBytes = 0;
    for (const id of tileIds) if (!(await cached(id))) { missingTileIds.push(id); downloadBytes += asset(id).bytes; }
    return { tileIds, missingTileIds, downloadBytes };
  }
  async function download(p: Plan) {
    await mkdir(options.cacheDir, { recursive: true });
    for (const id of p.tileIds) {
      if (await cached(id)) continue;
      const res = await fetch(asset(id).url);
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      const b = new Uint8Array(await res.arrayBuffer()); decode(b, id);
      const temp = `${path(id)}.${randomUUID()}.tmp`;
      try { await writeFile(temp, b, { flag: 'wx' }); await rename(temp, path(id)); }
      finally { await unlink(temp).catch(() => {}); }
    }
  }
  async function getElevation(p: Point) {
    const c = tileFor(p), t = await cached(c.id);
    if (!t) throw new MissingTileError(`Download required: ${c.id}`);
    const x = (c.longitude - c.west) * (t.width - 1), y = (p.latitude - c.south) * (t.height - 1);
    const i = Math.min(Math.floor(x), t.width - 2), j = Math.min(Math.floor(y), t.height - 2), dx = x - i, dy = y - j;
    let result = 0;
    for (const [offset, weight] of [[0, (1-dx)*(1-dy)], [1, dx*(1-dy)], [t.width, (1-dx)*dy], [t.width+1, dx*dy]]) {
      if (!weight) continue;
      const value = t.values[j*t.width+i+offset];
      if (value === null) throw new NoDataError('No elevation sample');
      result += value * weight;
    }
    return result;
  }
  async function getProfile(points: Point[]) {
    const profile: { point: Point; elevation: number }[] = [];
    for (const point of points) profile.push({ point, elevation: await getElevation(point) });
    return profile;
  }
  return { plan, download, getElevation, getProfile };
}
