# Offline Elevation

Download only the elevation tiles you need, then query them offline.

**Status: experimental Node.js alpha.** Global source mode accesses the public Copernicus GLO-90 catalog and caches selected original COGs. Small preprocessed tiles are currently available only for the included Seoul-area regional sample. No worldwide small-tile release is hosted.

## Why

Route applications should be able to prepare a region once and query elevations without an API key, a running application server, or a network connection. File hosting is still required for initial downloads.

## Run locally

Requires Node.js 24+. Install dependencies with pnpm 11.25.0; a lockfile is included.

```sh
pnpm install --frozen-lockfile
npm test
npm run demo
npm run demo:regional
```

## Global access

Run `npm run demo:global` to download source tiles for six points across six continents, then `npm run demo:global -- --offline` to verify cache-only reuse. This mode downloads full one-degree source files and uses nearest native samples; its downloads are larger than the small-tile regional mode. See [global behavior, size calculations and limitations](docs/GLOBAL.md).

## Regional workflow

```ts
import { createTerrain } from './src/index.ts';

const terrain = createTerrain({ manifest, cacheDir: '.cache/elevation' });
const plan = await terrain.plan({ points: route });
console.log(plan.downloadBytes);
await terrain.download(plan);
const profile = await terrain.getProfile(route); // Cache-only; never fetches.
```

Points use `{ latitude, longitude }`. Planning selects tiles containing the supplied points. Callers must densify route segments before planning if they need samples between vertices. A missing tile throws `MissingTileError`; missing data throws `NoDataError`. Neither becomes zero elevation.

## Current prototype

- Configurable geographic grid; global addressing, regional availability.
- Compressed Float32 binary tiles and a real nine-tile Seoul-area sample.
- Exact sample-point tile planning, download size estimate, SHA-256 verification.
- Disk cache with atomic replacement and integrity checks.
- Bilinear interpolation and cache-only point/profile queries.
- Dependency-free synthetic demo and tests using a local HTTP server.

The regional sample uses 0.1° tiles at nominal 90 m sampling. One-degree JSON is retained for synthetic fixtures. See the [measured 90 m / 30 m comparison](docs/BENCHMARK.md) and [data notice](data/seoul-90m/NOTICE.md). The regional demo serves files locally, downloads selected tiles, stops the server and verifies cache-only results against source-raster samples. These are not independent ground-truth checks.

## Next milestones

1. Extend regional byte-size benchmarks to real GPX routes, other terrain and request latency.
2. Select a production tile size and compare existing storage formats.
3. Add GPX profile visualization and regional source stitching.
4. Compare direct COG range reads and small-tile distribution before choosing global hosting.
5. Add browser storage, bounded cache management and download progress.

See [product direction](docs/PRODUCT.md) and [data contract](docs/DATA.md).

## Distribution and license

The package is private and unpublished. A software license must be selected before public release; upstream terrain data will retain its own attribution and redistribution requirements. The GitHub repository is private. Real sample data retains the Copernicus terms and notices in `data/seoul-90m/NOTICE.md`.
