// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { spawn } from "node:child_process";
import { resolveSafePath } from "../scope.js";
import type { ToolExecutionHooks, ToolResult } from "../types.js";
import { fail, nowIso, toErrorMessage, toPositiveInt } from "../utils.js";

export async function executeBash(
  args: Record<string, unknown>,
  options: {
    workspaceRoot: string;
    bashShell: string;
    defaultTimeoutMs: number;
  },
  hooks?: ToolExecutionHooks
): Promise<ToolResult> {
  const cmd = typeof args.cmd === "string" ? args.cmd.trim() : "";
  if (cmd.length === 0) {
    return fail("bash.exec 需要 cmd");
  }

  const cwd = typeof args.cwd === "string" && args.cwd.trim().length > 0 ? args.cwd.trim() : ".";
  const safeCwd = resolveSafePath(options.workspaceRoot, cwd);
  if (!safeCwd.ok) {
    return fail(safeCwd.message);
  }

  const timeoutMs = toPositiveInt(args.timeoutMs) ?? options.defaultTimeoutMs;
  try {
    const result = await runBashProcess({
      cmd,
      shell: options.bashShell,
      cwd: safeCwd.value,
      timeoutMs,
      hooks
    });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim() || `exit code ${String(result.status)}`;
      return fail(`bash.exec failed: ${detail}`);
    }
    return {
      ok: true,
      output: result.stdout
    };
  } catch (error) {
    return fail(`bash.exec error: ${toErrorMessage(error)}`);
  }
}

async function runBashProcess(input: {
  cmd: string;
  shell: string;
  cwd: string;
  timeoutMs: number;
  hooks?: ToolExecutionHooks;
}): Promise<{ status: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.shell, ["-lc", input.cmd], {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let aborted = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);

    const signal = input.hooks?.signal;
    const abortHandler = () => {
      aborted = true;
      child.kill("SIGKILL");
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeout);
        reject(new Error("aborted"));
        return;
      }
      signal.addEventListener?.("abort", abortHandler, { once: true });
    }

    const finalize = (result: { status: number; stdout: string; stderr: string } | Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener?.("abort", abortHandler);
      }
      if (result instanceof Error) {
        reject(result);
        return;
      }
      resolve(result);
    };

    child.stdout?.on("data", (chunk: any) => {
      const text = String(chunk);
      stdout += text;
      input.hooks?.onUpdate?.({
        delta: text,
        at: nowIso()
      });
    });
    child.stderr?.on("data", (chunk: any) => {
      const text = String(chunk);
      stderr += text;
      input.hooks?.onUpdate?.({
        delta: text,
        at: nowIso()
      });
    });

    child.once("error", (error: Error) => {
      finalize(error);
    });

    child.once("close", (code: number | null) => {
      if (timedOut) {
        finalize(new Error(`timeout after ${input.timeoutMs}ms`));
        return;
      }
      if (aborted) {
        finalize(new Error("aborted"));
        return;
      }
      finalize({
        status: typeof code === "number" ? code : 1,
        stdout,
        stderr
      });
    });
  });
}
