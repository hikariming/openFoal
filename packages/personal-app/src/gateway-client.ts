export type RuntimeMode = "local" | "cloud";
export type SyncState = "local_only" | "syncing" | "synced" | "conflict";
export type PolicyDecision = "deny" | "allow";
export type UserRole = "tenant_admin" | "workspace_admin" | "member";
export type UserStatus = "active" | "disabled";
export type ExecutionMode = "local_sandbox" | "enterprise_cloud";
export type ContextLayer = "tenant" | "workspace" | "user";
export type ContextFile = "AGENTS.md" | "SOUL.md" | "TOOLS.md" | "USER.md";

export type GatewayPrincipal = {
  subject: string;
  userId: string;
  tenantId: string;
  workspaceIds: string[];
  roles: UserRole[];
  authSource: string;
  displayName?: string;
};

export type GatewaySession = {
  id: string;
  sessionKey: string;
  tenantId: string;
  workspaceId: string;
  ownerUserId: string;
  visibility: "private" | "workspace";
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

export type GatewayTranscriptItem = {
  id: number;
  role: string;
  text: string;
  sessionId?: string;
  runId?: string;
  event: string;
  payload: Record<string, unknown>;
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

export type GatewayPolicy = {
  tenantId: string;
  workspaceId: string;
  scopeKey: string;
  storageBackend?: string;
  toolDefault: PolicyDecision;
  highRisk: PolicyDecision;
  bashMode: "sandbox" | "host";
  tools: Record<string, PolicyDecision>;
  version: number;
  updatedAt: string;
};

export type GatewayPolicyPatch = {
  toolDefault?: PolicyDecision;
  highRisk?: PolicyDecision;
  bashMode?: "sandbox" | "host";
  tools?: Record<string, PolicyDecision>;
};

export type GatewayMetricsSummary = {
  runsTotal: number;
  runsFailed: number;
  toolCallsTotal: number;
  toolFailures: number;
  p95LatencyMs: number;
};

export type GatewaySandboxUsage = {
  available: boolean;
  runtimeMode: RuntimeMode;
  checkedAt: string;
  source?: string;
  reason?: string;
  targetId?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
};

export type GatewayUserMembership = {
  workspaceId: string;
  role: UserRole;
  updatedAt?: string;
};

export type GatewayTenantUser = {
  user: {
    id: string;
    username: string;
    displayName?: string;
    email?: string;
    status: UserStatus;
    source: "local" | "external";
    lastLoginAt?: string;
  };
  tenant: {
    tenantId: string;
    userId: string;
    defaultWorkspaceId: string;
    status: UserStatus;
    updatedAt?: string;
  };
  memberships: GatewayUserMembership[];
};

export type GatewayModelKeyMeta = {
  tenantId: string;
  workspaceId?: string;
  provider: string;
  modelId?: string;
  baseUrl?: string;
  maskedKey: string;
  keyLast4: string;
  updatedBy: string;
  updatedAt: string;
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

export type GatewayAgent = {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  name: string;
  runtimeMode: RuntimeMode;
  executionTargetId?: string;
  policyScopeKey?: string;
  enabled: boolean;
  config: Record<string, unknown>;
  version: number;
  updatedAt: string;
};

export type GatewayExecutionTarget = {
  targetId: string;
  tenantId: string;
  workspaceId?: string;
  kind: "local-host" | "docker-runner";
  endpoint?: string;
  authToken?: string;
  isDefault: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
  version: number;
  updatedAt: string;
};

export type GatewayBudgetPolicy = {
  scopeKey: string;
  tokenDailyLimit: number | null;
  costMonthlyUsdLimit: number | null;
  hardLimit: boolean;
  version: number;
  updatedAt: string;
};

export type GatewayBudgetUsage = {
  scopeKey: string;
  date: string;
  month: string;
  tokensUsedDaily: number;
  costUsdMonthly: number;
  runsRejectedDaily: number;
};

export type GatewayBudgetResult = {
  policy: GatewayBudgetPolicy;
  usage: GatewayBudgetUsage;
};

export type GatewayContextResult = {
  layer: ContextLayer;
  file: ContextFile;
  text: string;
};

export type GatewayInfraHealth = {
  serverTime: string;
  checks: Record<string, unknown>;
};

export type GatewayReconcileResult = {
  uploaded: number;
  scanned: number;
  skipped?: number;
  [key: string]: unknown;
};

type GatewayMethod =
  | "connect"
  | "agent.run"
  | "agent.abort"
  | "runtime.setMode"
  | "sessions.create"
  | "sessions.list"
  | "sessions.get"
  | "sessions.history"
  | "memory.get"
  | "memory.search"
  | "memory.appendDaily"
  | "memory.archive"
  | "agents.list"
  | "agents.upsert"
  | "users.list"
  | "users.create"
  | "users.updateStatus"
  | "users.resetPassword"
  | "users.updateMemberships"
  | "secrets.upsertModelKey"
  | "secrets.getModelKeyMeta"
  | "executionTargets.list"
  | "executionTargets.upsert"
  | "budget.get"
  | "budget.update"
  | "policy.get"
  | "policy.update"
  | "audit.query"
  | "metrics.summary"
  | "sandbox.usage"
  | "context.get"
  | "context.upsert"
  | "infra.health"
  | "infra.storage.reconcile";

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

const SIDE_EFFECT_METHODS = new Set<GatewayMethod>([
  "agent.run",
  "agent.abort",
  "runtime.setMode",
  "sessions.create",
  "memory.appendDaily",
  "memory.archive",
  "agents.upsert",
  "users.create",
  "users.updateStatus",
  "users.resetPassword",
  "users.updateMemberships",
  "secrets.upsertModelKey",
  "executionTargets.upsert",
  "budget.update",
  "policy.update",
  "context.upsert",
  "infra.storage.reconcile"
]);

export class GatewayRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayRpcError";
    this.code = code;
  }
}

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
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  actor?: string;
}

