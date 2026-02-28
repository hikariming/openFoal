// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpRequest } from "node:http";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpsRequest } from "node:https";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { ToolExecutionHooks, ToolResult } from "../types.js";
import { fail, toErrorMessage, toPositiveInt } from "../utils.js";

declare const Buffer: any;

export async function executeHttpRequest(
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
