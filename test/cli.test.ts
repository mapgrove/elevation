import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const run = promisify(execFile);
const cli = new URL("../src/cli.ts", import.meta.url).pathname;
test("CLI help describes explicit network preparation", async () => {
  const { stdout } = await run(process.execPath, [cli, "--help"]);
  assert.match(stdout, /Default lookups are offline/);
});
test("CLI plans sampled routes as JSON without downloading data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "elevation-cli-"));
  try {
    const file = join(dir, "route.json");
    await writeFile(
      file,
      JSON.stringify([
        { latitude: 51.5, longitude: -0.1 },
        { latitude: 51.6, longitude: -0.1 },
      ]),
    );
    const { stdout, stderr } = await run(process.execPath, [
      cli,
      "plan",
      `--file=${file}`,
      "--spacing=1000",
      `--cache=${dir}`,
    ]);
    const plan = JSON.parse(stdout);
    assert.ok(plan.sampleCount > 2);
    assert.equal(plan.downloadBytes, null);
    assert.equal(plan.missingTileIds.length, 1);
    assert.equal(stderr, "");
    const status = JSON.parse(
      (await run(process.execPath, [cli, "cache", `--cache=${dir}`])).stdout,
    );
    assert.equal(status.totalBytes, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CLI rejects invalid coordinates and fails offline when cache is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "elevation-cli-"));
  try {
    await assert.rejects(
      run(process.execPath, [
        cli,
        "point",
        "--latitude=91",
        "--longitude=0",
        `--cache=${dir}`,
      ]),
      (e: any) => /Invalid geographic/.test(e.stderr),
    );
    await assert.rejects(
      run(process.execPath, [
        cli,
        "point",
        "--latitude=51.5074",
        "--longitude=-0.1278",
        `--cache=${dir}`,
      ]),
      (e: any) => /download required/.test(e.stderr),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
