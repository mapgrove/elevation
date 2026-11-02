# Public alpha coverage and evidence

Data was built and verified on 2026-11-02 from the AWS 2021 Copernicus GLO-90 catalog. These are experimental **surface** heights including vegetation and infrastructure, referenced to EGM2008. Validation checks source consistency, not surveyed ground-truth accuracy or suitability for navigation.

## South Korea surrounding envelope

[Public alpha release](https://github.com/mapgrove/elevation/releases/tag/data-south-korea-alpha-v1) · [packed manifest](https://github.com/mapgrove/elevation/releases/download/data-south-korea-alpha-v1/manifest.json) · [coverage IDs](https://github.com/mapgrove/elevation/releases/download/data-south-korea-alpha-v1/coverage.json)

Selection is `[124.5, 33, 132, 39]` west/south/east/north on the same global 0.1° grid used worldwide. It includes Jeju, Ulleungdo, Dokdo, surrounding sea and some neighboring territory. It is a reproducible envelope, not a clipped administrative polygon. All selected cells were processed; that does not certify every land point has a valid height.

| Measurement | Result |
|---|---:|
| Requested cells | 4,500 |
| Built cells | 3,519 |
| Unavailable cells | 981 |
| Built cells with some NaN nodes | 224 |
| One-degree packs | 46 |
| Compressed tile payload | 78,108,364 bytes |
| Original sources used | 44 |
| New original source downloads during this build | 107,168,798 bytes |
| Checked shared edges | 6,855, all identical including NaNs |
| Valid native-center comparisons | 3,400, maximum difference 0 m |
| Missing native centers checked | 119, preserved as NaN |

The source download figure excludes previously cached sources and HTTP overhead. The output payload figure excludes manifests and notices. Missing catalog support is unknown coverage, not an assumed ocean height. Valid zeros already present in the original source remain zeros. Counts of missing nodes include duplicated tile edges. Coastal cells and islands receive the same source-supported interpolation as inland cells; no land mask is invented. Administrative land completeness and an external coastline comparison remain unverified.

The release includes hashes, source provenance, original build manifest, packed manifest, coverage IDs, attribution and validation reports. [Tracked validation summary](../data/validation/south-korea-alpha-v1.json).

## Staged world coverage

[Public world sample release](https://github.com/mapgrove/elevation/releases/tag/data-world-stage-alpha-v1) · [packed manifest](https://github.com/mapgrove/elevation/releases/download/data-world-stage-alpha-v1/manifest.json)

Only these **nine cells** are published: `1275/3070`, `1415/1798`, `1297/751`, `560/1984`, `561/3312`, `898/1014`, `1682/1956`, `732/3599`, `732/0`. They provide samples near Seoul, London, Denver, Cape Town, Sydney, Quito, Svalbard (78°N), and both sides of the date line near Fiji. They cover six inhabited continents, both hemispheres and a high-latitude source-width band; they do not establish worldwide completeness, Antarctic coverage or pole correctness.

Nine built cells, no NaN nodes, 341,627 compressed bytes, nine packs. Every native center matches the source exactly; the one published adjacent date-line edge is identical. [Tracked validation summary](../data/validation/world-stage-alpha-v1.json). Synthetic tests additionally exercise source boundaries and latitude-band transitions. Full worldwide source support remains available separately through whole-COG source mode.

## Reproduce public download and offline use

After `pnpm install --frozen-lockfile` with Node.js 24+:

```sh
node examples/published.ts --dataset=south-korea --prepare
node examples/published.ts --dataset=south-korea
node examples/published.ts --dataset=world-stage --prepare
node examples/published.ts --dataset=world-stage
```

Preparation fetches a public combined manifest, plans short routes, then requests only exact tile ranges. It uses no GitHub token. Default repeat runs replace network fetch with a throwing function before any lookup; warm lookups are network-blocked in both modes. Existing cache files are reused. `--cache-dir=PATH` selects a fresh directory for cold measurements. If a profile encounters missing samples, it reports `noData` rather than inventing a height. Example lines are geometric samples, not verified walking routes; some cross sea or steep terrain.

Measurements from this development machine and network are in [South Korea cold](../data/validation/south-korea-cold.json), [South Korea offline](../data/validation/south-korea-offline.json), [world cold](../data/validation/world-stage-cold.json) and [world offline](../data/validation/world-stage-offline.json). They are single observations, not performance guarantees. Payload request counts exclude manifest fetches, redirects, headers and failed attempts. Manifest bytes are measured separately; total cold payload bytes must include them. Peak RSS is whole-process memory, not an isolated tile decoder allocation. `elapsedMs` starts after manifest loading and covers route planning, selected payload downloads (when preparing) and profile queries; it excludes manifest transfer latency. The South Korea prepared run took about 2.75 s for that phase, versus 39 ms offline; world samples took about 615 ms prepared and 44 ms offline on this run.

The five South Korea examples (Seoul, Busan, Jeju, Ulleungdo and Dokdo) fetched six compressed tiles totaling 163,354 bytes, plus the 1,362,953-byte combined manifest. Thus the current convenience example's cold payload is **1,526,307 bytes**, over seven logical asset fetches, excluding redirects/headers. Remote shard discovery is still manual; fetching only needed shard manifests is the next way to reduce index overhead. Cached tile storage is 163,354 bytes plus the manifest and filesystem overhead.

## Reproduce generation and consistency checks

See [pipeline](PIPELINE.md) for installing Python dependencies and generating explicit areas. Then:

```sh
python scripts/validate_build.py --input .cache/south-korea-v1 \
  --source-cache .cache/global --output .cache/south-korea-v1/validation.json
python scripts/pack_tiles.py --input .cache/south-korea-v1 \
  --output .cache/south-korea-packed-v1 \
  --base-url https://github.com/mapgrove/elevation/releases/download/data-south-korea-alpha-v1
```

Validation verifies every built file's hash/header/length, all present north/east shared edges (including date-line wrap), the built/unavailable coverage partition and one exact native center per tile through an independent rasterio inverse transform. The test suite also injects a changed center with an updated payload checksum to ensure the source comparison catches it. Release `validation.json` hashes refer to `build-manifest.json`; pack indexing changes URLs/ranges while preserving payload hashes. Build-time `published: false` fields describe the state before upload, while the linked public releases establish current availability.

CI verifies synthetic generation, packing, consistency checks, SDK semantics and local demos without downloading these releases. Public range support was checked by the explicit example runs; continued upstream service availability is outside the SDK's control. Preserve each release's NOTICE.md and applicable Copernicus data terms.
