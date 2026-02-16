export type RuntimeMode = "local" | "cloud";

type GatewayMethod =
  | "connect"
  | "agent.run"
  | "agent.abort"
  | "runtime.setMode"
  | "sessions.create"
  | "sessions.list"
  | "sessions.get"
  | "sessions.history"
  | "policy.get"
  | "policy.update"
  | "audit.query"
  | "metrics.summary"
  | "memory.get"
  | "memory.search"
  | "memory.appendDaily"
  | "memory.archive";

type ErrorCode =
  | "AUTH_REQUIRED"
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "METHOD_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "SESSION_BUSY"
  | "POLICY_DENIED"
  | "MODEL_UNAVAILABLE"
  | "TOOL_EXEC_FAILED"
  | "INTERNAL_ERROR";

interface RpcRequestFrame {
  type: "req";
  id: string;
  method: GatewayMethod;
  params: Record<string, unknown>;
}

interface RpcError {
  code: ErrorCode;
  message: string;
}

interface RpcResponseSuccess {
  type: "res";
  id: string;
  ok: true;
  payload: Record<string, unknown>;
}

interface RpcResponseFailure {
  type: "res";
  id: string;
  ok: false;
  error: RpcError;
}

type RpcResponse = RpcResponseSuccess | RpcResponseFailure;

export interface RpcEvent {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
  seq: number;
  stateVersion: number;
}

interface RpcEnvelope {
  response: RpcResponse;
  events: RpcEvent[];
}

interface RpcSuccessEnvelope {
  response: RpcResponseSuccess;
  events: RpcEvent[];
}

export class GatewayRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayRpcError";
    this.code = code;
  }
}

interface GatewayClientOptions {
  baseUrl?: string;
  connectionId?: string;
}

type RuntimeScope = {
  tenantId?: string;
  workspaceId?: string;
  userId?: string;
  agentId?: string;
  actor?: string;
};

const SIDE_EFFECT_METHODS = new Set<GatewayMethod>([
  "agent.run",
  "agent.abort",
  "runtime.setMode",
  "sessions.create",
  "policy.update",
  "memory.appendDaily",
  "memory.archive"
]);

export type MemoryFlushState = "idle" | "pending" | "flushed" | "skipped";

export type GatewaySession = {
  id: string;
  sessionKey: string;
  title: string;
  preview: string;
  runtimeMode: RuntimeMode;
  syncState: string;
  contextUsage: number;
  compactionCount: number;
  memoryFlushState: MemoryFlushState;
  memoryFlushAt?: string;
  updatedAt: string;
};

