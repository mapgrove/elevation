#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createGlobalTerrain, loadGlobalCatalog } from "./global.ts";
import { sampleRoute, tileFor, type Point } from "./index.ts";

const HELP = `MapGrove Elevation (experimental, Node.js 24+)

Usage:
  mapgrove-elevation point --latitude=51.5074 --longitude=-0.1278 [--prepare]
  mapgrove-elevation profile --file=route.json [--spacing=90] [--prepare]
  mapgrove-elevation plan --file=route.json [--spacing=90]
  mapgrove-elevation cache

Options:
  --cache=PATH   Local source cache (default: .cache/mapgrove)
  --prepare      Explicitly allow missing source downloads before lookup
  --spacing=N    Insert great-circle route samples at most N meters apart
  --help         Show this help

Route JSON: [{"latitude":51.5074,"longitude":-0.1278}, ...]
Default lookups are offline. Global mode downloads whole one-degree COGs,
uses nearest native samples and reports EGM2008 surface heights in meters.
Progress goes to stderr; successful results are JSON on stdout.
`;
export async function main(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      latitude: { type: "string" },
      longitude: { type: "string" },
      file: { type: "string" },
      spacing: { type: "string" },
      cache: { type: "string" },
      prepare: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !positionals.length) {
    process.stdout.write(HELP);
    return;
  }
  const [command, ...extra] = positionals;
  if (extra.length || !["point", "profile", "plan", "cache"].includes(command))
    throw new Error("Unknown command or extra arguments. Use --help.");
  let points: Point[] = [];
  if (command === "point") {
    if (
      values.latitude === undefined ||
      values.longitude === undefined ||
      !values.latitude.trim() ||
      !values.longitude.trim()
    )
      throw new Error("point requires --latitude and --longitude");
    points = [
      {
        latitude: Number(values.latitude),
        longitude: Number(values.longitude),
      },
    ];
    tileFor(points[0]);
  } else if (command === "profile" || command === "plan") {
    if (!values.file) throw new Error(`${command} requires --file`);
    const input: unknown = JSON.parse(await readFile(values.file, "utf8"));
    if (
      !Array.isArray(input) ||
      !input.length ||
      !input.every(
        (p) =>
          p &&
          typeof p === "object" &&
          typeof p.latitude === "number" &&
          typeof p.longitude === "number",
      )
    )
      throw new Error(
        "Route must be a nonempty JSON array of latitude/longitude objects",
      );
    points = input;
    for (const p of points) tileFor(p);
    if (values.spacing !== undefined)
      points = sampleRoute(points, { spacingMeters: Number(values.spacing) });
  }
  const sdk = createGlobalTerrain({
    catalog: await loadGlobalCatalog(),
    cacheDir: values.cache ?? ".cache/mapgrove",
  });
  let result: unknown;
  if (command === "cache") result = await sdk.cacheStatus();
  else {
    const plan = await sdk.plan({ points });
    if (command === "plan") result = { sampleCount: points.length, ...plan };
    else {
      if (values.prepare) {
        const controller = new AbortController();
        const cancel = () => controller.abort(new Error("Download cancelled"));
        process.once("SIGINT", cancel);
        try {
          await sdk.download(plan, {
            signal: controller.signal,
            onProgress: (e) =>
              process.stderr.write(
                `Downloaded ${e.completedTiles}/${e.totalTiles} tiles (${e.downloadedBytes} bytes)\n`,
              ),
          });
        } finally {
          process.removeListener("SIGINT", cancel);
        }
      }
      const profile = await sdk.getProfile(points);
      result = {
        verticalDatum: "EGM2008",
        units: "meters",
        sampling: "nearest-native",
        samples: profile,
      };
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