export interface RunAgentStreamHandlers {
  onEvent?: (event: RpcEvent) => void;
}

export interface GatewayClientOptions {
  baseUrl?: string;
  clientName?: string;
  clientVersion?: string;
  connectionIdPrefix?: string;
  accessToken?: string;
  getAccessToken?: () => string | undefined;
  persistAccessToken?: boolean;
  preferWebSocket?: boolean;
  useRuntimeConfig?: boolean;
  useRuntimeToken?: boolean;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  actor?: string;
}

export type PersonalGatewayClientOptions = GatewayClientOptions;

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly connectionId: string;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly accessTokenResolver?: () => string | undefined;
  private readonly persistToken: boolean;
  private readonly preferWebSocket: boolean;
  private readonly useRuntimeConfig: boolean;
  private readonly useRuntimeToken: boolean;
  private readonly defaultTenantId?: string;
  private readonly defaultWorkspaceId?: string;
  private readonly defaultAgentId?: string;
  private readonly defaultActor?: string;
  private accessToken?: string;
  private lastAccessToken?: string;
  private connected = false;
  private connectPromise: Promise<GatewayPrincipal | undefined> | null = null;
  private requestCounter = 0;
  private principal?: GatewayPrincipal;

  constructor(input: GatewayClientOptions | string = {}) {
    const options: GatewayClientOptions = typeof input === "string" ? { baseUrl: input } : input;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? readDefaultBaseUrl());
    this.connectionId = createConnectionId(options.connectionIdPrefix ?? "gateway");
    this.clientName = options.clientName ?? "openfoal-web";
    this.clientVersion = options.clientVersion ?? "0.1.0";
    this.accessTokenResolver = options.getAccessToken;
    this.persistToken = options.persistAccessToken !== false;
    this.preferWebSocket = options.preferWebSocket !== false;
    this.useRuntimeConfig = options.useRuntimeConfig === true;
    this.useRuntimeToken = options.useRuntimeToken === true;
    this.defaultTenantId = normalizeOptionalString(options.tenantId);
    this.defaultWorkspaceId = normalizeOptionalString(options.workspaceId);
    this.defaultAgentId = normalizeOptionalString(options.agentId);
    this.defaultActor = normalizeOptionalString(options.actor);

    this.accessToken = normalizeOptionalString(options.accessToken) ?? (this.persistToken ? readStoredAccessToken() : undefined);
    this.lastAccessToken = this.resolveAccessToken();
  }

  getAccessToken(): string | undefined {
    return this.resolveAccessToken();
  }

  setAccessToken(token?: string): void {
    this.accessToken = normalizeOptionalString(token);
    this.connected = false;
    this.principal = undefined;
    this.lastAccessToken = this.resolveAccessToken();
    if (this.persistToken) {
      persistAccessToken(this.accessToken);
    }
  }

  getPrincipal(): GatewayPrincipal | undefined {
    return this.principal;
  }

  async ensureConnected(): Promise<GatewayPrincipal | undefined> {
    const currentToken = this.resolveAccessToken();
    if (this.connected && currentToken !== this.lastAccessToken) {
      this.connected = false;
      this.principal = undefined;
    }

    if (this.connected) {
      return this.principal;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      const scope = this.resolveScope();
      const result = await this.request("connect", {
        client: {
          name: this.clientName,
          version: this.clientVersion
        },
        workspaceId: scope.workspaceId ?? "w_default",
        ...(currentToken
          ? {
              auth: {
                type: "Bearer",
                token: currentToken
              }
            }
          : {})
      });
      const principal = toGatewayPrincipal(result.response.payload.principal);
      this.principal = principal;
      this.connected = true;
      this.lastAccessToken = currentToken;
      return principal;
    })();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async listSessions(params: { tenantId?: string; workspaceId?: string } = {}): Promise<GatewaySession[]> {
    await this.ensureConnected();
    const result = await this.request("sessions.list", this.withScope(params));
    return readArray(result.response.payload.items).filter(isGatewaySession);
  }

  async createSession(input: {
    title?: string;
    runtimeMode?: RuntimeMode;
    tenantId?: string;
    workspaceId?: string;
    ownerUserId?: string;
    visibility?: "private" | "workspace";
  } = {}): Promise<GatewaySession> {
    await this.ensureConnected();
    const result = await this.request("sessions.create", this.withScope({
      ...(input.title ? { title: input.title } : {}),
      ...(input.runtimeMode ? { runtimeMode: input.runtimeMode } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {})
    }));
    const session = result.response.payload.session;
    if (!isGatewaySession(session)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid sessions.create payload");
    }
    return session;
  }

  async getSession(input: { sessionId: string; tenantId?: string; workspaceId?: string }): Promise<GatewaySession | null> {
    await this.ensureConnected();
    const result = await this.request("sessions.get", this.withScope({
      sessionId: input.sessionId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
    }));
    return isGatewaySession(result.response.payload.session) ? result.response.payload.session : null;
  }

  async getSessionHistory(input: {
    sessionId: string;
    tenantId?: string;
    workspaceId?: string;
    limit?: number;
    beforeId?: number;
  }): Promise<GatewayTranscriptItem[]> {
    await this.ensureConnected();
    const result = await this.request("sessions.history", this.withScope({
      sessionId: input.sessionId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      ...(typeof input.beforeId === "number" ? { beforeId: input.beforeId } : {})
    }));
    return readArray(result.response.payload.items).map((item) => toTranscriptItem(item)).filter(Boolean) as GatewayTranscriptItem[];
  }

  async setRuntimeMode(input: {
    sessionId: string;
    runtimeMode: RuntimeMode;
    tenantId?: string;
    workspaceId?: string;
  }): Promise<{
    sessionId?: string;
    runtimeMode?: RuntimeMode;
    executionMode?: ExecutionMode;
    status?: string;
    effectiveOn?: string;
  }> {
    await this.ensureConnected();
    const result = await this.request("runtime.setMode", this.withScope({
      idempotencyKey: createIdempotencyKey("runtime_set_mode"),
      sessionId: input.sessionId,
      runtimeMode: input.runtimeMode,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
    }));
    return {
      ...(typeof result.response.payload.sessionId === "string" ? { sessionId: result.response.payload.sessionId } : {}),
      ...(result.response.payload.runtimeMode === "local" || result.response.payload.runtimeMode === "cloud"
        ? { runtimeMode: result.response.payload.runtimeMode }
        : {}),
      ...(asExecutionMode(result.response.payload.executionMode) ? { executionMode: asExecutionMode(result.response.payload.executionMode) } : {}),
      ...(typeof result.response.payload.status === "string" ? { status: result.response.payload.status } : {}),
      ...(typeof result.response.payload.effectiveOn === "string" ? { effectiveOn: result.response.payload.effectiveOn } : {})
    };
  }

  async memoryGet(params: { path?: string; from?: number; lines?: number; tenantId?: string; workspaceId?: string } = {}): Promise<GatewayMemoryReadResult> {
    await this.ensureConnected();
    const result = await this.request("memory.get", this.withScope({
      ...(params.path ? { path: params.path } : {}),
      ...(typeof params.from === "number" ? { from: params.from } : {}),
      ...(typeof params.lines === "number" ? { lines: params.lines } : {}),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    }));
    const payload = result.response.payload.result;
    if (!isGatewayMemoryReadResult(payload)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid memory.get payload");
    }
    return payload;
  }

  async memorySearch(params: {
    query: string;
    maxResults?: number;
    mode?: "hybrid" | "keyword" | "contains";
    tenantId?: string;
    workspaceId?: string;
  }): Promise<GatewayMemorySearchResult> {
    await this.ensureConnected();
    const result = await this.request("memory.search", this.withScope({
      query: params.query,
      ...(typeof params.maxResults === "number" ? { maxResults: params.maxResults } : {}),
      ...(params.mode ? { mode: params.mode } : {}),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    }));
    const payload = result.response.payload.result;
    if (!isGatewayMemorySearchResult(payload)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid memory.search payload");
    }
    return payload;
  }

  async memoryAppendDaily(params: {
    content: string;
    date?: string;
    includeLongTerm?: boolean;
    tenantId?: string;
    workspaceId?: string;
  }): Promise<GatewayMemoryAppendResult> {
    await this.ensureConnected();
    const result = await this.request("memory.appendDaily", this.withScope({
      content: params.content,
      ...(params.date ? { date: params.date } : {}),
      ...(typeof params.includeLongTerm === "boolean" ? { includeLongTerm: params.includeLongTerm } : {}),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    }));
    const payload = result.response.payload.result;
    if (!isGatewayMemoryAppendResult(payload)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid memory.appendDaily payload");
    }
    return payload;
  }

  async memoryArchive(params: {
    date?: string;
    includeLongTerm?: boolean;
    clearDaily?: boolean;
    tenantId?: string;
    workspaceId?: string;
  } = {}): Promise<GatewayMemoryArchiveResult> {
    await this.ensureConnected();
    const result = await this.request("memory.archive", this.withScope({
      ...(params.date ? { date: params.date } : {}),
      ...(typeof params.includeLongTerm === "boolean" ? { includeLongTerm: params.includeLongTerm } : {}),
      ...(typeof params.clearDaily === "boolean" ? { clearDaily: params.clearDaily } : {}),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    }));
    const payload = result.response.payload.result;
    if (!isGatewayMemoryArchiveResult(payload)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid memory.archive payload");
    }
    return payload;
  }

  async runAgent(params: RunAgentParams): Promise<{ runId?: string; events: RpcEvent[] }> {
    await this.ensureConnected();
    const result = await this.request("agent.run", this.withRunScope({
      sessionId: params.sessionId,
      input: params.input,
      runtimeMode: params.runtimeMode,
      ...(params.llm ? { llm: params.llm } : {}),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.actor ? { actor: params.actor } : {})
    }));
    return {
      runId: asString(result.response.payload.runId),
      events: result.events
    };
  }

  async runAgentStream(
    params: RunAgentParams,
    handlers: RunAgentStreamHandlers = {}
  ): Promise<{ runId?: string; events: RpcEvent[]; transport: "ws" | "http" }> {
    if (!this.preferWebSocket) {
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

  async abortRun(runId: string, params: { tenantId?: string; workspaceId?: string } = {}): Promise<void> {
    await this.ensureConnected();
    await this.request("agent.abort", this.withScope({
      runId,
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    }));
  }

  async getPolicy(params: { tenantId?: string; workspaceId?: string; scopeKey?: string } = {}): Promise<GatewayPolicy> {
    await this.ensureConnected();
    const result = await this.request("policy.get", this.withScope({
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.scopeKey ? { scopeKey: params.scopeKey } : {})
    }));
    const policy = result.response.payload.policy;
    if (!isGatewayPolicy(policy)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid policy.get payload");
    }
    return policy;
  }

  async updatePolicy(input: {
    patch: GatewayPolicyPatch;
    tenantId?: string;
    workspaceId?: string;
    scopeKey?: string;
  }): Promise<GatewayPolicy> {
    await this.ensureConnected();
    const result = await this.request("policy.update", this.withScope({
      idempotencyKey: createIdempotencyKey("policy_update"),
      patch: input.patch,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.scopeKey ? { scopeKey: input.scopeKey } : {})
    }));
    const policy = result.response.payload.policy;
    if (!isGatewayPolicy(policy)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid policy.update payload");
    }
    return policy;
  }

  async queryAudit(params: GatewayAuditQueryParams = {}): Promise<GatewayAuditQueryResult> {
    await this.ensureConnected();
    const result = await this.request("audit.query", this.withScope({
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      ...(typeof params.cursor === "number" ? { cursor: params.cursor } : {})
    }));
    return {
      items: readArray(result.response.payload.items).filter(isGatewayAuditItem),
      ...(asPositiveInt(result.response.payload.nextCursor) ? { nextCursor: asPositiveInt(result.response.payload.nextCursor) } : {})
    };
  }

  async getMetricsSummary(params: { tenantId?: string; workspaceId?: string; agentId?: string } = {}): Promise<GatewayMetricsSummary> {
    await this.ensureConnected();
    const result = await this.request("metrics.summary", this.withScope({
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {})
    }));
    const metrics = result.response.payload.metrics;
    if (!isGatewayMetricsSummary(metrics)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid metrics.summary payload");
    }
    return metrics;
  }

  async getSandboxUsage(params: { sessionId: string; executionTargetId?: string }): Promise<GatewaySandboxUsage> {
    await this.ensureConnected();
    const result = await this.request("sandbox.usage", this.withScope({
      sessionId: params.sessionId,
      ...(params.executionTargetId ? { executionTargetId: params.executionTargetId } : {})
    }));
    const usage = result.response.payload.usage;
    if (!isGatewaySandboxUsage(usage)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid sandbox.usage payload");
    }
    return usage;
  }

  async listUsers(params: { tenantId?: string; workspaceId?: string } = {}): Promise<GatewayTenantUser[]> {
    await this.ensureConnected();
    const result = await this.request("users.list", this.withScope({
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    }));
    return readArray(result.response.payload.items).filter(isGatewayTenantUser);
  }

  async createUser(input: {
    tenantId?: string;
    username: string;
    password: string;
    displayName?: string;
    email?: string;
    status?: UserStatus;
    memberships: GatewayUserMembership[];
  }): Promise<GatewayTenantUser | null> {
    await this.ensureConnected();
    const result = await this.request("users.create", this.withScope({
      idempotencyKey: createIdempotencyKey("users_create"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      username: input.username,
      password: input.password,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.status ? { status: input.status } : {}),
      memberships: input.memberships.map((item) => ({ workspaceId: item.workspaceId, role: item.role }))
    }));
    return isGatewayTenantUser(result.response.payload.user) ? result.response.payload.user : null;
  }

  async updateUserStatus(input: { tenantId?: string; userId: string; status: UserStatus }): Promise<void> {
    await this.ensureConnected();
    await this.request("users.updateStatus", this.withScope({
      idempotencyKey: createIdempotencyKey("users_update_status"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      userId: input.userId,
      status: input.status
    }));
  }

  async resetUserPassword(input: { tenantId?: string; userId: string; newPassword: string }): Promise<void> {
    await this.ensureConnected();
    await this.request("users.resetPassword", this.withScope({
      idempotencyKey: createIdempotencyKey("users_reset_password"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      userId: input.userId,
      newPassword: input.newPassword
    }));
  }

  async updateUserMemberships(input: {
    tenantId?: string;
    userId: string;
    memberships: GatewayUserMembership[];
  }): Promise<GatewayUserMembership[]> {
    await this.ensureConnected();
    const result = await this.request("users.updateMemberships", this.withScope({
      idempotencyKey: createIdempotencyKey("users_update_memberships"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      userId: input.userId,
      memberships: input.memberships.map((item) => ({ workspaceId: item.workspaceId, role: item.role }))
    }));
    return readArray(result.response.payload.memberships).filter(isGatewayUserMembership);
  }

  async upsertModelKey(input: {
    tenantId?: string;
    workspaceId?: string;
    provider: string;
    apiKey: string;
    modelId?: string;
    baseUrl?: string;
  }): Promise<GatewayModelKeyMeta | null> {
    await this.ensureConnected();
    const result = await this.request("secrets.upsertModelKey", this.withScope({
      idempotencyKey: createIdempotencyKey("secrets_upsert_model_key"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      provider: input.provider,
      apiKey: input.apiKey,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {})
    }));
    return isGatewayModelKeyMeta(result.response.payload.secret) ? result.response.payload.secret : null;
  }

  async getModelKeyMeta(params: { tenantId?: string; workspaceId?: string; provider?: string } = {}): Promise<GatewayModelKeyMeta[]> {
    await this.ensureConnected();
    const result = await this.request("secrets.getModelKeyMeta", this.withScope({
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.provider ? { provider: params.provider } : {})
    }));
    return readArray(result.response.payload.items).filter(isGatewayModelKeyMeta);
  }

  async listAgents(params: { tenantId?: string; workspaceId?: string } = {}): Promise<GatewayAgent[]> {
    await this.ensureConnected();
    const result = await this.request("agents.list", this.withScope({
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    }));
    return readArray(result.response.payload.items).filter(isGatewayAgent);
  }

  async upsertAgent(input: {
    tenantId?: string;
    workspaceId?: string;
    agentId: string;
    name?: string;
    runtimeMode?: RuntimeMode;
    executionTargetId?: string;
    policyScopeKey?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }): Promise<GatewayAgent | null> {
    await this.ensureConnected();
    const result = await this.request("agents.upsert", this.withScope({
      idempotencyKey: createIdempotencyKey("agents_upsert"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      agentId: input.agentId,
      ...(input.name ? { name: input.name } : {}),
      ...(input.runtimeMode ? { runtimeMode: input.runtimeMode } : {}),
      ...(input.executionTargetId ? { executionTargetId: input.executionTargetId } : {}),
      ...(input.policyScopeKey ? { policyScopeKey: input.policyScopeKey } : {}),
      ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
      ...(input.config ? { config: input.config } : {})
    }));
    return isGatewayAgent(result.response.payload.agent) ? result.response.payload.agent : null;
  }

  async listExecutionTargets(params: { tenantId?: string; workspaceId?: string } = {}): Promise<GatewayExecutionTarget[]> {
    await this.ensureConnected();
    const result = await this.request("executionTargets.list", this.withScope({
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    }));
    return readArray(result.response.payload.items).filter(isGatewayExecutionTarget);
  }

  async upsertExecutionTarget(input: {
    tenantId?: string;
    workspaceId?: string;
    targetId: string;
    kind: "local-host" | "docker-runner";
    endpoint?: string;
    authToken?: string;
    isDefault?: boolean;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }): Promise<GatewayExecutionTarget | null> {
    await this.ensureConnected();
    const result = await this.request("executionTargets.upsert", this.withScope({
      idempotencyKey: createIdempotencyKey("targets_upsert"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      targetId: input.targetId,
      kind: input.kind,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.authToken ? { authToken: input.authToken } : {}),
      ...(typeof input.isDefault === "boolean" ? { isDefault: input.isDefault } : {}),
      ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
      ...(input.config ? { config: input.config } : {})
    }));
    return isGatewayExecutionTarget(result.response.payload.target) ? result.response.payload.target : null;
  }

  async getBudget(params: { scopeKey?: string; date?: string } = {}): Promise<GatewayBudgetResult> {
    await this.ensureConnected();
    const result = await this.request("budget.get", this.withScope({
      ...(params.scopeKey ? { scopeKey: params.scopeKey } : {}),
      ...(params.date ? { date: params.date } : {})
    }));
    const policy = result.response.payload.policy;
    const usage = result.response.payload.usage;
    if (!isGatewayBudgetPolicy(policy) || !isGatewayBudgetUsage(usage)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid budget.get payload");
    }
    return { policy, usage };
  }

  async updateBudget(input: {
    scopeKey?: string;
    tokenDailyLimit?: number | null;
    costMonthlyUsdLimit?: number | null;
    hardLimit?: boolean;
    tenantId?: string;
    workspaceId?: string;
  }): Promise<GatewayBudgetResult> {
    await this.ensureConnected();
    const patch: Record<string, unknown> = {
      ...(input.tokenDailyLimit !== undefined ? { tokenDailyLimit: input.tokenDailyLimit } : {}),
      ...(input.costMonthlyUsdLimit !== undefined ? { costMonthlyUsdLimit: input.costMonthlyUsdLimit } : {}),
      ...(input.hardLimit !== undefined ? { hardLimit: input.hardLimit } : {})
    };
    const result = await this.request("budget.update", this.withScope({
      idempotencyKey: createIdempotencyKey("budget_update"),
      ...(input.scopeKey ? { scopeKey: input.scopeKey } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      patch
    }));
    const policy = result.response.payload.policy;
    const usage = result.response.payload.usage;
    if (!isGatewayBudgetPolicy(policy) || !isGatewayBudgetUsage(usage)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid budget.update payload");
    }
    return { policy, usage };
  }

  async getContext(input: {
    layer: ContextLayer;
    file: ContextFile;
    tenantId?: string;
    workspaceId?: string;
    userId?: string;
  }): Promise<GatewayContextResult> {
    await this.ensureConnected();
    const result = await this.request("context.get", this.withScope({
      layer: input.layer,
      file: input.file,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.userId ? { userId: input.userId } : {})
    }));
    const context = result.response.payload.context;
    if (!isGatewayContextResult(context)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid context.get payload");
    }
    return context;
  }

  async upsertContext(input: {
    layer: ContextLayer;
    file: ContextFile;
    content: string;
    tenantId?: string;
    workspaceId?: string;
    userId?: string;
  }): Promise<GatewayContextResult> {
    await this.ensureConnected();
    const result = await this.request("context.upsert", this.withScope({
      idempotencyKey: createIdempotencyKey("context_upsert"),
      layer: input.layer,
      file: input.file,
      content: input.content,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.userId ? { userId: input.userId } : {})
    }));
    const context = result.response.payload.context;
    if (!isRecord(context) || !isContextLayer(context.layer) || !isContextFile(context.file)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid context.upsert payload");
    }
    return {
      layer: context.layer,
      file: context.file,
      text: input.content
    };
  }

  async getInfraHealth(): Promise<GatewayInfraHealth> {
    await this.ensureConnected();
    const result = await this.request("infra.health", {});
    const health = result.response.payload.health;
    if (!isRecord(health) || typeof health.serverTime !== "string" || !isRecord(health.checks)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid infra.health payload");
    }
    return {
      serverTime: health.serverTime,
      checks: health.checks
    };
  }

  async reconcileStorage(): Promise<GatewayReconcileResult> {
    await this.ensureConnected();
    const result = await this.request("infra.storage.reconcile", {
      idempotencyKey: createIdempotencyKey("infra_storage_reconcile")
    });
    const reconcile = result.response.payload.reconcile;
    if (!isRecord(reconcile)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid infra.storage.reconcile payload");
    }
    const uploaded = asNumber(reconcile.uploaded, 0);
    const scanned = asNumber(reconcile.scanned, 0);
    return {
      ...reconcile,
      uploaded,
      scanned
    };
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
    const accessToken = this.resolveAccessToken();
    if (!accessToken) {
      throw new GatewayRpcError("AUTH_REQUIRED", "No access token");
    }
    const endpoint = new URL("/auth/me", this.baseUrl);
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const payload = (await safeJson(response)) as Record<string, unknown>;
    if (!response.ok) {
      throw new GatewayRpcError(String(payload.error ?? "HTTP_ERROR"), String(payload.message ?? `HTTP ${response.status}`));
    }
    return payload;
  }

  async logout(refreshToken?: string): Promise<void> {
    const accessToken = this.resolveAccessToken();
    const endpoint = new URL("/auth/logout", this.baseUrl);
    await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify({
        ...(refreshToken ? { refreshToken } : {})
      })
    });
    this.setAccessToken(undefined);
  }

  private async runAgentViaWs(
    params: RunAgentParams,
    handlers: RunAgentStreamHandlers
  ): Promise<{ runId?: string; events: RpcEvent[] }> {
    if (typeof WebSocket === "undefined") {
      throw new GatewayWsPreflightError("WebSocket is unavailable");
    }

    const ws = await openWebSocket(toWebSocketUrl(this.baseUrl));
    const collectedEvents: RpcEvent[] = [];
    const pending = new Map<string, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }>();
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

    const requestOverWs = (method: GatewayMethod, paramsValue: Record<string, unknown>): Promise<RpcResponse> => {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new GatewayWsPreflightError("WebSocket is not open");
      }
      const id = `ws_r_${++this.requestCounter}`;
      const frame: RpcRequestFrame = {
        type: "req",
        id,
        method,
        params: this.injectIdempotencyKey(method, paramsValue)
      };

      return new Promise<RpcResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(frame));
      });
    };

    const wsAccessToken = this.resolveAccessToken();
    const scope = this.resolveScope();
    const connectRes = await requestOverWs("connect", {
      client: {
        name: this.clientName,
        version: this.clientVersion
      },
      workspaceId: scope.workspaceId ?? "w_default",
      ...(wsAccessToken
        ? {
            auth: {
              type: "Bearer",
              token: wsAccessToken
            }
          }
        : {})
    });

    if (!connectRes.ok) {
      cleanup();
      throw new GatewayWsPreflightError(`${connectRes.error.code}: ${connectRes.error.message}`);
    }

    const runRes = await requestOverWs("agent.run", this.withRunScope({
      sessionId: params.sessionId,
      input: params.input,
      runtimeMode: params.runtimeMode,
      ...(params.llm ? { llm: params.llm } : {}),
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.actor ? { actor: params.actor } : {})
    }));

    if (!runRes.ok) {
      cleanup();
      throw new GatewayRpcError(runRes.error.code, runRes.error.message);
    }

    await waitForTerminalEvent(collectedEvents, ws);
    cleanup();
    return {
      runId: asString(runRes.payload.runId),
      events: collectedEvents
    };
  }

  private resolveAccessToken(): string | undefined {
    const runtimeToken = this.useRuntimeToken ? readRuntimeConfigToken() : undefined;
    const dynamic = normalizeOptionalString(this.accessTokenResolver?.());
    return runtimeToken ?? dynamic ?? this.accessToken;
  }

  private resolveScope(): { tenantId?: string; workspaceId?: string; agentId?: string; actor?: string } {
    const runtimeScope = this.useRuntimeConfig ? readRuntimeScope() : {};
    return {
      tenantId: runtimeScope.tenantId ?? this.defaultTenantId,
      workspaceId: runtimeScope.workspaceId ?? this.defaultWorkspaceId,
      agentId: runtimeScope.agentId ?? this.defaultAgentId,
      actor: runtimeScope.actor ?? this.defaultActor
    };
  }

  private withScope(params: Record<string, unknown>): Record<string, unknown> {
    const scope = this.resolveScope();
    return {
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      ...params
    };
  }

  private withRunScope(params: Record<string, unknown>): Record<string, unknown> {
    const scope = this.resolveScope();
    return {
      ...this.withScope(params),
      ...(scope.agentId ? { agentId: scope.agentId } : {}),
      ...(scope.actor ? { actor: scope.actor } : {})
    };
  }

  private injectIdempotencyKey(method: GatewayMethod, params: Record<string, unknown>): Record<string, unknown> {
    if (!SIDE_EFFECT_METHODS.has(method)) {
      return params;
    }
    const existing = params.idempotencyKey;
    if (typeof existing === "string" && existing.trim().length > 0) {
      return params;
    }
    return {
      ...params,
      idempotencyKey: createIdempotencyKey(method.replace(/\./g, "_"))
    };
  }

  private async request(method: GatewayMethod, params: Record<string, unknown>): Promise<RpcSuccessEnvelope> {
    const id = `r_${++this.requestCounter}`;
    const accessToken = this.resolveAccessToken();
    const req: RpcRequestFrame = {
      type: "req",
      id,
      method,
      params: this.injectIdempotencyKey(method, params)
    };

    const endpoint = new URL("/rpc", this.baseUrl);
    endpoint.searchParams.set("connectionId", this.connectionId);

    let response: Response;
    try {
      response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify(req)
      });
    } catch (error) {
      this.connected = false;
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
        this.principal = undefined;
      }
      throw new GatewayRpcError(payload.response.error.code, payload.response.error.message);
    }

    this.lastAccessToken = accessToken;
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

  const raw = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.VITE_GATEWAY_BASE_URL;
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

