const { spawnSync } = require("node:child_process");

const result = spawnSync(
  process.execPath,
  ["--test", require.resolve("./solana.test.cjs")],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);