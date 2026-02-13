// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { spawnSync } from "node:child_process";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, resolve, sep } from "node:path";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpRequest } from "node:http";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpsRequest } from "node:https";

declare const process: any;
declare const Buffer: any;

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolContext {
  runId: string;
  sessionId: string;
  runtimeMode: "local" | "cloud";
}

export interface ToolResult {
  ok: boolean;
  output?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface ToolExecutor {
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
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
    async execute(call: ToolCall): Promise<ToolResult> {
      switch (call.name) {
        case "bash.exec":
          return executeBash(call.args, {
            workspaceRoot,
            bashShell,
            defaultTimeoutMs
          });
        case "file.read":
          return executeFileRead(call.args, workspaceRoot);
        case "file.write":
          return executeFileWrite(call.args, workspaceRoot);
        case "file.list":
          return executeFileList(call.args, workspaceRoot);
        case "http.request":
          return executeHttpRequest(call.args, defaultTimeoutMs);
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

function executeBash(
  args: Record<string, unknown>,
  options: {
    workspaceRoot: string;
    bashShell: string;
    defaultTimeoutMs: number;
  }
): ToolResult {
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
  const result = spawnSync(options.bashShell, ["-lc", cmd], {
    cwd: safeCwd.value,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024
  });

  if (result.error) {
    return fail(`bash.exec error: ${result.error.message}`);
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.status !== 0) {
    const detail = (stderr || stdout || "").trim() || `exit code ${String(result.status)}`;
    return fail(`bash.exec failed: ${detail}`);
  }

  return {
    ok: true,
    output: stdout
  };
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

async function executeHttpRequest(args: Record<string, unknown>, defaultTimeoutMs: number): Promise<ToolResult> {
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
      timeoutMs
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

async function requestHttp(input: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
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
        res.on("data", (chunk: any) => chunks.push(chunk));
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