function createConnectionId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function createIdempotencyKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function isRpcEnvelope(value: Partial<RpcEnvelope>): value is RpcEnvelope {
  return Boolean(value.response && typeof value.response === "object" && Array.isArray(value.events));
}

function isGatewaySession(value: unknown): value is GatewaySession {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.sessionKey === "string" &&
    typeof value.tenantId === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.ownerUserId === "string" &&
    (value.visibility === "private" || value.visibility === "workspace") &&
    typeof value.title === "string" &&
    typeof value.preview === "string" &&
    (value.runtimeMode === "local" || value.runtimeMode === "cloud") &&
    (value.syncState === "local_only" || value.syncState === "syncing" || value.syncState === "synced" || value.syncState === "conflict") &&
    typeof value.contextUsage === "number" &&
    typeof value.compactionCount === "number" &&
    (value.memoryFlushState === "idle" ||
      value.memoryFlushState === "pending" ||
      value.memoryFlushState === "flushed" ||
      value.memoryFlushState === "skipped") &&
    typeof value.updatedAt === "string"
  );
}

function toTranscriptItem(value: unknown): GatewayTranscriptItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asPositiveInt(value.id);
  if (!id) {
    return null;
  }
  const event = asString(value.event) ?? "message";
  const payload = isRecord(value.payload) ? value.payload : {};
  const derived = deriveTranscriptRoleText(event, payload);
  const role =
    asString(value.role) ??
    asString(value.type) ??
    derived.role ??
    "assistant";
  const text =
    asString(value.text) ??
    asString(value.content) ??
    asString(value.message) ??
    derived.text ??
    "";
  return {
    id,
    role,
    text,
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
    event,
    payload,
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
    ...value
  };
}

