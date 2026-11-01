# Global source mode

## Available now

`createGlobalTerrain` provides Node.js access to the public Copernicus GLO-90 AWS catalog, downloads only selected one-degree source COGs, and reads nearest native elevation samples from a persistent local cache. It needs neither our data server nor GitHub authentication. The catalog snapshot contains 26,475 source tiles; this is catalog coverage, not a guarantee of a valid sample at every coordinate.

This is an alternative to `createTerrain`, which downloads small preprocessed regional tiles and uses bilinear interpolation. Global small-tile hosting is **not** implemented. Download sizes from the regional benchmark must not be quoted for source mode.

## Try it

Requires Node.js 24+ and the dependencies in package.json. Use pnpm 11.25.0 with the committed lockfile:

```sh
pnpm install --frozen-lockfile
pnpm run demo:global
pnpm run demo:global -- --offline
```

The offline command installs a failing network function before lookups, uses a new SDK instance and verifies the six recorded sample values. It fails if required source files are not already cached. The cache is `.cache/global`, ignored by Git.

```ts
import { createGlobalTerrain, loadGlobalCatalog } from '@mapgrove/elevation/global';

const terrain = createGlobalTerrain({
  catalog: await loadGlobalCatalog(),
  cacheDir: '.cache/elevation',
});
const points = [{ latitude: 51.5074, longitude: -0.1278 }];
const plan = await terrain.plan({ points }); // Reads only catalog and cache.
await terrain.download(plan);              // Explicit network preparation.
const height = await terrain.getElevation(points[0]); // Cache only.
```

The package is private and unpublished; the import is the intended package interface. In a checkout, import `./src/global.ts` instead.

## Measured checks

Six points in Seoul, London, Denver, Cape Town, Sydney and Quito were downloaded and queried, then re-run with network access disabled. A separate rasterio reader independently selected the same source pixel-center samples and agreed with all values. The six COGs total 25,972,896 bytes. Values, original source names and actual file sizes are recorded in `data/global/verification.json`.

These checks validate source decoding and offline reuse at those points. They do not establish absolute accuracy, global completeness or every boundary case. Missing ocean/source entries throw coverage errors rather than returning zero.

## World size and file count

The published tile list contains names but no byte sizes, so exact total COG storage has **not** been measured. Applying the documented latitude-dependent grid widths to every catalog entry gives about 100.5 GB of uncompressed Float32 sample payload. This excludes compression, overviews, headers and auxiliary files and is not an estimate of download bytes.

Cutting every one-degree source into 0.1° cells would produce up to 2,647,500 objects; 0.05° cells would produce up to 10,590,000 before coverage filtering. This object count is an important reason to avoid bulk-loading all tiny files into Git or a single release. Source mode avoids that work entirely, at the cost of larger cold downloads.

## Limitations and follow-up

- A cold lookup downloads full compressed one-degree COGs, typically several MB in the six measured examples. No HTTP byte-range optimization is claimed.
- Global interpolation is nearest-neighbor; regional interpolation is bilinear. Sampling spacing changes with latitude as documented upstream.
- Planning selects supplied coordinates, not every cell crossed between route vertices. Densify routes before planning a profile.
- A conservative east/south halo may download extra source files near removed raster edges. Missing halo entries are reported; a lookup throws only if it actually needs missing coverage.
- `downloadBytes` is null because the catalog contains no sizes. Missing-tile counts are available without network access. Do not interpret null as zero.
- Local SHA-256 detects changes after first download; it is not an upstream authenticity checksum. Source files remain subject to external-host availability.
- Global seam/pole behavior needs broader real-world fixtures before a stable release. Cache eviction, cancellation, resumable downloads and bounded in-memory reuse remain future work.

The next optimization is a measured comparison of direct COG range reads versus small generated tiles, including source-block granularity and offline cache consistency. No global preprocessing or public-hosting job is running in the background.

## Catalog refresh and data terms

```sh
python scripts/refresh_global_catalog.py
# Alternatively, download tileList.txt with your HTTPS client and run:
python scripts/refresh_global_catalog.py --input /path/to/tileList.txt
```

The refresh validates names, records the source digest, compresses the catalog and recomputes planning statistics. Review catalog count changes before updating snapshot tests.

See [global data notice](../data/global/NOTICE.md), [source README](https://copernicus-dem-90m.s3.amazonaws.com/readme.html), and [AWS dataset registry](https://registry.opendata.aws/copernicus-dem/).
