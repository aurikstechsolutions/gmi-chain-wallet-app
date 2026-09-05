import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "gmi-bridge-tests-"));
const outfile = join(directory, "bridge.test.mjs");

try {
  await build({
    entryPoints: ["src/lib/bridge.test.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    sourcemap: false,
    external: ["node:*", "ioredis"],
  });

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", outfile], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Tests exited with ${code}`)));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}