function deriveTranscriptRoleText(event?: string, payload?: Record<string, unknown>): { role?: string; text?: string } {
  if (!event) {
    return {};
  }
  if (event === "agent.accepted") {
    return { role: "system", text: "" };
  }
  if (event === "agent.delta") {
    return { role: "assistant", text: asString(payload?.delta) ?? "" };
  }
  if (event === "agent.completed") {
    return { role: "assistant", text: asString(payload?.output) ?? "" };
  }
  if (event === "agent.failed") {
    const code = asString(payload?.code) ?? "INTERNAL_ERROR";
    const message = asString(payload?.message) ?? "Unknown error";
    return { role: "system", text: `[${code}] ${message}` };
  }
  if (event === "agent.tool_call") {
    return { role: "tool", text: asString(payload?.toolName) ?? "tool_call" };
  }
  if (event === "agent.tool_result") {
    return { role: "tool", text: asString(payload?.toolName) ?? "tool_result" };
  }
  return {};
}

function isGatewayPolicy(value: unknown): value is GatewayPolicy {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.tenantId === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.scopeKey === "string" &&
    isPolicyDecision(value.toolDefault) &&
    isPolicyDecision(value.highRisk) &&
    (value.bashMode === "sandbox" || value.bashMode === "host") &&
    isRecord(value.tools) &&
    typeof value.version === "number" &&
    typeof value.updatedAt === "string"
  );
}

