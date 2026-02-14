export type RuntimeMode = "local" | "cloud";
export type SyncState = "local_only" | "syncing" | "synced" | "conflict";
export type PolicyDecision = "deny" | "allow";

type GatewayMethod =
  | "connect"
  | "sessions.list"
  | "policy.get"
  | "audit.query"
  | "metrics.summary";

interface RpcRequestFrame {
  type: "req";
  id: string;
  method: GatewayMethod;
  params: Record<string, unknown>;
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
  error: {
    code: string;
    message: string;
  };
}

type RpcResponse = RpcResponseSuccess | RpcResponseFailure;

interface RpcEvent {
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

const SIDE_EFFECT_METHODS = new Set<GatewayMethod>();

export type GatewaySession = {
  id: string;
  sessionKey: string;
  title: string;
  preview: string;
  runtimeMode: RuntimeMode;
  syncState: SyncState;
  contextUsage: number;
  compactionCount: number;
  memoryFlushState: "idle" | "pending" | "flushed" | "skipped";
  memoryFlushAt?: string;
  updatedAt: string;
};

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
  id?: number;
  tenantId?: string;
  workspaceId?: string;
  action?: string;
  actor?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  [key: string]: unknown;
};

export type GatewayAuditQueryParams = {
  tenantId?: string;
  workspaceId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: number;
};

export type GatewayAuditQueryResult = {
  items: GatewayAuditItem[];
  nextCursor?: number;
};

