// Real data, local distribution simulation. No GitHub credentials required.
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerrain } from "../src/index.ts";
const root = new URL("../data/seoul-90m/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
const references = JSON.parse(
  await readFile(new URL("references.json", root), "utf8"),
).samples;
const blobs = new Map<string, Buffer>();
for (const id of Object.keys(manifest.tiles))
  blobs.set(
    `/${id.replace("/", "-")}.oel.gz`,
    await readFile(new URL(`${id.replace("/", "-")}.oel.gz`, root)),
  );
const server = createServer((req, res) => {
  const b = blobs.get(req.url!);
  if (b) res.end(b);
  else res.writeHead(404).end();
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address() as { port: number };
const cacheDir = await mkdtemp(join(tmpdir(), "regional-demo-"));
try {
  for (const [id, a] of Object.entries(manifest.tiles))
    (a as { url: string }).url =
      `http://127.0.0.1:${port}/${id.replace("/", "-")}.oel.gz`;
  const sdk = createTerrain({ manifest, cacheDir });
  const points = references.map((r: any) => r.point);
  const plan = await sdk.plan({ points });
  console.log(
    "Real Copernicus GLO-90 surface heights; synthetic straight-line route.",
  );
  console.log("Download plan:", plan);
  await sdk.download(plan);
  await new Promise<void>((r) => server.close(() => r()));
  const profile = await createTerrain({ manifest, cacheDir }).getProfile(
    points,
  );
  console.log("Server stopped. Offline samples:", profile.length);
  console.log("First and last:", profile[0], profile.at(-1));
  console.log(
    "Maximum source-raster difference (meters):",
    Math.max(
      ...profile.map((p, i) => Math.abs(p.elevation - references[i].elevation)),
    ),
  );
  console.log(
    "Additional download bytes:",
    (await sdk.plan({ points })).downloadBytes,
  );
  console.log(manifest.attribution);
} finally {
  if (server.listening) await new Promise<void>((r) => server.close(() => r()));
  await rm(cacheDir, { recursive: true, force: true });
}
