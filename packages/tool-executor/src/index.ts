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
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
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
  tenantId?: string;
  workspaceId?: string;
  userId?: string;
  workspaceRoot?: string;
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
    async execute(call: ToolCall, ctx: ToolContext, hooks?: ToolExecutionHooks): Promise<ToolResult> {
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
          return executeMemorySearch(call.args, effectiveWorkspaceRoot);
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

  const method = typeof args.method === "string" && args.method.trim().length > 0 ? args.method.trim().toUpperCase() : "GET";
  const timeoutMs = toPositiveInt(args.timeoutMs) ?? defaultTimeoutMs;
  const maxBytes = toPositiveInt(args.maxBytes) ?? 2_000_000;
  const maxBodyChars = toPositiveInt(args.maxBodyChars) ?? 120_000;
  const followRedirects = args.followRedirects !== false;
  const maxRedirects = toPositiveInt(args.maxRedirects) ?? 5;
  const extractMode = readHttpExtractMode(args.extract);
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
  if (headers["accept"] === undefined) {
    headers.accept = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8";
  }
  if (headers["accept-language"] === undefined) {
    headers["accept-language"] = "zh-CN,zh;q=0.9,en;q=0.8";
  }
  if (headers["accept-encoding"] === undefined) {
    headers["accept-encoding"] = "gzip, deflate, br";
  }
  if (headers["user-agent"] === undefined) {
    headers["user-agent"] = "OpenFoalHttpTool/1.0 (+https://openfoal.ai)";
  }

  try {
    const result = await requestHttp({
      url,
      method,
      headers,
      body: bodyText,
      timeoutMs,
      maxBytes,
      followRedirects,
      maxRedirects,
      hooks
    });

    const decodedBody = decodeHttpBody(result.bodyBuffer, result.headers, result.finalUrl);
    const truncatedBody = truncateText(decodedBody, maxBodyChars);
    const extracted =
      extractMode === "none"
        ? undefined
        : maybeExtractReadableHtml({
            html: decodedBody,
            contentType: result.headers["content-type"],
            mode: extractMode
          });

    const output = JSON.stringify({
      statusCode: result.statusCode,
      finalUrl: result.finalUrl,
      redirected: result.redirected,
      redirectCount: result.redirectCount,
      headers: result.headers,
      body: truncatedBody.text,
      bodyTruncated: truncatedBody.truncated || result.truncatedByBytes,
      bodyBytes: result.bodyBuffer.length,
      ...(extracted ? { extracted } : {})
    });

    if (result.statusCode >= 200 && result.statusCode < 300) {
      return {
        ok: true,
        output
      };
    }

    return fail(`http.request failed with status ${result.statusCode}: ${truncatedBody.text}`);
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
    return fail("memory.get 仅允许 MEMORY.md 或 memory/*.md 或 daily/*.md");
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
    if (readErrorCode(error) === "ENOENT") {
      return {
        ok: true,
        output: JSON.stringify({
          path,
          from,
          lines: lines ?? null,
          totalLines: 0,
          text: ""
        })
      };
    }
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

  const dailyPath = resolveDailyMemoryPath(args, date);
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
  maxBytes: number;
  followRedirects: boolean;
  maxRedirects: number;
  hooks?: ToolExecutionHooks;
}): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  bodyBuffer: any;
  finalUrl: string;
  redirected: boolean;
  redirectCount: number;
  truncatedByBytes: boolean;
}> {
  let currentUrl = new URL(input.url.toString());
  let method = input.method;
  let body = input.body;
  let headers = { ...input.headers };
  let redirectCount = 0;

  while (true) {
    const response = await requestHttpOnce({
      url: currentUrl,
      method,
      headers,
      body,
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
      hooks: input.hooks
    });

    if (
      input.followRedirects &&
      redirectCount < input.maxRedirects &&
      isRedirectStatus(response.statusCode) &&
      typeof response.headers.location === "string" &&
      response.headers.location.trim().length > 0
    ) {
      const nextUrl = safeResolveRedirect(currentUrl, response.headers.location);
      if (nextUrl) {
        redirectCount += 1;
        currentUrl = nextUrl;
        if (
          response.statusCode === 301 ||
          response.statusCode === 302 ||
          response.statusCode === 303
        ) {
          method = "GET";
          body = undefined;
          headers = dropBodyHeaders(headers);
        }
        continue;
      }
    }

    return {
      ...response,
      finalUrl: currentUrl.toString(),
      redirected: redirectCount > 0,
      redirectCount
    };
  }
}

