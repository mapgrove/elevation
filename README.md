# Offline Elevation

Download only the elevation tiles you need, then query them offline.

**Status: experimental Node.js prototype.** No real terrain dataset is distributed yet. The demo and tests use synthetic heights, which must not be used for navigation or analysis.

## Why

Route applications should be able to prepare a region once and query elevations without an API key, a running application server, or a network connection. File hosting is still required for initial downloads.

## Run locally

Requires Node.js 24+. No dependencies or package installation required.

```sh
npm test
npm run demo
```

## Proposed workflow

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

- One-degree geographic tiles; global addressing, regional availability.
- Exact sample-point tile planning, download size estimate, SHA-256 verification.
- Disk cache with atomic replacement and integrity checks.
- Bilinear interpolation and cache-only point/profile queries.
- Dependency-free synthetic demo and tests using a local HTTP server.

The one-degree grid and JSON format are provisional correctness fixtures, not a production storage decision. Production work must benchmark smaller binary tiles and existing geographic formats before freezing the layout.

## Next milestones

1. Select a redistributable dataset and document license, vertical datum, coverage and resolution.
2. Benchmark tile sizes and encodings on representative routes.
3. Add regional fixture data and a GPX elevation-profile demo.
4. Verify GitHub Releases distribution, including browser CORS and service constraints.
5. Add browser storage, bounded cache management and download progress.

See [product direction](docs/PRODUCT.md) and [data contract](docs/DATA.md).

## Distribution and license

The package is private and unpublished. A software license must be selected before public release; upstream terrain data will retain its own attribution and redistribution requirements. GitHub repository creation is pending authentication.