function isGatewayMetricsSummary(value: unknown): value is GatewayMetricsSummary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.runsTotal === "number" &&
    typeof value.runsFailed === "number" &&
    typeof value.toolCallsTotal === "number" &&
    typeof value.toolFailures === "number" &&
    typeof value.p95LatencyMs === "number"
  );
}

function isGatewaySandboxUsage(value: unknown): value is GatewaySandboxUsage {
  if (!isRecord(value)) {
    return false;
  }
  const runtimeMode = value.runtimeMode;
  if (runtimeMode !== "local" && runtimeMode !== "cloud") {
    return false;
  }
  if (typeof value.available !== "boolean" || typeof value.checkedAt !== "string") {
    return false;
  }
  if (value.source !== undefined && typeof value.source !== "string") {
    return false;
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    return false;
  }
  if (value.targetId !== undefined && typeof value.targetId !== "string") {
    return false;
  }
  if (value.cpuPercent !== undefined && typeof value.cpuPercent !== "number") {
    return false;
  }
  if (value.memoryPercent !== undefined && typeof value.memoryPercent !== "number") {
    return false;
  }
  if (value.diskPercent !== undefined && typeof value.diskPercent !== "number") {
    return false;
  }
  return true;
}

function isGatewayAuditItem(value: unknown): value is GatewayAuditItem {
  return isRecord(value);
}

