import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

run(["--test", "tests/backend/gateway.auth.test.mjs"]);

function run(args) {
  const polyfillPath = "/tmp/openfoal-webapi-polyfill.cjs";
  const nodeOptions = process.env.NODE_OPTIONS ?? "";
  const withPolyfill = existsSync(polyfillPath)
    ? [nodeOptions, `--require=${polyfillPath}`].filter((item) => item && item.trim().length > 0).join(" ")
    : nodeOptions;
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(withPolyfill ? { NODE_OPTIONS: withPolyfill } : {})
    }
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
