import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tscPath = resolveTsc(root);

const projects = [
  "packages/protocol/tsconfig.json",
  "packages/tool-executor/tsconfig.json",
  "packages/core/tsconfig.json",
  "packages/storage/tsconfig.json",
  "packages/skill-engine/tsconfig.json",
  "apps/gateway/tsconfig.json"
];

for (const project of projects) {
  runTsc(tscPath, project);
}

console.log("[backend-build] done");

function resolveTsc(cwd) {
  const candidates = [
    "node_modules/typescript/lib/tsc.js",
    "/usr/local/lib/node_modules/typescript/lib/tsc.js",
    "apps/web-console/node_modules/typescript/lib/tsc.js",
    "apps/desktop/node_modules/typescript/lib/tsc.js"
  ];

  for (const candidate of candidates) {
    const full = resolve(cwd, candidate);
    if (existsSync(full)) {
      return full;
    }
  }

  throw new Error(
    "Cannot find TypeScript compiler. Install workspace deps first (e.g. pnpm install)."
  );
}

function runTsc(tsc, project) {
  const args = [tsc, "-p", project];
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