function isGatewayUserMembership(value: unknown): value is GatewayUserMembership {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.workspaceId === "string" && isUserRole(value.role);
}

function isGatewayTenantUser(value: unknown): value is GatewayTenantUser {
  if (!isRecord(value)) {
    return false;
  }
  const user = value.user;
  const tenant = value.tenant;
  const memberships = value.memberships;
  if (!isRecord(user) || !isRecord(tenant) || !Array.isArray(memberships)) {
    return false;
  }
  return (
    typeof user.id === "string" &&
    typeof user.username === "string" &&
    isUserStatus(user.status) &&
    (user.source === "local" || user.source === "external") &&
    typeof tenant.tenantId === "string" &&
    typeof tenant.userId === "string" &&
    typeof tenant.defaultWorkspaceId === "string" &&
    isUserStatus(tenant.status) &&
    memberships.every(isGatewayUserMembership)
  );
}

function isGatewayModelKeyMeta(value: unknown): value is GatewayModelKeyMeta {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.tenantId === "string" &&
    typeof value.provider === "string" &&
    typeof value.maskedKey === "string" &&
    typeof value.keyLast4 === "string" &&
    typeof value.updatedBy === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isGatewayAgent(value: unknown): value is GatewayAgent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.tenantId === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.agentId === "string" &&
    typeof value.name === "string" &&
    (value.runtimeMode === "local" || value.runtimeMode === "cloud") &&
    typeof value.enabled === "boolean" &&
    isRecord(value.config) &&
    typeof value.version === "number" &&
    typeof value.updatedAt === "string"
  );
}

