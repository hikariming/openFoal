import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const workspaceRoot = resolve(process.cwd());

const contextFiles = ["AGENTS.md", "SOUL.md", "TOOLS.md", "USER.md"];

const moved = [];
const conflicts = [];
const skipped = [];

for (const fileName of contextFiles) {
  moveIfPresent(fileName, `.openfoal/context/${fileName}`);
}

moveIfPresent("MEMORY.md", ".openfoal/memory/MEMORY.md");

collectLegacyDailyFiles("memory");
collectLegacyDailyFiles("daily");

cleanupIfEmpty("memory");
cleanupIfEmpty("daily");

printSummary();

function collectLegacyDailyFiles(dirName) {
  const dirPath = resolve(workspaceRoot, dirName);
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    return;
  }
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (!/^[A-Za-z0-9._-]+\.md$/.test(entry.name)) {
      continue;
    }
    moveIfPresent(`${dirName}/${entry.name}`, `.openfoal/memory/daily/${entry.name}`);
  }
}

function cleanupIfEmpty(relPath) {
  const absPath = resolve(workspaceRoot, relPath);
  if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
    return;
  }
  const remaining = readdirSync(absPath);
  if (remaining.length > 0) {
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] remove empty dir ${relPath}`);
    return;
  }
  rmSync(absPath, { recursive: true, force: true });
}

function moveIfPresent(sourceRelPath, targetRelPath) {
  const sourcePath = resolve(workspaceRoot, sourceRelPath);
  const targetPath = resolve(workspaceRoot, targetRelPath);

  if (!existsSync(sourcePath)) {
    skipped.push(sourceRelPath);
    return;
  }
  if (!statSync(sourcePath).isFile()) {
    skipped.push(sourceRelPath);
    return;
  }
  if (existsSync(targetPath)) {
    conflicts.push({ sourceRelPath, targetRelPath });
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] move ${sourceRelPath} -> ${targetRelPath}`);
    moved.push({ sourceRelPath, targetRelPath });
    return;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  try {
    renameSync(sourcePath, targetPath);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "EXDEV") {
      copyFileSync(sourcePath, targetPath);
      unlinkSync(sourcePath);
    } else {
      throw error;
    }
  }
  moved.push({ sourceRelPath, targetRelPath });
}

function printSummary() {
  console.log(`[migrate-openfoal-layout] mode=${dryRun ? "dry-run" : "apply"}`);
  console.log(`[migrate-openfoal-layout] moved=${moved.length} conflicts=${conflicts.length}`);

  if (moved.length > 0) {
    for (const item of moved) {
      console.log(`  moved: ${item.sourceRelPath} -> ${item.targetRelPath}`);
    }
  }

  if (conflicts.length > 0) {
    for (const item of conflicts) {
      console.log(`  conflict: ${item.sourceRelPath} -> ${item.targetRelPath} (target exists, skipped)`);
    }
  }

  if (skipped.length > 0) {
    const uniqueSkipped = Array.from(new Set(skipped)).sort();
    console.log(`  skipped-missing: ${uniqueSkipped.join(", ")}`);
  }
}
