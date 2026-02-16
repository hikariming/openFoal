// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpRequest } from "node:http";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpsRequest } from "node:https";
import type {
  AgentRepository,
  ExecutionTargetRecord,
  ExecutionTargetRepository
} from "../../../../packages/storage/dist/index.js";
import type { ToolCall, ToolContext, ToolExecutionHooks, ToolResult } from "../../../../packages/tool-executor/dist/index.js";

declare const Buffer: any;

export type DockerRunnerInvokeInput = {
  target: ExecutionTargetRecord;
  call: ToolCall;
  ctx: ToolContext;
  hooks?: ToolExecutionHooks;
};

export type DockerRunnerInvoker = (input: DockerRunnerInvokeInput) => Promise<ToolResult>;

export type CloudFailurePolicy = "deny" | "fallback_local";

export async function resolveExecutionTarget(input: {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  explicitTargetId?: string;
  agentRepo: AgentRepository;
  executionTargetRepo: ExecutionTargetRepository;
}): Promise<ExecutionTargetRecord | undefined> {
  if (input.explicitTargetId) {
    const explicit = await input.executionTargetRepo.get(input.explicitTargetId);
    if (explicit) {
      return explicit;
    }
  }

  const agent = await input.agentRepo.get(input.tenantId, input.workspaceId, input.agentId);
  if (agent?.executionTargetId) {
    const fromAgent = await input.executionTargetRepo.get(agent.executionTargetId);
    if (fromAgent) {
      return fromAgent;
    }
  }

  const fromWorkspaceDefault = await input.executionTargetRepo.findDefault(input.tenantId, input.workspaceId);
  if (fromWorkspaceDefault) {
    return fromWorkspaceDefault;
  }

  return await input.executionTargetRepo.get("target_local_default");
}

