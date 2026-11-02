# Regional resolution and tile-size benchmark

Measured 2026-11-01 on real Copernicus GLO-90 and GLO-30 AWS rasters in the same Seoul-area region. This measures compressed payload bytes, not end-to-end latency, accuracy, HTTP overhead or global storage.

## Method

- Region: longitude 127.0–127.4, latitude 37.4–37.8.
- Route: 40 supplied samples on a synthetic straight line from (37.55, 127.03) to (37.72, 127.22). This is not a recorded trail; only the supplied samples determine selected tiles.
- Geographic cells at 0.2°, 0.1° and 0.05°; sampling at native 3 and 1 arcsecond intervals respectively.
- Float32 little-endian samples with a 20-byte header, gzip level 9, shared boundary nodes duplicated.
- Source pixel centers are respected; outside-source requests fail rather than extrapolate.
- Totals include the selected files' actual compressed bytes, excluding network and manifest overhead.

| Nominal sampling | Tile side | Tiles for samples | Download bytes | Approx. decimal KB |
|---|---:|---:|---:|---:|
| 90 m | 0.2° | 3 | 608,424 | 608 |
| 90 m | 0.1° | 4 | 203,589 | 204 |
| 90 m | 0.05° | 7 | 92,305 | 92 |
| 30 m | 0.2° | 3 | 5,422,611 | 5,423 |
| 30 m | 0.1° | 4 | 1,799,670 | 1,800 |
| 30 m | 0.05° | 7 | 803,190 | 803 |

At 0.05°, individual tested tiles were 9,753–13,418 bytes (90 m) and 83,165–116,588 bytes (30 m). Smaller tiles reduce excess downloads along a narrow route, but increase object count and requests. These numbers do not justify a global optimum: test other terrain, longer/dense routes, broader areas and request latency first.

## Current decision

Use 90 m as the initial lightweight baseline, while retaining a path to optional 30 m. The public v1 grid now retains the 0.1° extent, with the existing nine-file fixture as compatibility evidence; see [the decision and tradeoffs](GRID_V1.md). 0.05° remains a follow-up candidate, not the v1 default. One-degree JSON remains supported only for synthetic compatibility fixtures.

Do not equate horizontal sampling with vertical accuracy. Copernicus represents the surface, including vegetation and infrastructure. This benchmark does not establish fitness for ascent statistics or navigation.

## Reproduce

Create a Python environment and install `scripts/requirements.txt`. Download the following original COGs outside the repository:

- [GLO-90 source](https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_N37_00_E127_00_DEM/Copernicus_DSM_COG_30_N37_00_E127_00_DEM.tif)
- [GLO-30 source](https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N37_00_E127_00_DEM/Copernicus_DSM_COG_10_N37_00_E127_00_DEM.tif)

```sh
python scripts/build_region.py --source90 /path/to/seoul-90.tif --source30 /path/to/seoul-30.tif
npm test
npm run demo:regional
```

The builder produces the regional files, source-raster reference samples and machine-readable benchmark results. It currently targets one interior source region, not global source stitching. Check `data/seoul-90m/NOTICE.md` before redistributing derived data.


## Profile reuse microbenchmark

A follow-up local run on 2026-11-01 used the same cached GLO-90 London COG for 40 nearby coordinates, with network access disabled. Calling `getElevation` separately for each point took 9,672 ms; one `getProfile` call took 217 ms (about 44.5× faster). Every returned elevation was identical. This demonstrates avoiding repeated disk verification, TIFF parsing and native-block decoding during a profile, not faster network downloads or better elevation accuracy.

This is one machine and one warm-disk-cache source, with individual queries measured first. It is not a universal throughput or memory guarantee. The profile session retains at most two source images and their cached decoded blocks; regional sessions retain at most eight decoded tiles. The limit is by tile count, not bytes.

To reproduce after preparing the example cache with `pnpm demo:global`, run `pnpm bench:profile`. The benchmark refuses to download data and reports raw timings as JSON.