export type GatewayTranscriptItem = {
  id: number;
  sessionId: string;
  runId?: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PolicyDecision = "deny" | "allow";

export type GatewayPolicy = {
  scopeKey: string;
  toolDefault: PolicyDecision;
  highRisk: PolicyDecision;
  bashMode: "sandbox" | "host";
  tools: Record<string, PolicyDecision>;
  version: number;
  updatedAt: string;
};

export type GatewayMetricsSummary = {
  runsTotal: number;
  runsFailed: number;
  toolCallsTotal: number;
  toolFailures: number;
  p95LatencyMs: number;
};

export type GatewayAuditItem = {
  id?: string;
  action?: string;
  actor?: string;
  resource?: string;
  createdAt?: string;
  [key: string]: unknown;
};

export type GatewayMemoryReadResult = {
  path: string;
  from: number;
  lines: number | null;
  totalLines: number;
  text: string;
};

export type GatewayMemoryAppendResult = {
  path: string;
  append: boolean;
  bytes: number;
  includeLongTerm: boolean;
};

export type GatewayMemorySearchHit = {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  source: "memory";
};

export type GatewayMemorySearchResult = {
  results: GatewayMemorySearchHit[];
  mode: "hybrid" | "keyword" | "contains";
  provider?: "openai" | "gemini" | "voyage";
  model?: string;
  indexStats: {
    files: number;
    chunks: number;
    lastSyncAt?: string;
  };
};

export type GatewayMemoryArchiveResult = {
  date: string;
  dailyPath: string;
  includeLongTerm: boolean;
  clearDaily: boolean;
  archivedLines: number;
  archivedBytes: number;
};

export interface RunAgentParams {
  sessionId: string;
  input: string;
  runtimeMode: RuntimeMode;
  llm?: {
    modelRef?: string;
    provider?: string;
    modelId?: string;
    apiKey?: string;
    baseUrl?: string;
  };
}

export interface RunAgentStreamHandlers {
  onEvent?: (event: RpcEvent) => void;
}

export class GatewayHttpClient {
  private readonly baseUrl: string;
  private readonly connectionId: string;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private requestCounter = 0;
  private lastAccessToken?: string;

  constructor(options: GatewayClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? readDefaultBaseUrl());
    this.connectionId = options.connectionId ?? createConnectionId();
  }

  async ensureConnected(): Promise<void> {
    const currentAccessToken = resolveRuntimeAccessToken();
    if (this.connected && currentAccessToken !== this.lastAccessToken) {
      this.connected = false;
    }

    if (this.connected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      const runtimeScope = readRuntimeScope();
      const accessToken = currentAccessToken;
      await this.request("connect", {
        client: {
          name: "desktop",
          version: "0.1.0"
        },
        workspaceId: runtimeScope.workspaceId ?? "w_default",
        ...(accessToken
          ? {
              auth: {
                type: "Bearer",
                token: accessToken
              }
            }
          : {})
      });
      this.connected = true;
      this.lastAccessToken = accessToken;
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async listSessions(): Promise<GatewaySession[]> {
    await this.ensureConnected();
    const result = await this.request("sessions.list", withRuntimeScope({}));
    const items = result.response.payload.items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isGatewaySession);
  }

  async createSession(params?: { title?: string; runtimeMode?: RuntimeMode }): Promise<GatewaySession> {
    await this.ensureConnected();
    const result = await this.request("sessions.create", {
      ...withRuntimeScope({}),
      ...(params?.title ? { title: params.title } : {}),
      ...(params?.runtimeMode ? { runtimeMode: params.runtimeMode } : {})
    });
    const session = result.response.payload.session;
    if (!isGatewaySession(session)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid sessions.create payload");
    }
    return session;
  }

  async getSession(sessionId: string): Promise<GatewaySession | null> {
    await this.ensureConnected();
    const result = await this.request("sessions.get", withRuntimeScope({ sessionId }));
    const session = result.response.payload.session;
    if (session == null) {
      return null;
    }
    if (!isGatewaySession(session)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid sessions.get payload");
    }
    return session;
  }

  async getSessionHistory(params: {
    sessionId: string;
    limit?: number;
    beforeId?: number;
  }): Promise<GatewayTranscriptItem[]> {
    await this.ensureConnected();
    const result = await this.request("sessions.history", {
      ...withRuntimeScope({}),
      sessionId: params.sessionId,
      ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      ...(typeof params.beforeId === "number" ? { beforeId: params.beforeId } : {})
    });
    const items = result.response.payload.items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isGatewayTranscriptItem);
  }

  async setRuntimeMode(
    sessionId: string,
    runtimeMode: RuntimeMode
  ): Promise<{ sessionId: string; runtimeMode: RuntimeMode; status: string; effectiveOn?: string }> {
    await this.ensureConnected();
    const result = await this.request("runtime.setMode", {
      ...withRuntimeScope({}),
      sessionId,
      runtimeMode
    });
    return {
      sessionId: asString(result.response.payload.sessionId) ?? sessionId,
      runtimeMode: asRuntimeMode(result.response.payload.runtimeMode) ?? runtimeMode,
      status: asString(result.response.payload.status) ?? "applied",
      ...(asString(result.response.payload.effectiveOn) ? { effectiveOn: asString(result.response.payload.effectiveOn) } : {})
    };
  }

  async getPolicy(scopeKey = "default"): Promise<GatewayPolicy> {
    await this.ensureConnected();
    const result = await this.request("policy.get", {
      scopeKey
    });
    const policy = result.response.payload.policy;
    if (!isGatewayPolicy(policy)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid policy.get payload");
    }
    return policy;
  }

  async updatePolicy(
    patch: {
      toolDefault?: PolicyDecision;
      highRisk?: PolicyDecision;
      bashMode?: "sandbox" | "host";
      tools?: Record<string, PolicyDecision>;
    },
    scopeKey = "default"
  ): Promise<GatewayPolicy> {
    await this.ensureConnected();
    const result = await this.request("policy.update", {
      scopeKey,
      patch
    });
    const policy = result.response.payload.policy;
    if (!isGatewayPolicy(policy)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid policy.update payload");
    }
    return policy;
  }

  async queryAudit(params: {
    from?: string;
    to?: string;
    limit?: number;
  } = {}): Promise<GatewayAuditItem[]> {
    await this.ensureConnected();
    const result = await this.request("audit.query", {
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      ...(typeof params.limit === "number" ? { limit: params.limit } : {})
    });
    const items = result.response.payload.items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isGatewayAuditItem);
  }

  async getMetricsSummary(): Promise<GatewayMetricsSummary> {
    await this.ensureConnected();
    const result = await this.request("metrics.summary", {});
    const metrics = result.response.payload.metrics;
    if (!isGatewayMetricsSummary(metrics)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid metrics.summary payload");
    }
    return metrics;
  }

  async memoryGet(params: { path?: string; from?: number; lines?: number } = {}): Promise<GatewayMemoryReadResult> {
    await this.ensureConnected();
    const result = await this.request("memory.get", {
      ...withRuntimeScope({}),
      ...(params.path ? { path: params.path } : {}),
      ...(typeof params.from === "number" ? { from: params.from } : {}),
      ...(typeof params.lines === "number" ? { lines: params.lines } : {})
    });
    const memory = result.response.payload.memory;
    if (!isGatewayMemoryReadResult(memory)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid memory.get payload");
    }
    return memory;
  }

  async memorySearch(params: {
    query: string;
    maxResults?: number;
    minScore?: number;
  }): Promise<GatewayMemorySearchResult> {
    await this.ensureConnected();
    const result = await this.request("memory.search", {
      ...withRuntimeScope({}),
      query: params.query,
      ...(typeof params.maxResults === "number" ? { maxResults: params.maxResults } : {}),
      ...(typeof params.minScore === "number" ? { minScore: params.minScore } : {})
    });
    const search = result.response.payload.search;
    if (!isGatewayMemorySearchResult(search)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid memory.search payload");
    }
    return search;
  }

  async memoryAppendDaily(params: {
    content: string;
    date?: string;
    includeLongTerm?: boolean;
  }): Promise<GatewayMemoryAppendResult> {
    await this.ensureConnected();
    const result = await this.request("memory.appendDaily", {
      ...withRuntimeScope({}),
      content: params.content,
      ...(params.date ? { date: params.date } : {}),
      ...(params.includeLongTerm === true ? { includeLongTerm: true } : {})
    });
    const append = result.response.payload.result;
    if (!isGatewayMemoryAppendResult(append)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid memory.appendDaily payload");
    }
    return append;
  }

  async memoryArchive(params: {
    date?: string;
    includeLongTerm?: boolean;
    clearDaily?: boolean;
  }): Promise<GatewayMemoryArchiveResult> {
    await this.ensureConnected();
    const result = await this.request("memory.archive", {
      ...withRuntimeScope({}),
      ...(params.date ? { date: params.date } : {}),
      ...(params.includeLongTerm === false ? { includeLongTerm: false } : {}),
      ...(params.clearDaily === false ? { clearDaily: false } : {})
    });
    const archive = result.response.payload.result;
    if (!isGatewayMemoryArchiveResult(archive)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid memory.archive payload");
    }
    return archive;
  }

  async runAgent(params: RunAgentParams): Promise<{ runId?: string; events: RpcEvent[] }> {
    await this.ensureConnected();
    const result = await this.request("agent.run", withRuntimeRunScope({
      sessionId: params.sessionId,
      input: params.input,
      runtimeMode: params.runtimeMode,
      ...(params.llm ? { llm: params.llm } : {})
    }));
    const runId = asString(result.response.payload.runId);
    return {
      runId,
      events: result.events
    };
  }

  async runAgentStream(
    params: RunAgentParams,
    handlers: RunAgentStreamHandlers = {}
  ): Promise<{ runId?: string; events: RpcEvent[]; transport: "ws" | "http" }> {
    if (!shouldUseWebSocket()) {
      const fallback = await this.runAgent(params);
      for (const event of fallback.events) {
        handlers.onEvent?.(event);
      }
      return {
        ...fallback,
        transport: "http"
      };
    }

    try {
      const wsResult = await this.runAgentViaWs(params, handlers);
      return {
        ...wsResult,
        transport: "ws"
      };
    } catch (error) {
      if (!(error instanceof GatewayWsPreflightError)) {
        throw error;
      }

      const fallback = await this.runAgent(params);
      for (const event of fallback.events) {
        handlers.onEvent?.(event);
      }
      return {
        ...fallback,
        transport: "http"
      };
    }
  }

  private async runAgentViaWs(
    params: RunAgentParams,
    handlers: RunAgentStreamHandlers
  ): Promise<{ runId?: string; events: RpcEvent[] }> {
    if (typeof WebSocket === "undefined") {
      throw new GatewayWsPreflightError("WebSocket is unavailable");
    }

    const wsUrl = toWebSocketUrl(this.baseUrl);
    const ws = await openWebSocket(wsUrl);
    const collectedEvents: RpcEvent[] = [];
    let runRequestSent = false;
    const pending = new Map<
      string,
      {
        resolve: (value: RpcResponse) => void;
        reject: (error: Error) => void;
      }
    >();
    let closed = false;

    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      for (const waiter of pending.values()) {
        waiter.reject(new GatewayRpcError("NETWORK_ERROR", "WebSocket closed"));
      }
      pending.clear();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    ws.onmessage = (msg) => {
      const parsed = parseWsJson(msg.data);
      if (!parsed) {
        return;
      }
      if (isRpcEvent(parsed)) {
        collectedEvents.push(parsed);
        handlers.onEvent?.(parsed);
        return;
      }
      if (isRpcResponse(parsed)) {
        const waiter = pending.get(parsed.id);
        if (!waiter) {
          return;
        }
        pending.delete(parsed.id);
        waiter.resolve(parsed);
      }
    };

    ws.onclose = () => {
      cleanup();
    };

    ws.onerror = () => {
      cleanup();
    };

    const requestOverWs = (method: GatewayMethod, params: Record<string, unknown>): Promise<RpcResponse> => {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new GatewayWsPreflightError("WebSocket is not open");
      }
      const id = `ws_r_${++this.requestCounter}`;
      const frame: RpcRequestFrame = {
        type: "req",
        id,
        method,
        params: SIDE_EFFECT_METHODS.has(method)
          ? {
              ...params,
              idempotencyKey: createIdempotencyKey(method)
            }
          : params
      };

      return new Promise<RpcResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(frame));
      });
    };

    try {
      const connectRes = await requestOverWs("connect", {
        client: {
          name: "desktop",
          version: "0.1.0"
        },
        workspaceId: readRuntimeScope().workspaceId ?? "w_default",
        ...(resolveRuntimeAccessToken()
          ? {
              auth: {
                type: "Bearer",
                token: resolveRuntimeAccessToken()
              }
            }
          : {})
      });
      if (!connectRes.ok) {
        throw new GatewayWsPreflightError(connectRes.error.message);
      }

      runRequestSent = true;
      const runRes = await requestOverWs("agent.run", withRuntimeRunScope({
        sessionId: params.sessionId,
        input: params.input,
        runtimeMode: params.runtimeMode,
        ...(params.llm ? { llm: params.llm } : {})
      }));

      if (!runRes.ok) {
        throw new GatewayRpcError(runRes.error.code, runRes.error.message);
      }

      const runId = asString(runRes.payload.runId);
      cleanup();
      return {
        runId,
        events: collectedEvents
      };
    } catch (error) {
      cleanup();
      if (error instanceof GatewayRpcError) {
        throw error;
      }
      if (runRequestSent) {
        throw new GatewayRpcError("NETWORK_ERROR", toErrorMessage(error));
      }
      throw new GatewayWsPreflightError(toErrorMessage(error));
    }
  }

  async abortRun(runId: string): Promise<void> {
    await this.ensureConnected();
    await this.request("agent.abort", {
      runId
    });
  }

  private async request(method: GatewayMethod, params: Record<string, unknown>): Promise<RpcSuccessEnvelope> {
    const id = `r_${++this.requestCounter}`;
    const req: RpcRequestFrame = {
      type: "req",
      id,
      method,
      params: SIDE_EFFECT_METHODS.has(method)
        ? {
            ...params,
            idempotencyKey: createIdempotencyKey(method)
          }
        : params
    };

    const endpoint = new URL("/rpc", this.baseUrl);
    endpoint.searchParams.set("connectionId", this.connectionId);

    let response: Response;
    try {
      const accessToken = resolveRuntimeAccessToken();
      response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify(req)
      });
    } catch (error) {
      throw new GatewayRpcError("NETWORK_ERROR", toErrorMessage(error));
    }

    if (!response.ok) {
      this.connected = false;
      throw new GatewayRpcError("HTTP_ERROR", `HTTP ${response.status}`);
    }

    const payload = (await response.json()) as Partial<RpcEnvelope>;
    if (!isRpcEnvelope(payload)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid gateway response");
    }
    if (!payload.response.ok) {
      if (payload.response.error.code === "AUTH_REQUIRED" || payload.response.error.code === "UNAUTHORIZED") {
        this.connected = false;
      }
      throw new GatewayRpcError(payload.response.error.code, payload.response.error.message);
    }
    return {
      response: payload.response,
      events: payload.events
    };
  }
}

