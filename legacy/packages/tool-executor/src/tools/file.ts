// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, resolve } from "node:path";
import { normalizePath, resolveSafePath } from "../scope.js";
import type { ToolResult } from "../types.js";
import { fail, toErrorMessage, toPositiveInt } from "../utils.js";

declare const Buffer: any;

export function executeFileRead(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (path.length === 0) {
    return fail("file.read 需要 path");
  }

  const safePath = resolveSafePath(workspaceRoot, path);
  if (!safePath.ok) {
    return fail(safePath.message);
  }

  try {
    const output = readFileSync(safePath.value, "utf8");
    return { ok: true, output };
  } catch (error) {
    return fail(`file.read 失败: ${toErrorMessage(error)}`);
  }
}

export function executeFileWrite(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (path.length === 0) {
    return fail("file.write 需要 path");
  }

  const content =
    typeof args.content === "string"
      ? args.content
      : typeof args.content === "number" || typeof args.content === "boolean"
        ? String(args.content)
        : undefined;
  if (content === undefined) {
    return fail("file.write 需要 content(string|number|boolean)");
  }

  const append = args.append === true;
  const safePath = resolveSafePath(workspaceRoot, path);
  if (!safePath.ok) {
    return fail(safePath.message);
  }

  try {
    mkdirSync(dirname(safePath.value), { recursive: true });
    if (append) {
      appendFileSync(safePath.value, content, "utf8");
    } else {
      writeFileSync(safePath.value, content, "utf8");
    }
    return {
      ok: true,
      output: JSON.stringify({
        path,
        bytes: Buffer.byteLength(content),
        append
      })
    };
  } catch (error) {
    return fail(`file.write 失败: ${toErrorMessage(error)}`);
  }
}

export function executeFileList(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
  const path = typeof args.path === "string" && args.path.trim().length > 0 ? args.path.trim() : ".";
  const recursive = args.recursive === true;
  const limit = toPositiveInt(args.limit) ?? 200;
  const safePath = resolveSafePath(workspaceRoot, path);
  if (!safePath.ok) {
    return fail(safePath.message);
  }

  try {
    const stat = statSync(safePath.value);
    if (!stat.isDirectory()) {
      return fail(`file.list path 不是目录: ${path}`);
    }

    const items: string[] = [];
    walkDir(safePath.value, safePath.value, recursive, limit, items);
    return {
      ok: true,
      output: JSON.stringify({
        path,
        items
      })
    };
  } catch (error) {
    return fail(`file.list 失败: ${toErrorMessage(error)}`);
  }
}

function walkDir(base: string, current: string, recursive: boolean, limit: number, out: string[]): void {
  if (out.length >= limit) {
    return;
  }

  const entries = readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= limit) {
      return;
    }

    const absPath = resolve(current, entry.name);
    const relPath = normalizePath(absPath).slice(normalizePath(base).length).replace(/^\//, "");
    if (entry.isDirectory()) {
      out.push(`${relPath}/`);
      if (recursive) {
        walkDir(base, absPath, true, limit, out);
      }
    } else {
      out.push(relPath);
    }
  }
}
