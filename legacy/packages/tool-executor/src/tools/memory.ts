// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname } from "node:path";
import { executeMemorySearch } from "../memory-search.js";
import {
  resolveDailyMemoryPath,
  resolveLegacyLongTermMemoryPath,
  resolveLongTermMemoryPath,
  resolveSafePath
} from "../scope.js";
import type { ToolResult } from "../types.js";
import { fail, nowIso, readErrorCode, toErrorMessage, toPositiveInt } from "../utils.js";

declare const Buffer: any;

export function executeMemorySearchTool(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
  return executeMemorySearch(args, workspaceRoot);
}

export function executeMemoryGet(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
  const resolvedPath = resolveMemoryPathArg(args.path);
  if (!resolvedPath) {
    return fail("memory.get 仅允许 .openfoal/memory/MEMORY.md 或 .openfoal/memory/daily/*.md（兼容 MEMORY.md、memory/*.md、daily/*.md）");
  }

  const from = toPositiveInt(args.from) ?? 1;
  const lines = toPositiveInt(args.lines);

  for (const candidatePath of resolvedPath.candidates) {
    const safePath = resolveSafePath(workspaceRoot, candidatePath);
    if (!safePath.ok) {
      return fail(safePath.message);
    }
    try {
      const text = readFileSync(safePath.value, "utf8");
      const parts = text.split(/\r?\n/);
      const start = Math.max(0, from - 1);
      const end = lines ? Math.min(parts.length, start + lines) : parts.length;
      const sliced = parts.slice(start, end).join("\n");
      return {
        ok: true,
        output: JSON.stringify({
          path: resolvedPath.canonicalPath,
          from,
          lines: lines ?? null,
          totalLines: parts.length,
          text: sliced
        })
      };
    } catch (error) {
      if (readErrorCode(error) === "ENOENT") {
        continue;
      }
      return fail(`memory.get 失败: ${toErrorMessage(error)}`);
    }
  }

  return {
    ok: true,
    output: JSON.stringify({
      path: resolvedPath.canonicalPath,
      from,
      lines: lines ?? null,
      totalLines: 0,
      text: ""
    })
  };
}

export function executeMemoryAppendDaily(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
  const content =
    typeof args.content === "string"
      ? args.content
      : typeof args.content === "number" || typeof args.content === "boolean"
        ? String(args.content)
        : "";
  if (content.trim().length === 0) {
    return fail("memory.appendDaily 需要 content");
  }

  const date = normalizeDate(args.date);
  if (!date) {
    return fail("memory.appendDaily 的 date 必须为 YYYY-MM-DD");
  }

  const dailyPath = resolveDailyMemoryPath(args, date);
  const safeDailyPath = resolveSafePath(workspaceRoot, dailyPath);
  if (!safeDailyPath.ok) {
    return fail(safeDailyPath.message);
  }

  const includeLongTerm = args.includeLongTerm === true;
  const safeLongTermPath = includeLongTerm ? resolveSafePath(workspaceRoot, resolveLongTermMemoryPath()) : null;
  if (includeLongTerm && safeLongTermPath && !safeLongTermPath.ok) {
    return fail(safeLongTermPath.message);
  }

  const entry = `- ${nowIso()} ${content.trim()}\n`;
  try {
    mkdirSync(dirname(safeDailyPath.value), { recursive: true });
    appendFileSync(safeDailyPath.value, entry, "utf8");

    if (includeLongTerm && safeLongTermPath && safeLongTermPath.ok) {
      appendFileSync(safeLongTermPath.value, `- ${content.trim()}\n`, "utf8");
    }

    return {
      ok: true,
      output: JSON.stringify({
        path: dailyPath,
        append: true,
        bytes: Buffer.byteLength(entry),
        includeLongTerm
      })
    };
  } catch (error) {
    return fail(`memory.appendDaily 失败: ${toErrorMessage(error)}`);
  }
}

function resolveMemoryPathArg(input: unknown): { canonicalPath: string; candidates: string[] } | undefined {
  const rawPath = typeof input === "string" && input.trim().length > 0 ? input.trim() : resolveLongTermMemoryPath();
  if (rawPath === resolveLongTermMemoryPath() || rawPath === resolveLegacyLongTermMemoryPath()) {
    return {
      canonicalPath: resolveLongTermMemoryPath(),
      candidates: [resolveLongTermMemoryPath(), resolveLegacyLongTermMemoryPath()]
    };
  }
  if (/^\.openfoal\/memory\/daily\/[A-Za-z0-9._/-]+\.md$/.test(rawPath)) {
    const suffix = rawPath.slice(".openfoal/memory/daily/".length);
    return {
      canonicalPath: rawPath,
      candidates: [rawPath, `daily/${suffix}`, `memory/${suffix}`]
    };
  }
  if (/^memory\/[A-Za-z0-9._/-]+\.md$/.test(rawPath)) {
    const suffix = rawPath.slice("memory/".length);
    return {
      canonicalPath: `.openfoal/memory/daily/${suffix}`,
      candidates: [`.openfoal/memory/daily/${suffix}`, rawPath, `daily/${suffix}`]
    };
  }
  if (/^daily\/[A-Za-z0-9._/-]+\.md$/.test(rawPath)) {
    const suffix = rawPath.slice("daily/".length);
    return {
      canonicalPath: `.openfoal/memory/daily/${suffix}`,
      candidates: [`.openfoal/memory/daily/${suffix}`, rawPath, `memory/${suffix}`]
    };
  }
  return undefined;
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  if (value === undefined || value === null) {
    return nowIso().slice(0, 10);
  }
  return undefined;
}
