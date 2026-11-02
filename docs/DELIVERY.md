# Area planning and static delivery

`createTerrain` supports small-grid data built by the pipeline. Global source mode remains a separate whole-COG fallback; it does not expose these area plans.

```js
import { createTerrain, sampleRoute, SOUTH_KOREA_ENVELOPE } from './dist/index.js';
const terrain = createTerrain({ manifest, cacheDir: '.cache/my-area' });
const plan = await terrain.planArea({
  bounds: { west: 127, south: 37.5, east: 127.2, north: 37.7 },
});
console.log(plan.requestedTileIds, plan.unavailableTileIds, plan.downloadBytes);
// A plan includes only available assets in tileIds. Decide whether gaps are acceptable.
if (plan.unavailableTileIds.length) throw new Error('Incomplete requested coverage');
const measured = await terrain.download(plan);
console.log(measured.requests, measured.downloadedBytes);
const elevation = await terrain.getElevation({ latitude: 37.55, longitude: 127.05 });
```

Planning performs local verified cache reads and no network calls. `missingTileIds` means downloadable assets absent from cache; `unavailableTileIds` means absent from this manifest, not proof that no global source exists. Built cells may also contain NaN nodes. Requests and downloaded bytes count successful payload requests in a completed download call, excluding headers and failed attempts. Downloading an already cached plan returns zero requests/bytes. Cancellation, integrity checks and offline-only queries remain unchanged.

Other explicit selections:

```js
await terrain.planArea({ cells: ['1275/3070', '1275/3071'] });
await terrain.planArea({ bounds: SOUTH_KOREA_ENVELOPE });
await terrain.planArea({
  route: sampleRoute(waypoints, { spacingMeters: 1000 }),
  corridorMeters: 500,
});
```

Bounds use half-open east/north edges and can cross the date line (`west > east`). The South Korea constant is a surrounding envelope, not an administrative country polygon. For an administrative AOI, supply the externally computed intersecting cell IDs. Default selection limit is 50,000 cells; `maxCells` can explicitly raise it to 6,480,000. A worldwide selection/manifest may be too large for memory; use bounded stages.

Route planning takes conservative rectangular envelopes around every supplied segment and extends them by the corridor radius on each side. It includes intervening cells even with distant waypoints, but can select extra cells. It describes straight geographic segments, taking the short date-line path; use `sampleRoute` first for a sampled great-circle route. It is not exact polygon clipping or navigation-grade corridor geometry. Near the poles it may select all longitudes. Endpoint/boundary padding deliberately includes adjacent boundary cells.

## Avoid millions of individual hosted objects

At 100 small cells per source degree, 26,475 cataloged source files imply up to 2,647,500 small tile objects before source-gap filtering. The pipeline can instead pack up to 100 independent gzip payloads in each one-degree `.pack` object:

```sh
python scripts/pack_tiles.py --input .cache/example-v1 \
  --output .cache/example-packed-v1 --base-url https://YOUR-PUBLIC-STATIC-HOST/example-v1
```

A pack is concatenated bytes, with no extra compression. Tile hashes and compressed byte counts stay unchanged. Every manifest asset has `range: { offset, totalBytes }`; `bytes` is the selected compressed tile length. Content-addressed pack and shard names allow immutable caching. `manifest.json` is a convenient combined index for small batches; `distribution.json` lists one-degree shard manifests for staged/global consumers. Automatic remote shard discovery/loading is not implemented: load only relevant shards yourself and combine compatible `tiles` dictionaries before creating the SDK.

This reduces potential payload objects to roughly the source-degree count, plus one small manifest per shard. It does not make world preprocessing or transfer free. The combined global manifest should not be fetched for every small-area request. The packer validates input bytes before referencing them, writes files locally and never uploads them.

## Host requirements and release status

Use a public static host with HTTPS, exact HTTP Range support, sufficient storage/traffic allowance and appropriate Copernicus attribution. The SDK requires **206 Partial Content**, exact `Content-Range` including total length, and identity content encoding. A host returning the whole file with HTTP 200 is rejected before buffering its body; the SDK never silently downloads the full pack. Individual tile URLs remain supported when range hosting is unavailable.

GitHub source hosting is useful for the SDK, docs and small fixtures. It is not the chosen global data CDN. Public experimental GitHub Releases now host the [South Korea envelope and nine world samples](COVERAGE.md). Exact ranges were verified through anonymous SDK downloads against those public assets. This establishes alpha delivery behavior, not production CDN capacity, availability or long-term traffic guarantees. Local `python -m http.server` can serve individual tiles but is not a range-host deployment recipe.

The integration test serves a real compressed tile inside a larger synthetic pack: it verifies one exact range request, payload-only transfer size, subsequent cache reuse/offline lookup, and rejection of ignored or malformed ranges. Python tests verify pack slices match original bytes and repeat builds produce identical indexes.