function isGatewayExecutionTarget(value: unknown): value is GatewayExecutionTarget {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.targetId === "string" &&
    typeof value.tenantId === "string" &&
    (value.kind === "local-host" || value.kind === "docker-runner") &&
    typeof value.isDefault === "boolean" &&
    typeof value.enabled === "boolean" &&
    isRecord(value.config) &&
    typeof value.version === "number" &&
    typeof value.updatedAt === "string"
  );
}

function isGatewayBudgetPolicy(value: unknown): value is GatewayBudgetPolicy {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.scopeKey === "string" &&
    (typeof value.tokenDailyLimit === "number" || value.tokenDailyLimit === null) &&
    (typeof value.costMonthlyUsdLimit === "number" || value.costMonthlyUsdLimit === null) &&
    typeof value.hardLimit === "boolean" &&
    typeof value.version === "number" &&
    typeof value.updatedAt === "string"
  );
}

function isGatewayBudgetUsage(value: unknown): value is GatewayBudgetUsage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.scopeKey === "string" &&
    typeof value.date === "string" &&
    typeof value.month === "string" &&
    typeof value.tokensUsedDaily === "number" &&
    typeof value.costUsdMonthly === "number" &&
    typeof value.runsRejectedDaily === "number"
  );
}

function isGatewayContextResult(value: unknown): value is GatewayContextResult {
  if (!isRecord(value)) {
    return false;
  }
  return isContextLayer(value.layer) && isContextFile(value.file) && typeof value.text === "string";
}

