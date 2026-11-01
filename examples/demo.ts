import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTerrain } from '../src/index.ts';
const bytes = Buffer.from(JSON.stringify({ id: '127/307', width: 2, height: 2, values: [0, 10, 20, 30] }));
const server = createServer((_req, res) => res.end(bytes));
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const { port } = server.address() as { port: number };
const cacheDir = await mkdtemp(join(tmpdir(), 'elevation-demo-'));
try {
  const sdk = createTerrain({ cacheDir, manifest: { version: 'synthetic-v1', attribution: 'Synthetic demo', verticalDatum: 'Synthetic', tiles: { '127/307': { url: `http://127.0.0.1:${port}/tile`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } } });
  const points = [{ latitude: 37.25, longitude: 127.25 }, { latitude: 37.5, longitude: 127.5 }];
  const plan = await sdk.plan({ points });
  console.log('SYNTHETIC DATA — not real terrain. Download plan:', plan);
  await sdk.download(plan);
  await new Promise<void>(r => server.close(() => r()));
  console.log('Server stopped. Offline profile:', await sdk.getProfile(points));
  console.log('Additional download bytes:', (await sdk.plan({ points })).downloadBytes);
} finally {
  if (server.listening) await new Promise<void>(r => server.close(() => r()));
  await rm(cacheDir, { recursive: true, force: true });
}