export async function invokeDockerRunnerOverHttp(input: DockerRunnerInvokeInput): Promise<ToolResult> {
  const endpoint = resolveDockerRunnerEndpoint(input.target);
  if (!endpoint) {
    return {
      ok: false,
      error: {
        code: "TOOL_EXEC_FAILED",
        message: `docker-runner 缺少 endpoint: ${input.target.targetId}`
      }
    };
  }

  const timeoutMs = resolveDockerRunnerTimeoutMs(input.target.config);
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (input.target.authToken) {
    headers.authorization = `Bearer ${input.target.authToken}`;
  }

  try {
    const response = await sendDockerRunnerRequest({
      endpoint,
      headers,
      body: {
        call: input.call,
        ctx: input.ctx,
        target: {
          targetId: input.target.targetId,
          kind: input.target.kind,
          tenantId: input.target.tenantId,
          workspaceId: input.target.workspaceId
        }
      },
      timeoutMs,
      signal: input.hooks?.signal
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return {
        ok: false,
        error: {
          code: "TOOL_EXEC_FAILED",
          message: `docker-runner 响应异常(${response.statusCode}): ${clipText(response.text, 240)}`
        }
      };
    }

    const parsed = parseJsonObject(response.text);
    if (!parsed) {
      return {
        ok: false,
        error: {
          code: "TOOL_EXEC_FAILED",
          message: `docker-runner 返回非 JSON: ${clipText(response.text, 120)}`
        }
      };
    }

    emitRemoteUpdates(parsed, input.hooks);
    const normalized = normalizeDockerRunnerToolResult(parsed);
    if (normalized) {
      return normalized;
    }

    return {
      ok: false,
      error: {
        code: "TOOL_EXEC_FAILED",
        message: "docker-runner 返回格式不支持"
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "TOOL_EXEC_FAILED",
        message: `docker-runner 调用失败: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }
}

async function sendDockerRunnerRequest(input: {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
  signal?: {
    aborted: boolean;
    addEventListener?(type: "abort", listener: () => void, options?: { once?: boolean }): void;
    removeEventListener?(type: "abort", listener: () => void): void;
  };
}): Promise<{ statusCode: number; text: string }> {
  const url = new URL(input.endpoint);
  const payload = JSON.stringify(input.body);
  return await new Promise((resolve, reject) => {
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname || "/"}${url.search || ""}`,
        method: "POST",
        headers: {
          ...input.headers,
          "content-length": String(Buffer.byteLength(payload))
        }
      },
      (res: any) => {
        const chunks: any[] = [];
        res.on("data", (chunk: any) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            statusCode: typeof res.statusCode === "number" ? res.statusCode : 500,
            text: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    req.setTimeout(input.timeoutMs, () => {
      req.destroy(new Error(`timeout after ${input.timeoutMs}ms`));
    });

    const abortHandler = () => {
      req.destroy(new Error("aborted"));
    };
    if (input.signal) {
      if (input.signal.aborted) {
        req.destroy(new Error("aborted"));
      } else {
        input.signal.addEventListener?.("abort", abortHandler, { once: true });
      }
    }

    req.on("error", (error: Error) => {
      if (input.signal) {
        input.signal.removeEventListener?.("abort", abortHandler);
      }
      reject(error);
    });

    req.on("close", () => {
      if (input.signal) {
        input.signal.removeEventListener?.("abort", abortHandler);
      }
    });

    req.write(payload);
    req.end();
  });
}

export function resolveCloudFailurePolicy(
  params: Record<string, unknown>,
  targetConfig: Record<string, unknown>,
  requireString: (params: Record<string, unknown>, key: string) => string | undefined,
  isObjectRecord: (value: unknown) => value is Record<string, unknown>
): CloudFailurePolicy {
  return (
    normalizeCloudFailurePolicy(requireString(params, "cloudFailurePolicy")) ??
    normalizeCloudFailurePolicy(isObjectRecord(targetConfig) ? requireString(targetConfig, "cloudFailurePolicy") : undefined) ??
    "deny"
  );
}

export function normalizeCloudFailurePolicy(value: unknown): CloudFailurePolicy | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "deny") {
    return "deny";
  }
  if (normalized === "fallback_local" || normalized === "fallback-local" || normalized === "fallbacklocal") {
    return "fallback_local";
  }
  return undefined;
}

export async function probeExecutionTargetAvailability(target: ExecutionTargetRecord): Promise<{ ok: boolean; reason?: string }> {
  if (target.kind !== "docker-runner") {
    return { ok: true };
  }
  const endpoint = resolveDockerRunnerEndpoint(target);
  if (!endpoint) {
    return { ok: false, reason: `docker-runner 缺少 endpoint: ${target.targetId}` };
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: `endpoint 非法: ${endpoint}` };
  }
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
  const timeoutMs = Math.max(1_000, Math.min(5_000, resolveDockerRunnerTimeoutMs(target.config)));
  const headers: Record<string, string> = {};
  if (target.authToken) {
    headers.authorization = `Bearer ${target.authToken}`;
  }
  return await new Promise((resolve) => {
    const req = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname || "/"}${url.search || ""}`,
        method: "HEAD",
        headers
      },
      (res: any) => {
        res.resume?.();
        resolve({ ok: true });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on("error", (error: Error) => {
      resolve({
        ok: false,
        reason: error instanceof Error ? error.message : String(error)
      });
    });
    req.end();
  });
}

export function createLocalFallbackExecutionTarget(input: {
  tenantId: string;
  workspaceId: string;
  sourceTargetId: string;
  now: () => Date;
}): ExecutionTargetRecord {
  return {
    targetId: `target_local_fallback_${input.sourceTargetId}`,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    kind: "local-host",
    isDefault: false,
    enabled: true,
    config: {
      fallbackFromTargetId: input.sourceTargetId
    },
    version: 1,
    updatedAt: input.now().toISOString()
  };
}

function resolveDockerRunnerEndpoint(target: ExecutionTargetRecord): string | undefined {
  const direct = typeof target.endpoint === "string" ? target.endpoint.trim() : "";
  if (direct) {
    return direct;
  }
  if (isObjectRecord(target.config)) {
    const fromConfig = requireString(target.config, "endpoint");
    if (fromConfig) {
      return fromConfig;
    }
  }
  return undefined;
}

function resolveDockerRunnerTimeoutMs(config: Record<string, unknown>): number {
  if (isObjectRecord(config) && typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs)) {
    const timeoutMs = Math.floor(config.timeoutMs);
    if (timeoutMs > 0) {
      return Math.min(timeoutMs, 180_000);
    }
  }
  return 15_000;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function emitRemoteUpdates(payload: Record<string, unknown>, hooks?: ToolExecutionHooks): void {
  if (!hooks?.onUpdate) {
    return;
  }

  const updates = Array.isArray(payload.updates) ? payload.updates : [];
  for (const update of updates) {
    if (typeof update === "string") {
      hooks.onUpdate({
        delta: update,
        at: new Date().toISOString()
      });
      continue;
    }
    if (!isObjectRecord(update)) {
      continue;
    }
    const delta = asString(update.delta);
    if (!delta) {
      continue;
    }
    hooks.onUpdate({
      delta,
      at: asString(update.at) ?? new Date().toISOString()
    });
  }
}

function normalizeDockerRunnerToolResult(payload: Record<string, unknown>): ToolResult | undefined {
  const resultPayload = isObjectRecord(payload.result) ? payload.result : payload;
  if (typeof resultPayload.ok !== "boolean") {
    return undefined;
  }

  if (resultPayload.ok) {
    const output = asString(resultPayload.output);
    return {
      ok: true,
      ...(output !== undefined ? { output } : {})
    };
  }

  const error = isObjectRecord(resultPayload.error) ? resultPayload.error : undefined;
  return {
    ok: false,
    error: {
      code: asString(error?.code) ?? "TOOL_EXEC_FAILED",
      message: asString(error?.message) ?? "docker-runner 执行失败"
    }
  };
}

function clipText(input: string, maxLength: number): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

function requireString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