let singletonClient: GatewayHttpClient | null = null;

export function getGatewayClient(): GatewayHttpClient {
  if (singletonClient) {
    return singletonClient;
  }
  singletonClient = new GatewayHttpClient();
  return singletonClient;
}

class GatewayWsPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayWsPreflightError";
  }
}

function readDefaultBaseUrl(): string {
  const runtimeConfigBaseUrl = readRuntimeConfigBaseUrl();
  if (runtimeConfigBaseUrl) {
    return runtimeConfigBaseUrl;
  }
  const raw = import.meta.env.VITE_GATEWAY_BASE_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return "http://127.0.0.1:8787";
}

function shouldUseWebSocket(): boolean {
  const runtimeConfigValue = readRuntimeConfigUseWebSocket();
  if (typeof runtimeConfigValue === "boolean") {
    return runtimeConfigValue;
  }

  const envValue = import.meta.env.VITE_GATEWAY_USE_WEBSOCKET;
  if (typeof envValue === "string") {
    const normalized = envValue.trim().toLowerCase();
    if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") {
      return false;
    }
    if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") {
      return true;
    }
  }

  return true;
}

function readRuntimeConfigBaseUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const config = (window as { __OPENFOAL_CONFIG__?: unknown }).__OPENFOAL_CONFIG__;
  if (!config || typeof config !== "object") {
    return null;
  }
  const value = (config as { gatewayBaseUrl?: unknown }).gatewayBaseUrl;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function readRuntimeConfigUseWebSocket(): boolean | null {
  if (typeof window === "undefined") {
    return null;
  }
  const config = (window as { __OPENFOAL_CONFIG__?: unknown }).__OPENFOAL_CONFIG__;
  if (!config || typeof config !== "object") {
    return null;
  }
  const value = (config as { gatewayUseWebSocket?: unknown }).gatewayUseWebSocket;
  return typeof value === "boolean" ? value : null;
}