async function requestHttpOnce(input: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  hooks?: ToolExecutionHooks;
}): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  bodyBuffer: any;
  truncatedByBytes: boolean;
}> {
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
        let totalBytes = 0;
        let keptBytes = 0;
        let truncatedByBytes = false;
        res.on("data", (chunk: any) => {
          const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += bufferChunk.length;
          const remaining = input.maxBytes - keptBytes;
          if (remaining > 0) {
            const segment = bufferChunk.length > remaining ? bufferChunk.subarray(0, remaining) : bufferChunk;
            chunks.push(segment);
            keptBytes += segment.length;
          } else {
            truncatedByBytes = true;
          }
          if (totalBytes > input.maxBytes) {
            truncatedByBytes = true;
          }
        });
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers ?? {})) {
            headers[String(key).toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value ?? "");
          }
          resolve({
            statusCode: typeof res.statusCode === "number" ? res.statusCode : 0,
            headers,
            bodyBuffer: Buffer.concat(chunks),
            truncatedByBytes
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

function isRedirectStatus(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function safeResolveRedirect(currentUrl: URL, location: string): URL | undefined {
  try {
    const next = new URL(location, currentUrl);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      return undefined;
    }
    return next;
  } catch {
    return undefined;
  }
}

function dropBodyHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  delete next["content-length"];
  delete next["content-type"];
  return next;
}

function readHttpExtractMode(value: unknown): "none" | "auto" | "readable" {
  if (value === "none" || value === "readable") {
    return value;
  }
  return "auto";
}

function decodeHttpBody(buffer: any, headers: Record<string, string>, finalUrl: string): string {
  const contentEncoding = normalizeEncoding(headers["content-encoding"]);
  const uncompressed = decompressBody(buffer, contentEncoding);
  const charset = resolveCharset(headers["content-type"], uncompressed);
  const decoded = decodeBufferWithCharset(uncompressed, charset);
  if (decoded.length > 0) {
    return decoded;
  }
  return `(${finalUrl})`;
}

function normalizeEncoding(value: string | undefined): "identity" | "gzip" | "deflate" | "br" {
  if (!value) {
    return "identity";
  }
  const first = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .find((item) => item.length > 0);
  if (first === "gzip") {
    return "gzip";
  }
  if (first === "deflate") {
    return "deflate";
  }
  if (first === "br") {
    return "br";
  }
  return "identity";
}

function decompressBody(buffer: any, encoding: "identity" | "gzip" | "deflate" | "br"): any {
  try {
    if (encoding === "gzip") {
      return gunzipSync(buffer);
    }
    if (encoding === "deflate") {
      return inflateSync(buffer);
    }
    if (encoding === "br") {
      return brotliDecompressSync(buffer);
    }
    return buffer;
  } catch {
    return buffer;
  }
}

function resolveCharset(contentType: string | undefined, bodyBuffer: any): string | undefined {
  const headerCharset = readCharsetFromContentType(contentType);
  if (headerCharset) {
    return headerCharset;
  }
  const sample = bodyBuffer.subarray(0, Math.min(bodyBuffer.length, 4096)).toString("utf8");
  const metaCharset =
    readFirstMatch(sample, /<meta[^>]+charset=["']?\s*([a-zA-Z0-9._-]+)/i) ??
    readFirstMatch(sample, /<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9._-]+)/i);
  return normalizeCharset(metaCharset);
}

function readCharsetFromContentType(contentType: string | undefined): string | undefined {
  if (!contentType) {
    return undefined;
  }
  const match = /charset\s*=\s*([a-zA-Z0-9._-]+)/i.exec(contentType);
  return normalizeCharset(match?.[1]);
}

function normalizeCharset(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "utf8") {
    return "utf-8";
  }
  if (normalized === "gb2312") {
    return "gbk";
  }
  if (normalized === "x-gbk") {
    return "gbk";
  }
  return normalized;
}

function decodeBufferWithCharset(buffer: any, charset: string | undefined): string {
  if (!charset || charset === "utf-8" || charset === "utf8") {
    return buffer.toString("utf8");
  }
  try {
    const decoderCtor = (globalThis as { TextDecoder?: new (label?: string, options?: { fatal?: boolean }) => { decode(input: any): string } })
      .TextDecoder;
    if (decoderCtor) {
      const decoder = new decoderCtor(charset, { fatal: false });
      return decoder.decode(buffer);
    }
  } catch {
    // fallback to utf8
  }
  return buffer.toString("utf8");
}

function maybeExtractReadableHtml(input: {
  html: string;
  contentType?: string;
  mode: "auto" | "readable";
}): { title?: string; description?: string; text: string; likelyDynamicPage: boolean; hint?: string } | undefined {
  const contentType = (input.contentType ?? "").toLowerCase();
  const isHtmlContent =
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml") ||
    /^\s*</.test(input.html.trim());
  if (!isHtmlContent) {
    return undefined;
  }

  const title =
    decodeHtmlEntities(readFirstMatch(input.html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? "") || undefined;
  const description =
    decodeHtmlEntities(
      readFirstMatch(input.html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
        readFirstMatch(input.html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
        ""
    ) || undefined;

  const bodyCandidate =
    readFirstMatch(input.html, /<article[\s\S]*?<\/article>/i) ??
    readFirstMatch(input.html, /<main[\s\S]*?<\/main>/i) ??
    readFirstMatch(input.html, /<body[\s\S]*?<\/body>/i) ??
    input.html;

  const stripped = htmlToPlainText(bodyCandidate);
  const likelyDynamicPage = isLikelyDynamicShell(input.html, stripped);
  if (input.mode === "auto" && stripped.length === 0 && !title && !description) {
    return undefined;
  }
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    text: stripped,
    likelyDynamicPage,
    ...(likelyDynamicPage
      ? {
          hint: "Page appears JS-rendered (SPA shell). Static HTTP fetch may miss full content; use a browser-rendered fetch path."
        }
      : {})
  };
}

function htmlToPlainText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<template[\s\S]*?<\/template>/gi, " ");
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|li|section|article|main|header|footer|h[1-6]|tr)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  text = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text;
}