export class GatewayRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayRpcError";
    this.code = code;
  }
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly connectionId: string;
  private accessToken?: string;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private requestCounter = 0;

  constructor(baseUrl = readDefaultBaseUrl()) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.connectionId = createConnectionId();
    this.accessToken = readStoredAccessToken();
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  setAccessToken(token?: string): void {
    this.accessToken = token && token.trim().length > 0 ? token.trim() : undefined;
    this.connected = false;
    persistAccessToken(this.accessToken);
  }

  async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      await this.request("connect", {
        client: {
          name: "web-console",
          version: "0.1.0"
        },
        workspaceId: "w_default",
        ...(this.accessToken
          ? {
              auth: {
                type: "Bearer",
                token: this.accessToken
              }
            }
          : {})
      });
      this.connected = true;
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async listSessions(): Promise<GatewaySession[]> {
    await this.ensureConnected();
    const result = await this.request("sessions.list", {});
    const items = result.response.payload.items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isGatewaySession);
  }

  async getPolicy(scopeKey = "default"): Promise<GatewayPolicy> {
    await this.ensureConnected();
    const result = await this.request("policy.get", { scopeKey });
    const policy = result.response.payload.policy;
    if (!isGatewayPolicy(policy)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid policy.get payload");
    }
    return policy;
  }

  async queryAudit(params: GatewayAuditQueryParams = {}): Promise<GatewayAuditQueryResult> {
    await this.ensureConnected();
    const result = await this.request("audit.query", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      ...(typeof params.cursor === "number" ? { cursor: params.cursor } : {})
    });
    const items = result.response.payload.items;
    const nextCursor = asPositiveInt(result.response.payload.nextCursor);
    return {
      items: Array.isArray(items) ? items.filter(isGatewayAuditItem) : [],
      ...(nextCursor ? { nextCursor } : {})
    };
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

  async login(input: { username: string; password: string; tenant?: string }): Promise<Record<string, unknown>> {
    const endpoint = new URL("/auth/login", this.baseUrl);
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        ...(input.tenant ? { tenant: input.tenant } : {})
      })
    });
    const payload = (await safeJson(response)) as Record<string, unknown>;
    if (!response.ok) {
      throw new GatewayRpcError(String(payload.error ?? "HTTP_ERROR"), String(payload.message ?? `HTTP ${response.status}`));
    }
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : undefined;
    if (!accessToken) {
      throw new GatewayRpcError("INVALID_RESPONSE", "auth.login missing access_token");
    }
    this.setAccessToken(accessToken);
    return payload;
  }

  async refresh(refreshToken: string): Promise<Record<string, unknown>> {
    const endpoint = new URL("/auth/refresh", this.baseUrl);
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        refreshToken
      })
    });
    const payload = (await safeJson(response)) as Record<string, unknown>;
    if (!response.ok) {
      throw new GatewayRpcError(String(payload.error ?? "HTTP_ERROR"), String(payload.message ?? `HTTP ${response.status}`));
    }
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : undefined;
    if (!accessToken) {
      throw new GatewayRpcError("INVALID_RESPONSE", "auth.refresh missing access_token");
    }
    this.setAccessToken(accessToken);
    return payload;
  }

  async me(): Promise<Record<string, unknown>> {
    if (!this.accessToken) {
      throw new GatewayRpcError("AUTH_REQUIRED", "No access token");
    }
    const endpoint = new URL("/auth/me", this.baseUrl);
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${this.accessToken}`
      }
    });
    const payload = (await safeJson(response)) as Record<string, unknown>;
    if (!response.ok) {
      throw new GatewayRpcError(String(payload.error ?? "HTTP_ERROR"), String(payload.message ?? `HTTP ${response.status}`));
    }
    return payload;
  }

  async logout(refreshToken?: string): Promise<void> {
    const endpoint = new URL("/auth/logout", this.baseUrl);
    await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {})
      },
      body: JSON.stringify({
        ...(refreshToken ? { refreshToken } : {})
      })
    });
    this.setAccessToken(undefined);
  }

  private async request(method: GatewayMethod, params: Record<string, unknown>): Promise<RpcSuccessEnvelope> {
    const id = `r_${++this.requestCounter}`;
    const req: RpcRequestFrame = {
      type: "req",
      id,
      method,
      params: SIDE_EFFECT_METHODS.has(method) ? { ...params } : params
    };

    const endpoint = new URL("/rpc", this.baseUrl);
    endpoint.searchParams.set("connectionId", this.connectionId);

    let response: Response;
    try {
      response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {})
        },
        body: JSON.stringify(req)
      });
    } catch (error) {
      throw new GatewayRpcError("NETWORK_ERROR", toErrorMessage(error));
    }

    if (!response.ok) {
      throw new GatewayRpcError("HTTP_ERROR", `HTTP ${response.status}`);
    }

    const payload = (await response.json()) as Partial<RpcEnvelope>;
    if (!isRpcEnvelope(payload)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid gateway response");
    }
    if (!payload.response.ok) {
      throw new GatewayRpcError(payload.response.error.code, payload.response.error.message);
    }
    return {
      response: payload.response,
      events: payload.events
    };
  }
}

let singletonClient: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (singletonClient) {
    return singletonClient;
  }
  singletonClient = new GatewayClient();
  return singletonClient;
}

function readDefaultBaseUrl(): string {
  const runtime = readRuntimeGatewayBaseUrl();
  if (runtime) {
    return runtime;
  }

  const raw = import.meta.env.VITE_GATEWAY_BASE_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }

  if (typeof window !== "undefined" && typeof window.location?.origin === "string") {
    const origin = window.location.origin.trim();
    if (origin.startsWith("http://") || origin.startsWith("https://")) {
      return origin;
    }
  }

  return "http://127.0.0.1:8787";
}

function readRuntimeGatewayBaseUrl(): string | undefined {
  const config = (globalThis as { __OPENFOAL_CONFIG__?: { gatewayBaseUrl?: unknown } }).__OPENFOAL_CONFIG__;
  const value = typeof config?.gatewayBaseUrl === "string" ? config.gatewayBaseUrl.trim() : "";
  return value.length > 0 ? value : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function createConnectionId(): string {
  return `console_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function isRpcEnvelope(value: Partial<RpcEnvelope>): value is RpcEnvelope {
  return Boolean(value.response && typeof value.response === "object" && Array.isArray(value.events));
}

function isGatewaySession(value: unknown): value is GatewaySession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.sessionKey === "string" &&
    typeof item.title === "string" &&
    typeof item.preview === "string" &&
    (item.runtimeMode === "local" || item.runtimeMode === "cloud") &&
    (item.syncState === "local_only" || item.syncState === "syncing" || item.syncState === "synced" || item.syncState === "conflict") &&
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

function isPolicyDecision(value: unknown): value is PolicyDecision {
  return value === "deny" || value === "allow";
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function safeJson(response: Response): Promise<unknown> {
  return response
    .json()
    .catch(() => ({}));
}

function readStoredAccessToken(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const token = window.localStorage.getItem("openfoal_access_token");
  return token && token.trim().length > 0 ? token.trim() : undefined;
}

function persistAccessToken(token?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!token) {
    window.localStorage.removeItem("openfoal_access_token");
    return;
  }
  window.localStorage.setItem("openfoal_access_token", token);
}
