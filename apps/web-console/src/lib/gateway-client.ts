export type RuntimeMode = "local" | "cloud";
export type SyncState = "local_only" | "syncing" | "synced" | "conflict";
export type PolicyDecision = "deny" | "allow" | "approval-required";
export type ApprovalStatus = "pending" | "approved" | "rejected";

type GatewayMethod =
  | "connect"
  | "sessions.list"
  | "policy.get"
  | "approval.queue"
  | "approval.resolve"
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

const SIDE_EFFECT_METHODS = new Set<GatewayMethod>(["approval.resolve"]);

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

export type GatewayApproval = {
  approvalId: string;
  sessionId: string;
  runId: string;
  toolName: string;
  toolCallId?: string;
  argsFingerprint: string;
  status: ApprovalStatus;
  decision?: "approve" | "reject";
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
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
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private requestCounter = 0;

  constructor(baseUrl = readDefaultBaseUrl()) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.connectionId = createConnectionId();
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
        workspaceId: "w_default"
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

  async listApprovals(params: {
    status?: ApprovalStatus;
    runId?: string;
    sessionId?: string;
  } = {}): Promise<GatewayApproval[]> {
    await this.ensureConnected();
    const result = await this.request("approval.queue", {
      ...(params.status ? { status: params.status } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {})
    });
    const items = result.response.payload.items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isGatewayApproval);
  }

  async resolveApproval(input: {
    approvalId: string;
    decision: "approve" | "reject";
    reason?: string;
  }): Promise<GatewayApproval> {
    await this.ensureConnected();
    const result = await this.request("approval.resolve", {
      approvalId: input.approvalId,
      decision: input.decision,
      ...(input.reason ? { reason: input.reason } : {})
    });
    const approval = result.response.payload.approval;
    if (!isGatewayApproval(approval)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid approval.resolve payload");
    }
    return approval;
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
      response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json"
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
  const raw = import.meta.env.VITE_GATEWAY_BASE_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return "http://127.0.0.1:8787";
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function createConnectionId(): string {
  return `console_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function createIdempotencyKey(method: GatewayMethod): string {
  return `${method}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
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

function isGatewayApproval(value: unknown): value is GatewayApproval {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.approvalId === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.runId === "string" &&
    typeof item.toolName === "string" &&
    typeof item.argsFingerprint === "string" &&
    (item.status === "pending" || item.status === "approved" || item.status === "rejected") &&
    (item.decision === undefined || item.decision === "approve" || item.decision === "reject") &&
    (item.reason === undefined || typeof item.reason === "string") &&
    (item.toolCallId === undefined || typeof item.toolCallId === "string") &&
    typeof item.createdAt === "string" &&
    (item.resolvedAt === undefined || typeof item.resolvedAt === "string")
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
  return value === "deny" || value === "allow" || value === "approval-required";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