function isLikelyDynamicShell(html: string, extractedText: string): boolean {
  const hasSpaRoot = /id=["'](app|root|__next|__nuxt)["']/i.test(html);
  const hasBundleScript = /<script[^>]+(type=["']module["']|src=["'][^"']+\.(js|mjs))/i.test(html);
  const lowText = extractedText.length < 120;
  return hasSpaRoot && hasBundleScript && lowText;
}

function decodeHtmlEntities(input: string): string {
  const namedMap: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (raw, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : raw;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : raw;
    }
    return namedMap[entity] ?? raw;
  });
}

function readFirstMatch(source: string, pattern: RegExp): string | undefined {
  const matched = pattern.exec(source);
  return matched?.[1]?.trim() || undefined;
}

function truncateText(input: string, maxChars: number): { text: string; truncated: boolean } {
  if (input.length <= maxChars) {
    return { text: input, truncated: false };
  }
  return {
    text: `${input.slice(0, maxChars)}\n\n...[truncated ${String(input.length - maxChars)} chars]`,
    truncated: true
  };
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
  if (/^memory\/[A-Za-z0-9._/-]+\.md$/.test(path)) {
    return path;
  }
  if (/^daily\/[A-Za-z0-9._/-]+\.md$/.test(path)) {
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

function resolveEffectiveWorkspaceRoot(baseWorkspaceRoot: string, call: ToolCall, ctx: ToolContext): string {
  const explicitWorkspaceRoot = readNonEmptyString(ctx.workspaceRoot);
  if (explicitWorkspaceRoot) {
    return normalizePath(resolve(explicitWorkspaceRoot));
  }
  const namespaceRoot = resolveEnterpriseNamespaceRoot(baseWorkspaceRoot, call, ctx);
  return namespaceRoot ?? baseWorkspaceRoot;
}

function resolveEnterpriseNamespaceRoot(
  baseWorkspaceRoot: string,
  call: ToolCall,
  ctx: ToolContext
): string | undefined {
  const args = call.args;
  const namespace = readNamespace(args.namespace) ?? (isScopedNamespaceTool(call.name) ? "user" : undefined);
  if (!namespace) {
    return undefined;
  }
  const tenantId = sanitizeScopeSegment(readNonEmptyString(args.tenantId) ?? ctx.tenantId);
  const workspaceId = sanitizeScopeSegment(readNonEmptyString(args.workspaceId) ?? ctx.workspaceId);
  const userId = sanitizeScopeSegment(readNonEmptyString(args.userId) ?? ctx.userId);
  if (!tenantId || !workspaceId) {
    return undefined;
  }
  if (namespace === "user" && !userId) {
    return undefined;
  }
  const storageRoot = normalizePath(
    resolve(readNonEmptyString(process.env?.OPENFOAL_ENTERPRISE_STORAGE_ROOT) ?? baseWorkspaceRoot)
  );
  const resourceType = readResourceType(args.resourceType, call.name);
  const resourceSegment = resourceType === "memory" ? "memory" : "files";
  const scopedRoot =
    namespace === "workspace"
      ? resolve(storageRoot, "tenants", tenantId, "workspaces", workspaceId, "shared", resourceSegment)
      : resolve(storageRoot, "tenants", tenantId, "workspaces", workspaceId, "users", userId!, resourceSegment);
  return normalizePath(scopedRoot);
}

function isScopedNamespaceTool(toolName: string): boolean {
  return toolName.startsWith("memory.") || toolName.startsWith("file.");
}

function readNamespace(value: unknown): "user" | "workspace" | undefined {
  if (value === "user" || value === "workspace") {
    return value;
  }
  return undefined;
}

function readResourceType(value: unknown, toolName: string): "memory" | "files" {
  if (value === "memory" || value === "files") {
    return value;
  }
  return toolName.startsWith("memory.") ? "memory" : "files";
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeScopeSegment(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : undefined;
}

function resolveDailyMemoryPath(args: Record<string, unknown>, date: string): string {
  const namespace = readNamespace(args.namespace);
  if (namespace) {
    return `daily/${date}.md`;
  }
  return `memory/${date}.md`;
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

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}
