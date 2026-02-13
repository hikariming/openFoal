import { spawnSync } from "node:child_process";

run(["scripts/backend-build.mjs"]);
run([
  "--test",
  "tests/backend/core.runtime.test.mjs",
  "tests/backend/protocol.contract.test.mjs",
  "tests/backend/gateway.router.test.mjs",
  "tests/backend/gateway.server.test.mjs"
]);

function run(args) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
