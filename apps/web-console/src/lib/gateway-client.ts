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
  createdAt?: string;
  [key: string]: unknown;
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
  | "runtime.setMode"
  | "sessions.create"
  | "sessions.list"
  | "sessions.get"
  | "sessions.history"
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

const SIDE_EFFECT_METHODS = new Set<GatewayMethod>([
  "runtime.setMode",
  "sessions.create",
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

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly connectionId: string;
  private accessToken?: string;
  private connected = false;
  private connectPromise: Promise<GatewayPrincipal | undefined> | null = null;
  private requestCounter = 0;
  private principal?: GatewayPrincipal;

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
    this.principal = undefined;
    persistAccessToken(this.accessToken);
  }

  getPrincipal(): GatewayPrincipal | undefined {
    return this.principal;
  }

  async ensureConnected(): Promise<GatewayPrincipal | undefined> {
    if (this.connected) {
      return this.principal;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      const result = await this.request("connect", {
        client: {
          name: "web-console",
          version: "0.2.0"
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
      const principal = toGatewayPrincipal(result.response.payload.principal);
      this.principal = principal;
      this.connected = true;
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
    const result = await this.request("sessions.list", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    });
    return readArray(result.response.payload.items).filter(isGatewaySession);
  }

  async createSession(input: {
    title?: string;
    runtimeMode?: RuntimeMode;
    tenantId?: string;
    workspaceId?: string;
    ownerUserId?: string;
    visibility?: "private" | "workspace";
  }): Promise<GatewaySession | null> {
    await this.ensureConnected();
    const result = await this.request("sessions.create", {
      ...(input.title ? { title: input.title } : {}),
      ...(input.runtimeMode ? { runtimeMode: input.runtimeMode } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.visibility ? { visibility: input.visibility } : {})
    });
    return isGatewaySession(result.response.payload.session) ? result.response.payload.session : null;
  }

  async getSession(input: { sessionId: string; tenantId?: string; workspaceId?: string }): Promise<GatewaySession | null> {
    await this.ensureConnected();
    const result = await this.request("sessions.get", {
      sessionId: input.sessionId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
    });
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
    const result = await this.request("sessions.history", {
      sessionId: input.sessionId,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      ...(typeof input.beforeId === "number" ? { beforeId: input.beforeId } : {})
    });
    return readArray(result.response.payload.items).map((item) => toTranscriptItem(item)).filter(Boolean) as GatewayTranscriptItem[];
  }

  async setRuntimeMode(input: {
    sessionId: string;
    runtimeMode: RuntimeMode;
    tenantId?: string;
    workspaceId?: string;
  }): Promise<{ executionMode?: ExecutionMode; status?: string }> {
    await this.ensureConnected();
    const result = await this.request("runtime.setMode", {
      idempotencyKey: createIdempotencyKey("runtime_set_mode"),
      sessionId: input.sessionId,
      runtimeMode: input.runtimeMode,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
    });
    return {
      ...(asExecutionMode(result.response.payload.executionMode) ? { executionMode: asExecutionMode(result.response.payload.executionMode) } : {}),
      ...(typeof result.response.payload.status === "string" ? { status: result.response.payload.status } : {})
    };
  }

  async getPolicy(params: { tenantId?: string; workspaceId?: string; scopeKey?: string } = {}): Promise<GatewayPolicy> {
    await this.ensureConnected();
    const result = await this.request("policy.get", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.scopeKey ? { scopeKey: params.scopeKey } : {})
    });
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
    const result = await this.request("policy.update", {
      idempotencyKey: createIdempotencyKey("policy_update"),
      patch: input.patch,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.scopeKey ? { scopeKey: input.scopeKey } : {})
    });
    const policy = result.response.payload.policy;
    if (!isGatewayPolicy(policy)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid policy.update payload");
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
    return {
      items: readArray(result.response.payload.items).filter(isGatewayAuditItem),
      ...(asPositiveInt(result.response.payload.nextCursor) ? { nextCursor: asPositiveInt(result.response.payload.nextCursor) } : {})
    };
  }

  async getMetricsSummary(params: { tenantId?: string; workspaceId?: string; agentId?: string } = {}): Promise<GatewayMetricsSummary> {
    await this.ensureConnected();
    const result = await this.request("metrics.summary", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {})
    });
    const metrics = result.response.payload.metrics;
    if (!isGatewayMetricsSummary(metrics)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid metrics.summary payload");
    }
    return metrics;
  }

  async listUsers(params: { tenantId?: string; workspaceId?: string } = {}): Promise<GatewayTenantUser[]> {
    await this.ensureConnected();
    const result = await this.request("users.list", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    });
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
    const result = await this.request("users.create", {
      idempotencyKey: createIdempotencyKey("users_create"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      username: input.username,
      password: input.password,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.status ? { status: input.status } : {}),
      memberships: input.memberships.map((item) => ({ workspaceId: item.workspaceId, role: item.role }))
    });
    return isGatewayTenantUser(result.response.payload.user) ? result.response.payload.user : null;
  }

  async updateUserStatus(input: { tenantId?: string; userId: string; status: UserStatus }): Promise<void> {
    await this.ensureConnected();
    await this.request("users.updateStatus", {
      idempotencyKey: createIdempotencyKey("users_update_status"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      userId: input.userId,
      status: input.status
    });
  }

  async resetUserPassword(input: { tenantId?: string; userId: string; newPassword: string }): Promise<void> {
    await this.ensureConnected();
    await this.request("users.resetPassword", {
      idempotencyKey: createIdempotencyKey("users_reset_password"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      userId: input.userId,
      newPassword: input.newPassword
    });
  }

  async updateUserMemberships(input: {
    tenantId?: string;
    userId: string;
    memberships: GatewayUserMembership[];
  }): Promise<GatewayUserMembership[]> {
    await this.ensureConnected();
    const result = await this.request("users.updateMemberships", {
      idempotencyKey: createIdempotencyKey("users_update_memberships"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      userId: input.userId,
      memberships: input.memberships.map((item) => ({ workspaceId: item.workspaceId, role: item.role }))
    });
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
    const result = await this.request("secrets.upsertModelKey", {
      idempotencyKey: createIdempotencyKey("secrets_upsert_model_key"),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      provider: input.provider,
      apiKey: input.apiKey,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {})
    });
    return isGatewayModelKeyMeta(result.response.payload.secret) ? result.response.payload.secret : null;
  }

  async getModelKeyMeta(params: { tenantId?: string; workspaceId?: string; provider?: string } = {}): Promise<GatewayModelKeyMeta[]> {
    await this.ensureConnected();
    const result = await this.request("secrets.getModelKeyMeta", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.provider ? { provider: params.provider } : {})
    });
    return readArray(result.response.payload.items).filter(isGatewayModelKeyMeta);
  }

  async listAgents(params: { tenantId?: string; workspaceId?: string } = {}): Promise<GatewayAgent[]> {
    await this.ensureConnected();
    const result = await this.request("agents.list", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    });
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
    const result = await this.request("agents.upsert", {
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
    });
    return isGatewayAgent(result.response.payload.agent) ? result.response.payload.agent : null;
  }

  async listExecutionTargets(params: { tenantId?: string; workspaceId?: string } = {}): Promise<GatewayExecutionTarget[]> {
    await this.ensureConnected();
    const result = await this.request("executionTargets.list", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {})
    });
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
    const result = await this.request("executionTargets.upsert", {
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
    });
    return isGatewayExecutionTarget(result.response.payload.target) ? result.response.payload.target : null;
  }

  async getBudget(params: { scopeKey?: string; date?: string } = {}): Promise<GatewayBudgetResult> {
    await this.ensureConnected();
    const result = await this.request("budget.get", {
      ...(params.scopeKey ? { scopeKey: params.scopeKey } : {}),
      ...(params.date ? { date: params.date } : {})
    });
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
    const result = await this.request("budget.update", {
      idempotencyKey: createIdempotencyKey("budget_update"),
      ...(input.scopeKey ? { scopeKey: input.scopeKey } : {}),
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      patch
    });
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
    const result = await this.request("context.get", {
      layer: input.layer,
      file: input.file,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.userId ? { userId: input.userId } : {})
    });
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
    const result = await this.request("context.upsert", {
      idempotencyKey: createIdempotencyKey("context_upsert"),
      layer: input.layer,
      file: input.file,
      content: input.content,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.userId ? { userId: input.userId } : {})
    });
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
  const role = typeof value.role === "string" ? value.role : "assistant";
  const text = typeof value.text === "string" ? value.text : typeof value.content === "string" ? value.content : "";
  if (!id) {
    return null;
  }
  return {
    id,
    role,
    text,
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
    ...value
  };
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