function isGatewayMemoryReadResult(value: unknown): value is GatewayMemoryReadResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.path === "string" &&
    typeof value.from === "number" &&
    (typeof value.lines === "number" || value.lines === null) &&
    typeof value.totalLines === "number" &&
    typeof value.text === "string"
  );
}

function isGatewayMemoryAppendResult(value: unknown): value is GatewayMemoryAppendResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.path === "string" &&
    typeof value.append === "boolean" &&
    typeof value.bytes === "number" &&
    typeof value.includeLongTerm === "boolean"
  );
}

function isGatewayMemoryArchiveResult(value: unknown): value is GatewayMemoryArchiveResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.date === "string" &&
    typeof value.dailyPath === "string" &&
    typeof value.includeLongTerm === "boolean" &&
    typeof value.clearDaily === "boolean" &&
    typeof value.archivedLines === "number" &&
    typeof value.archivedBytes === "number"
  );
}

function isGatewayMemorySearchResult(value: unknown): value is GatewayMemorySearchResult {
  if (!isRecord(value)) {
    return false;
  }

  if (!isRecord(value.indexStats)) {
    return false;
  }

  if (!Array.isArray(value.results)) {
    return false;
  }

  const validMode = value.mode === "hybrid" || value.mode === "keyword" || value.mode === "contains";
  if (!validMode) {
    return false;
  }

  const stats = value.indexStats;
  if (typeof stats.files !== "number" || typeof stats.chunks !== "number") {
    return false;
  }

  return value.results.every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    return (
      typeof entry.path === "string" &&
      typeof entry.startLine === "number" &&
      typeof entry.endLine === "number" &&
      typeof entry.snippet === "string" &&
      typeof entry.score === "number" &&
      entry.source === "memory"
    );
  });
}

function toGatewayPrincipal(value: unknown): GatewayPrincipal | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const roles = Array.isArray(value.roles) ? value.roles.filter(isUserRole) : [];
  if (
    typeof value.subject !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.tenantId !== "string" ||
    !Array.isArray(value.workspaceIds)
  ) {
    return undefined;
  }
  const workspaceIds = value.workspaceIds.filter((item): item is string => typeof item === "string");
  return {
    subject: value.subject,
    userId: value.userId,
    tenantId: value.tenantId,
    workspaceIds,
    roles,
    authSource: typeof value.authSource === "string" ? value.authSource : "unknown",
    ...(typeof value.displayName === "string" ? { displayName: value.displayName } : {})
  };
}

function isPolicyDecision(value: unknown): value is PolicyDecision {
  return value === "deny" || value === "allow";
}

function isUserRole(value: unknown): value is UserRole {
  return value === "tenant_admin" || value === "workspace_admin" || value === "member";
}

function isUserStatus(value: unknown): value is UserStatus {
  return value === "active" || value === "disabled";
}

function isContextLayer(value: unknown): value is ContextLayer {
  return value === "tenant" || value === "workspace" || value === "user";
}

function isContextFile(value: unknown): value is ContextFile {
  return value === "AGENTS.md" || value === "SOUL.md" || value === "TOOLS.md" || value === "USER.md";
}

function asExecutionMode(value: unknown): ExecutionMode | undefined {
  return value === "local_sandbox" || value === "enterprise_cloud" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number") {
    return fallback;
  }
  return Number.isFinite(value) ? value : fallback;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function safeJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

class GatewayWsPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayWsPreflightError";
  }
}

function readRuntimeConfigToken(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const config = (window as { __OPENFOAL_CONFIG__?: unknown }).__OPENFOAL_CONFIG__;
  if (!isRecord(config)) {
    return undefined;
  }
  const value = asString((config as { gatewayAccessToken?: unknown }).gatewayAccessToken);
  return normalizeOptionalString(value);
}

function readRuntimeScope(): { tenantId?: string; workspaceId?: string; userId?: string; agentId?: string; actor?: string } {
  if (typeof window === "undefined") {
    return {};
  }
  const config = (window as { __OPENFOAL_CONFIG__?: unknown }).__OPENFOAL_CONFIG__;
  if (!isRecord(config)) {
    return {};
  }

  const tenantId = normalizeOptionalString(asString((config as { tenantId?: unknown }).tenantId));
  const workspaceId = normalizeOptionalString(asString((config as { workspaceId?: unknown }).workspaceId));
  const userId = normalizeOptionalString(asString((config as { userId?: unknown }).userId));
  const agentId = normalizeOptionalString(asString((config as { agentId?: unknown }).agentId));
  const actor = normalizeOptionalString(asString((config as { actor?: unknown }).actor));

  return {
    ...(tenantId ? { tenantId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(userId ? { userId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(actor ? { actor } : {})
  };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
      reject(new GatewayWsPreflightError("WebSocket connection failed"));
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

function isRpcResponse(value: unknown): value is RpcResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type !== "res") {
    return false;
  }
  if (typeof value.id !== "string" || typeof value.ok !== "boolean") {
    return false;
  }
  if (value.ok) {
    return isRecord(value.payload);
  }
  return isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}

function isRpcEvent(value: unknown): value is RpcEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.type === "event" &&
    typeof value.event === "string" &&
    isRecord(value.payload) &&
    typeof value.seq === "number" &&
    typeof value.stateVersion === "number"
  );
}

function waitForTerminalEvent(events: RpcEvent[], ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 120_000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const hasTerminal = events.some((event) => event.event === "agent.completed" || event.event === "agent.failed");
      if (hasTerminal) {
        clearTimeout(timer);
        resolve();
        return;
      }

      if (Date.now() > deadline) {
        clearTimeout(timer);
        reject(new GatewayRpcError("TIMEOUT", "agent.run stream timeout"));
        return;
      }

      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        clearTimeout(timer);
        reject(new GatewayRpcError("NETWORK_ERROR", "WebSocket closed before terminal event"));
        return;
      }

      timer = setTimeout(tick, 50);
    };

    timer = setTimeout(tick, 50);
  });
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
