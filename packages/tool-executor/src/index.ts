// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { spawn } from "node:child_process";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, resolve, sep } from "node:path";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpRequest } from "node:http";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpsRequest } from "node:https";
import { executeMemorySearch } from "./memory-search.js";

declare const process: any;
declare const Buffer: any;

interface AbortSignalLike {
  aborted: boolean;
  addEventListener?(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: "abort", listener: () => void): void;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  runId: string;
  sessionId: string;
  runtimeMode: "local" | "cloud";
  toolCallId?: string;
}

export interface ToolResult {
  ok: boolean;
  output?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface ToolExecutionHooks {
  onUpdate?: (update: { delta: string; at: string }) => void;
  signal?: AbortSignalLike;
}

export interface ToolExecutor {
  execute(call: ToolCall, ctx: ToolContext, hooks?: ToolExecutionHooks): Promise<ToolResult>;
}

export interface LocalToolExecutorOptions {
  workspaceRoot?: string;
  bashShell?: string;
  defaultTimeoutMs?: number;
}

export function createLocalToolExecutor(options: LocalToolExecutorOptions = {}): ToolExecutor {
  const workspaceRoot = normalizePath(options.workspaceRoot ?? process.cwd());
  const bashShell = options.bashShell ?? "/bin/zsh";
  const defaultTimeoutMs = toPositiveInt(options.defaultTimeoutMs) ?? 15_000;

  return {
    async execute(call: ToolCall, _ctx: ToolContext, hooks?: ToolExecutionHooks): Promise<ToolResult> {
      switch (call.name) {
        case "bash.exec":
          return await executeBash(call.args, {
            workspaceRoot,
            bashShell,
            defaultTimeoutMs
          }, hooks);
        case "file.read":
          return executeFileRead(call.args, workspaceRoot);
        case "file.write":
          return executeFileWrite(call.args, workspaceRoot);
        case "file.list":
          return executeFileList(call.args, workspaceRoot);
        case "http.request":
          return await executeHttpRequest(call.args, defaultTimeoutMs, hooks);
        case "memory.get":
          return executeMemoryGet(call.args, workspaceRoot);
        case "memory.search":
          return executeMemorySearch(call.args, workspaceRoot);
        case "memory.appendDaily":
          return executeMemoryAppendDaily(call.args, workspaceRoot);
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

async function executeBash(
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

function executeFileRead(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
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

function executeFileWrite(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
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

function executeFileList(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
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

async function executeHttpRequest(
  args: Record<string, unknown>,
  defaultTimeoutMs: number,
  hooks?: ToolExecutionHooks
): Promise<ToolResult> {
  const urlText = typeof args.url === "string" ? args.url.trim() : "";
  if (urlText.length === 0) {
    return fail("http.request 需要 url");
  }

  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return fail(`http.request 非法 url: ${urlText}`);
  }

  const method = typeof args.method === "string" && args.method.trim().length > 0 ? args.method.trim() : "GET";
  const timeoutMs = toPositiveInt(args.timeoutMs) ?? defaultTimeoutMs;
  const bodyRaw = args.body;
  const headers = normalizeHeaders(args.headers);

  const bodyText =
    typeof bodyRaw === "string"
      ? bodyRaw
      : bodyRaw === undefined
        ? undefined
        : JSON.stringify(bodyRaw);

  if (bodyText !== undefined && headers["content-type"] === undefined) {
    headers["content-type"] = "application/json";
  }
  if (bodyText !== undefined && headers["content-length"] === undefined) {
    headers["content-length"] = String(Buffer.byteLength(bodyText));
  }

  try {
    const result = await requestHttp({
      url,
      method,
      headers,
      body: bodyText,
      timeoutMs,
      hooks
    });

    const output = JSON.stringify({
      statusCode: result.statusCode,
      headers: result.headers,
      body: result.body
    });

    if (result.statusCode >= 200 && result.statusCode < 300) {
      return {
        ok: true,
        output
      };
    }

    return fail(`http.request failed with status ${result.statusCode}: ${result.body}`);
  } catch (error) {
    return fail(`http.request 失败: ${toErrorMessage(error)}`);
  }
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

function executeMemoryGet(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
  const path = resolveMemoryPathArg(args.path);
  if (!path) {
    return fail("memory.get 仅允许 MEMORY.md 或 memory/*.md");
  }

  const safePath = resolveSafePath(workspaceRoot, path);
  if (!safePath.ok) {
    return fail(safePath.message);
  }

  const from = toPositiveInt(args.from) ?? 1;
  const lines = toPositiveInt(args.lines);

  try {
    const text = readFileSync(safePath.value, "utf8");
    const parts = text.split(/\r?\n/);
    const start = Math.max(0, from - 1);
    const end = lines ? Math.min(parts.length, start + lines) : parts.length;
    const sliced = parts.slice(start, end).join("\n");
    return {
      ok: true,
      output: JSON.stringify({
        path,
        from,
        lines: lines ?? null,
        totalLines: parts.length,
        text: sliced
      })
    };
  } catch (error) {
    return fail(`memory.get 失败: ${toErrorMessage(error)}`);
  }
}

function executeMemoryAppendDaily(args: Record<string, unknown>, workspaceRoot: string): ToolResult {
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

  const dailyPath = `memory/${date}.md`;
  const safeDailyPath = resolveSafePath(workspaceRoot, dailyPath);
  if (!safeDailyPath.ok) {
    return fail(safeDailyPath.message);
  }

  const includeLongTerm = args.includeLongTerm === true;
  const safeLongTermPath = includeLongTerm ? resolveSafePath(workspaceRoot, "MEMORY.md") : null;
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

async function requestHttp(input: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  hooks?: ToolExecutionHooks;
}): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const client = input.url.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise((resolve, reject) => {
    const req = client(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname,
        port: input.url.port ? Number(input.url.port) : undefined,
        method: input.method,
        path: `${input.url.pathname}${input.url.search}`,
        headers: input.headers,
        timeout: input.timeoutMs
      },
      (res: any) => {
        const chunks: any[] = [];
        res.on("data", (chunk: any) => {
          chunks.push(chunk);
          input.hooks?.onUpdate?.({
            delta: String(chunk),
            at: nowIso()
          });
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers ?? {})) {
            headers[String(key)] = Array.isArray(value) ? value.join(", ") : String(value ?? "");
          }
          resolve({
            statusCode: typeof res.statusCode === "number" ? res.statusCode : 0,
            headers,
            body
          });
        });
      }
    );

    req.on("error", reject);
    const signal = input.hooks?.signal;
    const abortHandler = () => {
      req.destroy(new Error("aborted"));
    };
    if (signal) {
      if (signal.aborted) {
        reject(new Error("aborted"));
        return;
      }
      signal.addEventListener?.("abort", abortHandler, { once: true });
      req.on("close", () => {
        signal.removeEventListener?.("abort", abortHandler);
      });
    }
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });

    if (input.body !== undefined) {
      req.write(input.body);
    }
    req.end();
  });
}

function normalizeHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      headers[key.toLowerCase()] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      headers[key.toLowerCase()] = String(value);
    }
  }
  return headers;
}

function resolveMemoryPathArg(input: unknown): string | undefined {
  const path = typeof input === "string" && input.trim().length > 0 ? input.trim() : "MEMORY.md";
  if (path === "MEMORY.md") {
    return path;
  }
  if (/^memory\/[A-Za-z0-9._-]+\.md$/.test(path)) {
    return path;
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

function resolveSafePath(workspaceRoot: string, inputPath: string): { ok: true; value: string } | { ok: false; message: string } {
  const absolute = normalizePath(resolve(workspaceRoot, inputPath));
  const root = normalizePath(workspaceRoot);
  if (absolute === root || absolute.startsWith(`${root}${sep}`) || absolute.startsWith(`${root}/`)) {
    return { ok: true, value: absolute };
  }
  return { ok: false, message: `路径越界: ${inputPath}` };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  return Number.isFinite(value) ? value : undefined;
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : undefined;
}

function fail(message: string): ToolResult {
  return {
    ok: false,
    error: {
      code: "TOOL_EXEC_FAILED",
      message
    }
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
