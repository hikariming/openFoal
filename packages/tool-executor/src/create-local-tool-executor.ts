import { resolveEffectiveWorkspaceRoot, normalizePath } from "./scope.js";
import { executeBash } from "./tools/bash.js";
import { executeFileList, executeFileRead, executeFileWrite } from "./tools/file.js";
import { executeHttpRequest } from "./tools/http.js";
import { executeMemoryAppendDaily, executeMemoryGet, executeMemorySearchTool } from "./tools/memory.js";
import type { LocalToolExecutorOptions, ToolExecutor, ToolResult } from "./types.js";
import { asFiniteNumber, fail, toPositiveInt } from "./utils.js";

declare const process: any;

export function createLocalToolExecutor(options: LocalToolExecutorOptions = {}): ToolExecutor {
  const workspaceRoot = normalizePath(options.workspaceRoot ?? process.cwd());
  const bashShell = options.bashShell ?? "/bin/zsh";
  const defaultTimeoutMs = toPositiveInt(options.defaultTimeoutMs) ?? 15_000;

  return {
    async execute(call, ctx, hooks): Promise<ToolResult> {
      const effectiveWorkspaceRoot = resolveEffectiveWorkspaceRoot(workspaceRoot, call, ctx);
      switch (call.name) {
        case "bash.exec":
          return await executeBash(call.args, {
            workspaceRoot: effectiveWorkspaceRoot,
            bashShell,
            defaultTimeoutMs
          }, hooks);
        case "file.read":
          return executeFileRead(call.args, effectiveWorkspaceRoot);
        case "file.write":
          return executeFileWrite(call.args, effectiveWorkspaceRoot);
        case "file.list":
          return executeFileList(call.args, effectiveWorkspaceRoot);
        case "http.request":
          return await executeHttpRequest(call.args, defaultTimeoutMs, hooks);
        case "memory.get":
          return executeMemoryGet(call.args, effectiveWorkspaceRoot);
        case "memory.search":
          return executeMemorySearchTool(call.args, effectiveWorkspaceRoot);
        case "memory.appendDaily":
          return executeMemoryAppendDaily(call.args, effectiveWorkspaceRoot);
        case "math.add":
          return executeMathAdd(call.args);
        case "text.upper":
          return executeTextUpper(call.args);
        case "echo":
          return {
            ok: true,
            output: typeof call.args.text === "string" ? call.args.text : JSON.stringify(call.args)
          };
        default:
          return fail(`未知工具: ${call.name}`);
      }
    }
  };
}

function executeMathAdd(args: Record<string, unknown>): ToolResult {
  const a = asFiniteNumber(args.a);
  const b = asFiniteNumber(args.b);
  if (a === undefined || b === undefined) {
    return fail("math.add 需要数值参数 a/b");
  }
  return {
    ok: true,
    output: String(a + b)
  };
}

function executeTextUpper(args: Record<string, unknown>): ToolResult {
  const text = typeof args.text === "string" ? args.text : "";
  return {
    ok: true,
    output: text.toUpperCase()
  };
}
