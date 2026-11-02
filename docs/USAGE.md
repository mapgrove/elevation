# Usage guide

MapGrove Elevation is a Node.js 24+ library and command-line tool. The repository is public and the package is unpublished; do not run `npm install @mapgrove/elevation` from the public registry yet. Browser and native mobile runtimes are not supported in this alpha.

## 1. Install from the repository

You need Git and pnpm 11.25.0.

```sh
git clone https://github.com/mapgrove/elevation.git
cd elevation
pnpm install --frozen-lockfile
pnpm build
pnpm cli --help
```

The build produces JavaScript and TypeScript declarations in `dist/`. Source examples run directly in Node.js 24; applications can use the compiled exports. The project has no publishing step in CI.

## 2. First real lookup

Allow the initial download explicitly:

```sh
pnpm cli point --latitude=51.5074 --longitude=-0.1278 --prepare
```

This downloads the needed GLO-90 source tile from the public AWS bucket, writes it to `.cache/mapgrove`, and returns JSON with `verticalDatum`, `units`, `sampling` and `samples`. Progress is printed on stderr.

Repeat without `--prepare` to read offline:

```sh
pnpm cli point --latitude=51.5074 --longitude=-0.1278
```

The lookup does not silently download missing data. Use `--cache=/your/path` to share a persistent cache between runs. Global source tiles can be several MB; the SDK does not need an API key or our own server.

## 3. Prepare and query a route

The included `examples/route.json` is a two-point synthetic London line, not a recorded walking route. A route file is a JSON array of `{ "latitude": number, "longitude": number }` objects.

```sh
# List required tiles; performs no network calls.
pnpm cli plan --file=examples/route.json --spacing=90

# Download missing sources and produce the sampled profile.
pnpm cli profile --file=examples/route.json --spacing=90 --prepare

# Repeat with no network preparation.
pnpm cli profile --file=examples/route.json --spacing=90

# Show verified cached source tiles and their total raster bytes.
pnpm cli cache
```

A route's endpoints do not describe every tile it passes through. `--spacing=90` inserts spherical great-circle samples at most 90 meters apart. This follows straight great-circle segments, not roads or trails. Supply the actual route geometry. The sampler retains waypoints, takes the short antimeridian crossing and refuses antipodal segments without an intermediate waypoint. The maximum result is 100,000 points by default.

The CLI uses global nearest-native sampling. Additional route samples do not improve source resolution or remove surface-height noise. The SDK does not calculate cumulative ascent/descent yet.

## 4. Use the SDK in an application

After building the checkout, this example can be saved at the repository root as an `.mjs` file:

```js
import { createGlobalTerrain, loadGlobalCatalog } from './dist/global.js';
import { sampleRoute } from './dist/index.js';

const terrain = createGlobalTerrain({
  catalog: await loadGlobalCatalog(),
  cacheDir: '.cache/my-app',
});
const points = sampleRoute([
  { latitude: 51.5074, longitude: -0.1278 },
  { latitude: 51.5100, longitude: -0.1200 },
], { spacingMeters: 90 });

const plan = await terrain.plan({ points });
console.log('Missing source tiles:', plan.missingTileIds.length);
console.log('Unavailable source tiles:', plan.unavailableTileIds);
// Global downloadBytes is null: the catalog does not contain byte sizes.

const controller = new AbortController();
await terrain.download(plan, {
  signal: controller.signal,
  onProgress(event) {
    console.log(event.completedTiles, event.totalTiles, event.downloadedBytes);
  },
});
const profile = await terrain.getProfile(points); // Cache only.
console.log(profile);
```

`getProfile` reuses parsed tiles and decoded source blocks within that call, with a bounded tile count. It drops the session afterward so later queries still verify disk integrity. This is a tile-count bound, not a fixed-byte memory budget. For multiple route points, prefer one `getProfile` call over a loop of `getElevation` calls.

The eventual installed import paths are `@mapgrove/elevation` and `@mapgrove/elevation/global`. Local compiled paths work before publication. Only ESM is currently exported; CommonJS `require` is not supported.

## 5. Cache management

Both regional and global SDK instances offer:

```js
const status = await terrain.cacheStatus();
console.log(status.totalBytes, status.tiles);

// Explicitly remove known tile IDs; unrelated files are not deleted.
await terrain.removeTiles(status.tiles.map(tile => tile.tileId));
```

Global `totalBytes` counts raster COG bytes, excluding small metadata sidecars. Regional counts include the compressed payloads. Status validates checksums; a corrupt entry raises an error rather than appearing healthy. If an entry is corrupt, remove its known ID and download it again. Removal invalidates disk files; an in-flight profile may still finish using its session's already-loaded tiles. There is no automatic disk eviction or background download.

## 6. Errors, progress and cancellation

```js
import { MissingTileError, NoDataError } from './dist/index.js';

try {
  console.log(await terrain.getElevation({ latitude: 51.5074, longitude: -0.1278 }));
} catch (error) {
  if (error instanceof MissingTileError) {
    // Missing download or no catalog coverage; plan and inspect before retrying.
  } else if (error instanceof NoDataError) {
    // A raster exists, but this location has no supported elevation sample.
  } else {
    throw error;
  }
}
```

- Invalid coordinates and sampler options raise `RangeError`.
- HTTP failures, corrupted files and malformed rasters raise errors with diagnostic messages.
- Downloads accept an `AbortSignal`; abort rejection is propagated. In the CLI, Ctrl+C cancels an active preparation.
- Progress fires after each newly downloaded tile is verified and committed, not for cache hits. Bytes are cumulative completed bytes for that call. A user callback that throws interrupts the call after that completed tile has been saved.
- Completed tiles remain cached after cancellation or failure; incomplete payloads are not published. A regional response is capped at its manifest size; global responses are capped at 64 MiB per source file.
- Missing data is never silently converted to zero. An absent ocean tile is still a coverage error in this alpha.

## Regional mode

`createTerrain({ manifest, cacheDir })` is for small, preprocessed tiles. Its `plan` returns exact missing payload bytes and `getElevation` interpolates bilinearly. Global mode uses larger upstream source files and nearest-native samples. These modes are deliberately explicit.

```sh
pnpm demo:regional
```

The regional demo has its own local HTTP server and cleans up its temporary cache. Its manifest contains reserved release URLs, not a live hosted download service. Do not copy those URLs into a production app. See [data contract](DATA.md), [global mode](GLOBAL.md) and [dataset notices](../data/global/NOTICE.md).

## Published small-grid alpha

See [coverage and public examples](COVERAGE.md) for the South Korea surrounding envelope and nine world sample cells, and [area planning](DELIVERY.md) for bounding boxes, explicit cells and conservative route corridors. `node examples/published.ts --dataset=south-korea --prepare` performs an explicit public download; omit `--prepare` for network-blocked persistent-cache queries. These examples need no GitHub credentials.
