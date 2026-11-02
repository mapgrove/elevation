# MapGrove Elevation

**Download elevation data once. Query it offline.**

An experimental Node.js SDK and CLI for point elevations and sampled route profiles. No API key or MapGrove server is required for global source downloads.

## Quick start

Requires Node.js 24+, pnpm 11.25.0. The package is not published on npm.

```sh
git clone https://github.com/mapgrove/elevation.git
cd elevation
pnpm install --frozen-lockfile
pnpm build

# First run: explicitly download the required source data.
pnpm cli point --latitude=51.5074 --longitude=-0.1278 --prepare

# Subsequent runs: cache-only lookup, with no network calls.
pnpm cli point --latitude=51.5074 --longitude=-0.1278
```

Output contains heights in meters relative to EGM2008. Global data describes the surface, including buildings and vegetation; horizontal sampling is not a vertical accuracy guarantee.

## Public small-grid examples

```sh
# Download only selected packed payloads for five short example routes.
node examples/published.ts --dataset=south-korea --prepare
# Repeat with all network access blocked inside the example.
node examples/published.ts --dataset=south-korea
# Nine staged world samples, including 78°N and the date line.
node examples/published.ts --dataset=world-stage --prepare
node examples/published.ts --dataset=world-stage
```

The South Korea envelope release contains 3,519 built cells; 981 selected cells are unavailable and 224 built cells have missing nodes. It is not an administrative land-completeness certification. [Coverage, measured bytes and release links](docs/COVERAGE.md).

## Routes and cache

```sh
pnpm cli plan --file=examples/route.json --spacing=90
pnpm cli profile --file=examples/route.json --spacing=90 --prepare
pnpm cli profile --file=examples/route.json --spacing=90
pnpm cli cache
```

`--spacing` inserts samples between supplied waypoints. Route JSON uses `{ latitude, longitude }` objects. Without `--prepare`, lookups never fetch missing data. Successful CLI results are JSON; progress and errors go to stderr.

## SDK

After building, use the compiled ESM exports from your checkout:

```js
import { createGlobalTerrain, loadGlobalCatalog } from './dist/global.js';
import { sampleRoute } from './dist/index.js';

const terrain = createGlobalTerrain({
  catalog: await loadGlobalCatalog(),
  cacheDir: '.cache/elevation',
});
const points = sampleRoute([
  { latitude: 51.5074, longitude: -0.1278 },
  { latitude: 51.5100, longitude: -0.1200 },
], { spacingMeters: 90 });

const plan = await terrain.plan({ points });
await terrain.download(plan, {
  onProgress: ({ completedTiles, totalTiles }) => console.log(completedTiles, totalTiles),
});
const profile = await terrain.getProfile(points); // Offline; reuses tiles within this call.
```

Downloads support cancellation. Both SDK modes expose verified cache status and explicit tile removal. The intended installed names are `@mapgrove/elevation` and `@mapgrove/elevation/global` after a future release.

## Choose a data mode

| | Global source mode | Regional small-tile mode |
|---|---|---|
| Factory | `createGlobalTerrain` | `createTerrain` |
| Availability | 26,475 cataloged GLO-90 source files | South Korea envelope alpha + nine world sample cells |
| First download | Whole one-degree COGs; several MB in measured samples | Only selected small compressed tiles |
| Heights | Nearest native sample | Bilinear interpolation |
| Download estimate | Unknown (`null`) until fetched | Exact missing payload bytes |
| Hosting | Existing public AWS source | Public experimental GitHub Releases with exact byte ranges |

Complete worldwide small-tile coverage, browser/mobile runtimes, GPX import, automatic cache eviction and cumulative ascent/descent are not implemented. No global preprocessing job is running in the background.

## Documentation

- [Usage guide](docs/USAGE.md): installation, SDK, CLI, cancellation, cache management and errors.
- [Coverage and releases](docs/COVERAGE.md): nationwide-envelope validation and staged world samples.
- [Area planning and delivery](docs/DELIVERY.md): bounding boxes, route corridors and exact packed range downloads.
- [Tile pipeline](docs/PIPELINE.md): resumable area builds, source provenance and coverage reports.
- [Global mode](docs/GLOBAL.md): coverage, offline verification and storage calculations.
- [Resolution benchmark](docs/BENCHMARK.md): measured 90 m / 30 m regional payload sizes.
- [Data format](docs/DATA.md), [versioned output grid](docs/GRID_V1.md), and [product direction](docs/PRODUCT.md).

## Development

```sh
pnpm check          # Type checking, tests and JavaScript/declaration build
pnpm format:check
pnpm demo           # Synthetic correctness demo
pnpm demo:regional  # Real regional data, local download server, then offline
pnpm demo:global    # Real network downloads for six example locations
pnpm demo:global -- --offline
```

CI runs local deterministic tests and demos. It does not download global source data. Package builds do not publish anything.

## License and data attribution

The repository is public; the npm package is unpublished. No software license has been selected yet, so public visibility does not grant a software reuse license. Copernicus data retains its own attribution, redistribution and liability terms: [global notice](data/global/NOTICE.md), [regional notice](data/seoul-90m/NOTICE.md).