function resolveRuntimeAccessToken(): string | undefined {
  const configToken = readRuntimeConfigToken();
  if (configToken) {
    return configToken;
  }
  if (typeof window === "undefined") {
    return undefined;
  }
  const token = window.localStorage.getItem("openfoal_access_token");
  if (!token) {
    return undefined;
  }
  const normalized = token.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readRuntimeConfigToken(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const config = (window as { __OPENFOAL_CONFIG__?: unknown }).__OPENFOAL_CONFIG__;
  if (!config || typeof config !== "object") {
    return undefined;
  }
  const value = (config as { gatewayAccessToken?: unknown }).gatewayAccessToken;
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readRuntimeScope(): RuntimeScope {
  if (typeof window === "undefined") {
    return {};
  }
  const config = (window as { __OPENFOAL_CONFIG__?: unknown }).__OPENFOAL_CONFIG__;
  if (!config || typeof config !== "object") {
    return {};
  }
  const scopeConfig = config as {
    tenantId?: unknown;
    workspaceId?: unknown;
    userId?: unknown;
    agentId?: unknown;
    actor?: unknown;
  };
  return {
    ...(normalizeOptionalString(scopeConfig.tenantId) ? { tenantId: normalizeOptionalString(scopeConfig.tenantId) } : {}),
    ...(normalizeOptionalString(scopeConfig.workspaceId) ? { workspaceId: normalizeOptionalString(scopeConfig.workspaceId) } : {}),
    ...(normalizeOptionalString(scopeConfig.userId) ? { userId: normalizeOptionalString(scopeConfig.userId) } : {}),
    ...(normalizeOptionalString(scopeConfig.agentId) ? { agentId: normalizeOptionalString(scopeConfig.agentId) } : {}),
    ...(normalizeOptionalString(scopeConfig.actor) ? { actor: normalizeOptionalString(scopeConfig.actor) } : {})
  };
}

function withRuntimeScope(params: Record<string, unknown>): Record<string, unknown> {
  const scope = readRuntimeScope();
  return {
    ...params,
    ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
    ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {})
  };
}

function withRuntimeRunScope(params: Record<string, unknown>): Record<string, unknown> {
  const scope = readRuntimeScope();
  return {
    ...withRuntimeScope(params),
    ...(scope.agentId ? { agentId: scope.agentId } : {}),
    ...(scope.actor ? { actor: scope.actor } : {})
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return normalized;
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      reject(new GatewayWsPreflightError(toErrorMessage(error)));
      return;
    }

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      ws.close();
      reject(new GatewayWsPreflightError("WebSocket open timeout"));
    }, 3000);

    ws.onopen = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(ws);
    };
    ws.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new GatewayWsPreflightError("WebSocket open failed"));
    };
  });
}

function parseWsJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createConnectionId(): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `desktop_${Date.now()}_${rand}`;
}

function createIdempotencyKey(method: GatewayMethod): string {
  return `${method}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
}

function isRpcEnvelope(value: Partial<RpcEnvelope>): value is RpcEnvelope {
  return Boolean(value.response && typeof value.response === "object" && Array.isArray(value.events));
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const frame = value as Partial<RpcResponse>;
  return frame.type === "res" && typeof frame.id === "string" && typeof frame.ok === "boolean";
}

function isRpcEvent(value: unknown): value is RpcEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const frame = value as Partial<RpcEvent>;
  return (
    frame.type === "event" &&
    typeof frame.event === "string" &&
    typeof frame.seq === "number" &&
    typeof frame.stateVersion === "number" &&
    Boolean(frame.payload && typeof frame.payload === "object")
  );
}

function isGatewaySession(value: unknown): value is GatewaySession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.sessionKey === "string" &&
    typeof item.title === "string" &&
    typeof item.preview === "string" &&
    (item.runtimeMode === "local" || item.runtimeMode === "cloud") &&
    typeof item.syncState === "string" &&
    typeof item.contextUsage === "number" &&
    typeof item.compactionCount === "number" &&
    (item.memoryFlushState === "idle" ||
      item.memoryFlushState === "pending" ||
      item.memoryFlushState === "flushed" ||
      item.memoryFlushState === "skipped") &&
    (item.memoryFlushAt === undefined || typeof item.memoryFlushAt === "string") &&
    typeof item.updatedAt === "string"
  );
}

function isGatewayPolicy(value: unknown): value is GatewayPolicy {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.scopeKey === "string" &&
    isPolicyDecision(item.toolDefault) &&
    isPolicyDecision(item.highRisk) &&
    (item.bashMode === "sandbox" || item.bashMode === "host") &&
    Boolean(item.tools && typeof item.tools === "object" && !Array.isArray(item.tools)) &&
    typeof item.version === "number" &&
    typeof item.updatedAt === "string"
  );
}

function isGatewayMetricsSummary(value: unknown): value is GatewayMetricsSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.runsTotal === "number" &&
    typeof item.runsFailed === "number" &&
    typeof item.toolCallsTotal === "number" &&
    typeof item.toolFailures === "number" &&
    typeof item.p95LatencyMs === "number"
  );
}

function isGatewayAuditItem(value: unknown): value is GatewayAuditItem {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isGatewayMemoryReadResult(value: unknown): value is GatewayMemoryReadResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.path === "string" &&
    typeof item.from === "number" &&
    (item.lines === null || typeof item.lines === "number") &&
    typeof item.totalLines === "number" &&
    typeof item.text === "string"
  );
}

function isGatewayMemoryAppendResult(value: unknown): value is GatewayMemoryAppendResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.path === "string" &&
    typeof item.append === "boolean" &&
    typeof item.bytes === "number" &&
    typeof item.includeLongTerm === "boolean"
  );
}

function isGatewayMemorySearchResult(value: unknown): value is GatewayMemorySearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  if (!(item.mode === "hybrid" || item.mode === "keyword" || item.mode === "contains")) {
    return false;
  }
  if (!item.indexStats || typeof item.indexStats !== "object" || Array.isArray(item.indexStats)) {
    return false;
  }
  const stats = item.indexStats as Record<string, unknown>;
  if (typeof stats.files !== "number" || typeof stats.chunks !== "number") {
    return false;
  }
  if (stats.lastSyncAt !== undefined && typeof stats.lastSyncAt !== "string") {
    return false;
  }
  if (item.provider !== undefined && item.provider !== "openai" && item.provider !== "gemini" && item.provider !== "voyage") {
    return false;
  }
  if (item.model !== undefined && typeof item.model !== "string") {
    return false;
  }
  if (!Array.isArray(item.results)) {
    return false;
  }
  return item.results.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const hit = entry as Record<string, unknown>;
    return (
      typeof hit.path === "string" &&
      typeof hit.startLine === "number" &&
      typeof hit.endLine === "number" &&
      typeof hit.snippet === "string" &&
      typeof hit.score === "number" &&
      hit.source === "memory"
    );
  });
}

function isGatewayMemoryArchiveResult(value: unknown): value is GatewayMemoryArchiveResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.date === "string" &&
    typeof item.dailyPath === "string" &&
    typeof item.includeLongTerm === "boolean" &&
    typeof item.clearDaily === "boolean" &&
    typeof item.archivedLines === "number" &&
    typeof item.archivedBytes === "number"
  );
}

function isGatewayTranscriptItem(value: unknown): value is GatewayTranscriptItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "number" &&
    typeof item.sessionId === "string" &&
    (item.runId === undefined || typeof item.runId === "string") &&
    typeof item.event === "string" &&
    Boolean(item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)) &&
    typeof item.createdAt === "string"
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRuntimeMode(value: unknown): RuntimeMode | undefined {
  return value === "local" || value === "cloud" ? value : undefined;
}

function isPolicyDecision(value: unknown): value is PolicyDecision {
  return value === "deny" || value === "allow";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
