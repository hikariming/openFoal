import { createRuntimeCoreService, type CoreEvent, type CoreService } from "../../../packages/core/dist/index.js";
import {
  DEFAULT_SESSION_PREVIEW,
  DEFAULT_SESSION_TITLE,
  InMemoryAuthStore,
  InMemoryIdempotencyRepository,
  InMemoryAgentRepository,
  InMemoryAuditRepository,
  InMemoryBudgetRepository,
  InMemoryExecutionTargetRepository,
  InMemoryMetricsRepository,
  InMemoryPolicyRepository,
  InMemorySessionRepository,
  InMemoryTranscriptRepository,
  SqliteAgentRepository,
  SqliteAuthStore,
  SqliteAuditRepository,
  SqliteBudgetRepository,
  SqliteExecutionTargetRepository,
  SqliteIdempotencyRepository,
  SqliteMetricsRepository,
  SqlitePolicyRepository,
  SqliteSessionRepository,
  SqliteTranscriptRepository,
  type AgentDefinitionRecord,
  type AgentRepository,
  type AuditQuery,
  type AuditRepository,
  type BudgetPolicyPatch,
  type BudgetRepository,
  type ExecutionTargetRecord,
  type ExecutionTargetRepository,
  type IdempotencyRepository,
  type MetricsRepository,
  type MetricsScopeFilter,
  type AuthStore,
  type PolicyDecision,
  type PolicyPatch,
  type PolicyRecord,
  type PolicyRepository,
  type RuntimeMode,
  type SessionRecord,
  type SessionRepository,
  type TranscriptRepository
} from "../../../packages/storage/dist/index.js";
import {
  createLocalToolExecutor,
  type ToolExecutor,
  type ToolExecutionHooks,
  type ToolContext,
  type ToolCall,
  type ToolResult
} from "../../../packages/tool-executor/dist/index.js";
import {
  isSideEffectMethod,
  makeErrorRes,
  makeSuccessRes,
  type EventFrame,
  type MethodName,
  type ReqFrame,
  type ResFrame,
  validateReqFrame
} from "../../../packages/protocol/dist/index.js";
import {
  AuthHttpError,
  createGatewayAuthRuntime,
  resolveAuthRuntimeConfig,
  type GatewayAuthRuntime,
  type Principal
} from "./auth.js";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createServer, request as httpRequest } from "node:http";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpsRequest } from "node:https";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createHash } from "node:crypto";

declare const Buffer: any;

export interface ConnectionState {
  connected: boolean;
  nextSeq: number;
  stateVersion: number;
  runningSessionIds: Set<string>;
  queuedModeChanges: Map<string, RuntimeMode>;
  principal?: Principal;
}

export interface GatewayHandleResult {
  response: ResFrame;
  events: EventFrame[];
}

export interface GatewayHandleOptions {
  transport?: "http" | "ws";
  onEvent?: (event: EventFrame) => void;
}

export interface GatewayRouter {
  handle(input: unknown, state: ConnectionState, options?: GatewayHandleOptions): Promise<GatewayHandleResult>;
  auth?: {
    login(body: Record<string, unknown>): Promise<Record<string, unknown>>;
    refresh(body: Record<string, unknown>): Promise<Record<string, unknown>>;
    me(authorizationHeader: string | undefined): Promise<Record<string, unknown>>;
    logout(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

export interface GatewayServerOptions {
  host?: string;
  port?: number;
  sqlitePath?: string;
  router?: GatewayRouter;
}

export interface GatewayServerHandle {
  host: string;
  port: number;
  close(): Promise<void>;
}

type DockerRunnerInvokeInput = {
  target: ExecutionTargetRecord;
  call: ToolCall;
  ctx: ToolContext;
  hooks?: ToolExecutionHooks;
};

type DockerRunnerInvoker = (input: DockerRunnerInvokeInput) => Promise<ToolResult>;

interface GatewayDeps {
  coreService?: CoreService;
  toolExecutor?: ToolExecutor;
  internalToolExecutor?: ToolExecutor;
  dockerRunnerInvoker?: DockerRunnerInvoker;
  sessionRepo?: SessionRepository;
  transcriptRepo?: TranscriptRepository;
  idempotencyRepo?: IdempotencyRepository;
  agentRepo?: AgentRepository;
  executionTargetRepo?: ExecutionTargetRepository;
  budgetRepo?: BudgetRepository;
  auditRepo?: AuditRepository;
  policyRepo?: PolicyRepository;
  metricsRepo?: MetricsRepository;
  authStore?: AuthStore;
  authRuntime?: GatewayAuthRuntime;
  now?: () => Date;
}

export function createConnectionState(): ConnectionState {
  return {
    connected: false,
    nextSeq: 1,
    stateVersion: 0,
    runningSessionIds: new Set<string>(),
    queuedModeChanges: new Map<string, RuntimeMode>()
  };
}

export function createGatewayRouter(deps: GatewayDeps = {}): GatewayRouter {
  const sessionRepo = deps.sessionRepo ?? new InMemorySessionRepository();
  const transcriptRepo = deps.transcriptRepo ?? new InMemoryTranscriptRepository();
  const idempotencyRepo = deps.idempotencyRepo ?? new InMemoryIdempotencyRepository();
  const agentRepo = deps.agentRepo ?? new InMemoryAgentRepository();
  const executionTargetRepo = deps.executionTargetRepo ?? new InMemoryExecutionTargetRepository();
  const budgetRepo = deps.budgetRepo ?? new InMemoryBudgetRepository();
  const auditRepo = deps.auditRepo ?? new InMemoryAuditRepository();
  const policyRepo = deps.policyRepo ?? new InMemoryPolicyRepository();
  const metricsRepo = deps.metricsRepo ?? new InMemoryMetricsRepository();
  const authStore = deps.authStore ?? new InMemoryAuthStore();
  const now = deps.now ?? (() => new Date());
  const authRuntime = deps.authRuntime ?? createGatewayAuthRuntime({
    config: resolveAuthRuntimeConfig(),
    store: authStore,
    now
  });
  const baseToolExecutor = deps.toolExecutor ?? createLocalToolExecutor();
  const internalToolExecutor = deps.internalToolExecutor ?? baseToolExecutor;
  const dockerRunnerInvoker = deps.dockerRunnerInvoker ?? invokeDockerRunnerOverHttp;
  const sessionExecutionTargets = new Map<string, ExecutionTargetRecord>();
  const targetAwareToolExecutor = createExecutionTargetToolExecutor({
    local: baseToolExecutor,
    dockerRunnerInvoker,
    getExecutionTarget: (sessionId) => sessionExecutionTargets.get(sessionId)
  });
  const policyAwareToolExecutor = createPolicyAwareToolExecutor({
    base: targetAwareToolExecutor,
    policyRepo
  });
  const coreService = deps.coreService ?? createRuntimeCoreService({ toolExecutor: policyAwareToolExecutor });

  return {
    async handle(input: unknown, state: ConnectionState, options: GatewayHandleOptions = {}): Promise<GatewayHandleResult> {
      const validated = validateReqFrame(input);
      if (!validated.ok) {
        return {
          response: makeErrorRes(extractRequestId(input), validated.error.code, validated.error.message),
          events: []
        };
      }

      let req = validated.data;

      if (req.method === "connect") {
        const connectAuth = await authRuntime.authenticateConnect(req.params);
        if (!connectAuth.ok) {
          return {
            response: makeErrorRes(req.id, connectAuth.code, connectAuth.message),
            events: []
          };
        }
        if (connectAuth.principal) {
          state.principal = connectAuth.principal;
        }
      } else {
        const authz = authRuntime.authorizeRpc(req.method, req.params, state.principal);
        if (!authz.ok) {
          return {
            response: makeErrorRes(req.id, authz.code, authz.message),
            events: []
          };
        }
        req = {
          ...req,
          params: authz.params
        };
      }

      if (!state.connected && req.method !== "connect") {
        return {
          response: makeErrorRes(req.id, "UNAUTHORIZED", "connect 之前不能调用其他方法"),
          events: []
        };
      }

      const sideEffectKey = getIdempotencyKey(req);
      const idempotencyKey = sideEffectKey && buildIdempotencyCacheKey(req, sideEffectKey);
      const fingerprint = stableStringify(req.params);
      if (idempotencyKey) {
        const existing = await idempotencyRepo.get(idempotencyKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            return {
              response: makeErrorRes(req.id, "IDEMPOTENCY_CONFLICT", "同幂等键参数不一致"),
              events: []
            };
          }
          const replayed = cloneResult(existing.result as GatewayHandleResult);
          if ((options.transport ?? "http") === "ws" && options.onEvent) {
            for (const event of replayed.events) {
              options.onEvent(event);
            }
          }
          return replayed;
        }
      }

      const result = await route(
        req,
        state,
        coreService,
        sessionRepo,
        transcriptRepo,
        agentRepo,
        executionTargetRepo,
        budgetRepo,
        auditRepo,
        policyRepo,
        metricsRepo,
        internalToolExecutor,
        sessionExecutionTargets,
        now,
        options
      );

      if (idempotencyKey && result.response.ok) {
        await idempotencyRepo.set(idempotencyKey, {
          fingerprint,
          result: cloneResult(result)
        });
      }

      return result;
    },
    auth: {
      login: async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
        return await authRuntime.login(body);
      },
      refresh: async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
        return await authRuntime.refresh(body);
      },
      me: async (authorizationHeader: string | undefined): Promise<Record<string, unknown>> => {
        return await authRuntime.me(authorizationHeader);
      },
      logout: async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
        return await authRuntime.logout(body);
      }
    }
  };
}

export async function startGatewayServer(options: GatewayServerOptions = {}): Promise<GatewayServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const router =
    options.router ??
    createGatewayRouter({
      sessionRepo: new SqliteSessionRepository(options.sqlitePath),
      transcriptRepo: new SqliteTranscriptRepository(options.sqlitePath),
      idempotencyRepo: new SqliteIdempotencyRepository(options.sqlitePath),
      agentRepo: new SqliteAgentRepository(options.sqlitePath),
      executionTargetRepo: new SqliteExecutionTargetRepository(options.sqlitePath),
      budgetRepo: new SqliteBudgetRepository(options.sqlitePath),
      auditRepo: new SqliteAuditRepository(options.sqlitePath),
      policyRepo: new SqlitePolicyRepository(options.sqlitePath),
      metricsRepo: new SqliteMetricsRepository(options.sqlitePath),
      authStore: new SqliteAuthStore(options.sqlitePath)
    });
  const httpConnections = new Map<string, ConnectionState>();
  const sockets = new Set<any>();

  const server = createServer(async (req: any, res: any) => {
    try {
      await handleHttpRequest(req, res, router, httpConnections);
    } catch (error) {
      writeJson(res, 500, {
        error: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.on("upgrade", (req: any, socket: any, head: any) => {
    void handleUpgrade(req, socket, head, router);
  });
  server.on("connection", (socket: any) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await listen(server, host, port);
  const addr = server.address();
  const actualPort = addr && typeof addr === "object" ? addr.port : port;

  return {
    host,
    port: actualPort,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await closeServer(server);
    }
  };
}

async function route(
  req: ReqFrame,
  state: ConnectionState,
  coreService: CoreService,
  sessionRepo: SessionRepository,
  transcriptRepo: TranscriptRepository,
  agentRepo: AgentRepository,
  executionTargetRepo: ExecutionTargetRepository,
  budgetRepo: BudgetRepository,
  auditRepo: AuditRepository,
  policyRepo: PolicyRepository,
  metricsRepo: MetricsRepository,
  internalToolExecutor: ToolExecutor,
  sessionExecutionTargets: Map<string, ExecutionTargetRecord>,
  now: () => Date,
  options: GatewayHandleOptions
): Promise<GatewayHandleResult> {
  switch (req.method) {
    case "connect": {
      state.connected = true;
      return {
        response: makeSuccessRes(req.id, {
          protocolVersion: "1.0.0",
          serverTime: now().toISOString(),
          ...(state.principal
            ? {
                principal: {
                  subject: state.principal.subject,
                  tenantId: state.principal.tenantId,
                  workspaceIds: [...state.principal.workspaceIds],
                  roles: [...state.principal.roles],
                  authSource: state.principal.authSource,
                  ...(state.principal.displayName ? { displayName: state.principal.displayName } : {})
                }
              }
            : {})
        }),
        events: []
      };
    }

    case "sessions.create": {
      const titleParam = requireString(req.params, "title");
      const runtimeMode = asRuntimeMode(req.params.runtimeMode) ?? "local";
      const session = createSession(createSessionId(), runtimeMode, titleParam ?? DEFAULT_SESSION_TITLE);
      await sessionRepo.upsert(session);
      return {
        response: makeSuccessRes(req.id, { session }),
        events: [createEvent(state, "session.updated", { session })]
      };
    }

    case "sessions.list": {
      const items = await sessionRepo.list();
      return {
        response: makeSuccessRes(req.id, { items }),
        events: []
      };
    }

    case "sessions.get": {
      const sessionId = requireString(req.params, "sessionId");
      if (!sessionId) {
        return invalidParams(req.id, "sessions.get 需要 sessionId");
      }
      const session = await sessionRepo.get(sessionId);
      return {
        response: makeSuccessRes(req.id, { session: session ?? null }),
        events: []
      };
    }

    case "sessions.history": {
      const sessionId = requireString(req.params, "sessionId");
      if (!sessionId) {
        return invalidParams(req.id, "sessions.history 需要 sessionId");
      }

      const session = await sessionRepo.get(sessionId);
      if (!session) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", `未知会话: ${sessionId}`),
          events: []
        };
      }

      const rawLimit = req.params.limit;
      const parsedLimit = rawLimit === undefined ? 200 : asPositiveInt(rawLimit);
      if (rawLimit !== undefined && !parsedLimit) {
        return invalidParams(req.id, "sessions.history 的 limit 必须是正整数");
      }
      const limit = Math.min(parsedLimit ?? 200, 500);

      const rawBeforeId = req.params.beforeId;
      const beforeId = rawBeforeId === undefined ? undefined : asPositiveInt(rawBeforeId);
      if (rawBeforeId !== undefined && !beforeId) {
        return invalidParams(req.id, "sessions.history 的 beforeId 必须是正整数");
      }

      const items = await transcriptRepo.list(sessionId, limit, beforeId);
      return {
        response: makeSuccessRes(req.id, { items }),
        events: []
      };
    }

    case "agents.list": {
      const tenantId = requireString(req.params, "tenantId") ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId");
      const items = await agentRepo.list({
        tenantId,
        ...(workspaceId ? { workspaceId } : {})
      });
      return {
        response: makeSuccessRes(req.id, { items }),
        events: []
      };
    }

    case "agents.upsert": {
      const tenantId = requireString(req.params, "tenantId") ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId") ?? "w_default";
      const agentId = requireString(req.params, "agentId");
      if (!agentId) {
        return invalidParams(req.id, "agents.upsert 需要 agentId");
      }
      const runtimeMode = asRuntimeMode(req.params.runtimeMode) ?? "local";
      const record = await agentRepo.upsert({
        tenantId,
        workspaceId,
        agentId,
        name: requireString(req.params, "name") ?? agentId,
        runtimeMode,
        ...(requireString(req.params, "executionTargetId") ? { executionTargetId: requireString(req.params, "executionTargetId") } : {}),
        ...(requireString(req.params, "policyScopeKey") ? { policyScopeKey: requireString(req.params, "policyScopeKey") } : {}),
        enabled: req.params.enabled !== false,
        config: isObjectRecord(req.params.config) ? req.params.config : {}
      });

      await auditRepo.append({
        tenantId,
        workspaceId,
        action: "agents.upsert",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "agent_definition",
        resourceId: `${workspaceId}:${agentId}`,
        metadata: {
          runtimeMode: record.runtimeMode,
          executionTargetId: record.executionTargetId
        },
        createdAt: now().toISOString()
      });

      return {
        response: makeSuccessRes(req.id, { agent: record }),
        events: []
      };
    }

    case "executionTargets.list": {
      const tenantId = requireString(req.params, "tenantId") ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId");
      const items = await executionTargetRepo.list({
        tenantId,
        ...(workspaceId !== undefined ? { workspaceId } : {})
      });
      return {
        response: makeSuccessRes(req.id, { items }),
        events: []
      };
    }

    case "executionTargets.upsert": {
      const targetId = requireString(req.params, "targetId");
      if (!targetId) {
        return invalidParams(req.id, "executionTargets.upsert 需要 targetId");
      }
      const tenantId = requireString(req.params, "tenantId") ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId");
      const kind = req.params.kind === "docker-runner" ? "docker-runner" : "local-host";
      const target = await executionTargetRepo.upsert({
        targetId,
        tenantId,
        ...(workspaceId ? { workspaceId } : {}),
        kind,
        ...(requireString(req.params, "endpoint") ? { endpoint: requireString(req.params, "endpoint") } : {}),
        ...(requireString(req.params, "authToken") ? { authToken: requireString(req.params, "authToken") } : {}),
        isDefault: req.params.isDefault === true,
        enabled: req.params.enabled !== false,
        config: isObjectRecord(req.params.config) ? req.params.config : {}
      });

      await auditRepo.append({
        tenantId,
        workspaceId: workspaceId ?? "w_default",
        action: "executionTargets.upsert",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "execution_target",
        resourceId: target.targetId,
        metadata: {
          kind: target.kind,
          isDefault: target.isDefault,
          enabled: target.enabled
        },
        createdAt: now().toISOString()
      });

      return {
        response: makeSuccessRes(req.id, { target }),
        events: []
      };
    }

    case "budget.get": {
      const scopeKey = requireString(req.params, "scopeKey") ?? defaultBudgetScopeKey();
      const policy = await budgetRepo.get(scopeKey);
      const usage = await budgetRepo.summary(scopeKey, normalizeMemoryDate(req.params.date) ?? undefined);
      return {
        response: makeSuccessRes(req.id, {
          policy,
          usage
        }),
        events: []
      };
    }

    case "budget.update": {
      const scopeKey = requireString(req.params, "scopeKey") ?? defaultBudgetScopeKey();
      const patch = toBudgetPatch(req.params);
      if (!patch) {
        return invalidParams(req.id, "budget.update 需要至少一个可更新字段");
      }
      const policy = await budgetRepo.update(patch, scopeKey);
      const usage = await budgetRepo.summary(scopeKey);
      await auditRepo.append({
        tenantId: requireString(req.params, "tenantId") ?? "t_default",
        workspaceId: requireString(req.params, "workspaceId") ?? "w_default",
        action: "budget.update",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "budget_policy",
        resourceId: scopeKey,
        metadata: {
          tokenDailyLimit: policy.tokenDailyLimit,
          costMonthlyUsdLimit: policy.costMonthlyUsdLimit,
          hardLimit: policy.hardLimit
        },
        createdAt: now().toISOString()
      });
      return {
        response: makeSuccessRes(req.id, {
          policy,
          usage
        }),
        events: []
      };
    }

    case "runtime.setMode": {
      const sessionId = requireString(req.params, "sessionId");
      const runtimeMode = asRuntimeMode(req.params.runtimeMode);
      if (!sessionId || !runtimeMode) {
        return invalidParams(req.id, "runtime.setMode 需要 sessionId 和 runtimeMode(local|cloud)");
      }

      if (state.runningSessionIds.has(sessionId)) {
        state.queuedModeChanges.set(sessionId, runtimeMode);
        return {
          response: makeSuccessRes(req.id, {
            sessionId,
            runtimeMode,
            status: "queued-change",
            effectiveOn: "next_turn"
          }),
          events: []
        };
      }

      const updated = await sessionRepo.setRuntimeMode(sessionId, runtimeMode);
      if (!updated) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", `未知会话: ${sessionId}`),
          events: []
        };
      }

      const events = [
        createEvent(state, "runtime.mode_changed", {
          sessionId,
          runtimeMode,
          status: "applied"
        }),
        createEvent(state, "session.updated", { session: updated })
      ];

      return {
        response: makeSuccessRes(req.id, {
          sessionId,
          runtimeMode,
          status: "applied"
        }),
        events
      };
    }

    case "agent.run": {
      const sessionId = requireString(req.params, "sessionId");
      const input = requireString(req.params, "input");
      const reqRuntimeMode = asRuntimeMode(req.params.runtimeMode);
      const llm = asLlmOptions(req.params.llm);
      const tenantId = requireString(req.params, "tenantId") ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId") ?? "w_default";
      const agentId = requireString(req.params, "agentId") ?? "a_default";
      const actor = requireString(req.params, "actor") ?? "user";
      const explicitTargetId = requireString(req.params, "executionTargetId");
      if (!sessionId || !input) {
        return invalidParams(req.id, "agent.run 需要 sessionId 和 input");
      }

      if (state.runningSessionIds.has(sessionId)) {
        return {
          response: makeErrorRes(req.id, "SESSION_BUSY", `会话 ${sessionId} 正在运行`),
          events: []
        };
      }

      const selectedTarget = await resolveExecutionTarget({
        tenantId,
        workspaceId,
        agentId,
        explicitTargetId,
        agentRepo,
        executionTargetRepo
      });
      if (!selectedTarget) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", "未找到可用执行目标"),
          events: []
        };
      }
      if (!selectedTarget.enabled) {
        return {
          response: makeErrorRes(req.id, "POLICY_DENIED", `执行目标不可用: ${selectedTarget.targetId}`),
          events: []
        };
      }

      const budgetScopeKey = resolveBudgetScopeKey(req.params, tenantId, workspaceId, agentId);
      const budgetPolicy = await budgetRepo.get(budgetScopeKey);
      const budgetUsage = await budgetRepo.summary(budgetScopeKey);
      const budgetExceededReason = getBudgetExceededReason(budgetPolicy, budgetUsage);
      if (budgetExceededReason) {
        await budgetRepo.addUsage({
          scopeKey: budgetScopeKey,
          runsRejected: 1,
          date: now().toISOString().slice(0, 10)
        });
        await auditRepo.append({
          tenantId,
          workspaceId,
          action: "budget.rejected",
          actor,
          resourceType: "budget_policy",
          resourceId: budgetScopeKey,
          metadata: {
            reason: budgetExceededReason,
            usage: budgetUsage,
            policy: budgetPolicy
          },
          createdAt: now().toISOString()
        });
        return {
          response: makeErrorRes(req.id, "POLICY_DENIED", `预算超限: ${budgetExceededReason}`),
          events: []
        };
      }

      let session = await sessionRepo.get(sessionId);
      if (!session) {
        session = createSession(sessionId, reqRuntimeMode ?? "local");
        await sessionRepo.upsert(session);
      }

      if (reqRuntimeMode && reqRuntimeMode !== session.runtimeMode) {
        const updated = await sessionRepo.setRuntimeMode(sessionId, reqRuntimeMode);
        if (updated) {
          session = updated;
        }
      }

      session = await prepareSessionForRun({
        sessionRepo,
        toolExecutor: internalToolExecutor,
        session,
        input,
        now
      });

      const allEvents: EventFrame[] = [];
      const responseEvents: EventFrame[] = [];
      const runStartedAt = Date.now();
      let runStatus: "completed" | "failed" = "completed";
      let toolCallsTotal = 0;
      let toolFailures = 0;
      let completedOutput = "";
      let acceptedRunId = "";
      const emit = (event: EventFrame): void => {
        allEvents.push(event);
        options.onEvent?.(event);
        if ((options.transport ?? "http") === "http" && isHttpCompatibleRunEvent(event.event)) {
          responseEvents.push(event);
        }
      };

      await transcriptRepo.append({
        sessionId,
        event: "user.input",
        payload: { input },
        createdAt: now().toISOString()
      });

      const sessionWithInput = withSessionInput(session, input);
      if (sessionWithInput.title !== session.title || sessionWithInput.preview !== session.preview) {
        await sessionRepo.upsert(sessionWithInput);
        const refreshed = await sessionRepo.get(sessionId);
        session = refreshed ?? sessionWithInput;
        emit(createEvent(state, "session.updated", { session }));
      }

      state.runningSessionIds.add(sessionId);
      sessionExecutionTargets.set(sessionId, selectedTarget);
      try {
        for await (const coreEvent of coreService.run({
          sessionId,
          input,
          runtimeMode: session.runtimeMode,
          ...(llm ? { llm } : {})
        })) {
          const mapped = mapCoreEvent(coreEvent);
          if (mapped.event === "agent.accepted") {
            const runId = mapped.payload.runId;
            if (typeof runId === "string") {
              acceptedRunId = runId;
            }
          } else if (mapped.event === "agent.tool_call") {
            toolCallsTotal += 1;
          } else if (mapped.event === "agent.failed") {
            runStatus = "failed";
            toolFailures += 1;
          } else if (mapped.event === "agent.completed") {
            completedOutput = asString(mapped.payload.output) ?? "";
          }
          emit(createEvent(state, mapped.event, mapped.payload));
        }
      } finally {
        state.runningSessionIds.delete(sessionId);
        sessionExecutionTargets.delete(sessionId);
      }

      const queuedMode = state.queuedModeChanges.get(sessionId);
      if (queuedMode) {
        state.queuedModeChanges.delete(sessionId);
        const updated = await sessionRepo.setRuntimeMode(sessionId, queuedMode);
        if (updated) {
          emit(
            createEvent(state, "runtime.mode_changed", {
              sessionId,
              runtimeMode: queuedMode,
              status: "applied"
            })
          );
          emit(createEvent(state, "session.updated", { session: updated }));
        }
      }

      if (!acceptedRunId) {
        await metricsRepo.recordRun({
          sessionId,
          tenantId,
          workspaceId,
          agentId,
          status: "failed",
          durationMs: Date.now() - runStartedAt,
          toolCalls: toolCallsTotal,
          toolFailures: Math.max(1, toolFailures),
          createdAt: now().toISOString()
        });
        await persistTranscript(sessionId, transcriptRepo, undefined, allEvents, now);
        return {
          response: makeErrorRes(req.id, "INTERNAL_ERROR", "agent.run 未返回 runId"),
          events: responseEvents
        };
      }

      const finalUsage = estimateContextUsage(session.contextUsage, input, completedOutput);
      await sessionRepo.updateMeta(sessionId, {
        contextUsage: finalUsage
      });

      await metricsRepo.recordRun({
        sessionId,
        runId: acceptedRunId,
        tenantId,
        workspaceId,
        agentId,
        status: runStatus,
        durationMs: Date.now() - runStartedAt,
        toolCalls: toolCallsTotal,
        toolFailures,
        createdAt: now().toISOString()
      });

      const usageSnapshot = estimateRunUsage(input, completedOutput);
      await budgetRepo.addUsage({
        scopeKey: budgetScopeKey,
        date: now().toISOString().slice(0, 10),
        tokensUsed: usageSnapshot.tokensUsed,
        costUsd: usageSnapshot.costUsd
      });

      await auditRepo.append({
        tenantId,
        workspaceId,
        action: runStatus === "completed" ? "agent.run.completed" : "agent.run.failed",
        actor,
        resourceType: "run",
        resourceId: acceptedRunId,
        metadata: {
          sessionId,
          agentId,
          executionTargetId: selectedTarget.targetId,
          executionTargetKind: selectedTarget.kind,
          toolCallsTotal,
          toolFailures,
          budgetScopeKey,
          usageSnapshot
        },
        createdAt: now().toISOString()
      });

      await persistTranscript(sessionId, transcriptRepo, acceptedRunId, allEvents, now);

      return {
        response: makeSuccessRes(req.id, {
          runId: acceptedRunId,
          status: "accepted"
        }),
        events: responseEvents
      };
    }

    case "agent.abort": {
      const runId = requireString(req.params, "runId");
      if (!runId) {
        return invalidParams(req.id, "agent.abort 需要 runId");
      }

      await coreService.abort(runId);
      return {
        response: makeSuccessRes(req.id, {
          runId,
          status: "aborted"
        }),
        events: []
      };
    }

    case "policy.get": {
      const scopeKey = requireString(req.params, "scopeKey") ?? "default";
      const policy = await policyRepo.get(scopeKey);
      return {
        response: makeSuccessRes(req.id, {
          policy
        }),
        events: []
      };
    }

    case "policy.update": {
      const scopeKey = requireString(req.params, "scopeKey") ?? "default";
      const patch = toPolicyPatch(req.params);
      if (!patch) {
        return invalidParams(req.id, "policy.update 需要至少一个可更新字段");
      }
      const policy = await policyRepo.update(patch, scopeKey);
      await auditRepo.append({
        tenantId: requireString(req.params, "tenantId") ?? "t_default",
        workspaceId: requireString(req.params, "workspaceId") ?? "w_default",
        action: "policy.update",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "policy",
        resourceId: scopeKey,
        metadata: {
          toolDefault: policy.toolDefault,
          highRisk: policy.highRisk,
          bashMode: policy.bashMode,
          version: policy.version
        },
        createdAt: now().toISOString()
      });
      return {
        response: makeSuccessRes(req.id, {
          policy
        }),
        events: [
          createEvent(state, "session.updated", {
            reason: "policy.updated"
          })
        ]
      };
    }

    case "audit.query": {
      const query = toAuditQuery(req.params);
      const result = await auditRepo.query(query);
      return {
        response: makeSuccessRes(req.id, {
          items: result.items,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {})
        }),
        events: []
      };
    }

    case "metrics.summary": {
      const scope = toMetricsScope(req.params);
      const metrics = await metricsRepo.summary(scope);
      return {
        response: makeSuccessRes(req.id, {
          metrics,
          ...(Object.keys(scope).length > 0 ? { scope } : {})
        }),
        events: []
      };
    }

    case "memory.get": {
      const toolResult = await internalToolExecutor.execute(
        {
          name: "memory.get",
          args: req.params
        },
        {
          runId: `memory_get_${Date.now().toString(36)}`,
          sessionId: "session_memory_api",
          runtimeMode: "local"
        }
      );
      if (!toolResult.ok) {
        return {
          response: makeErrorRes(
            req.id,
            toolResult.error?.code === "TOOL_EXEC_FAILED" ? "TOOL_EXEC_FAILED" : "INTERNAL_ERROR",
            toolResult.error?.message ?? "memory.get 失败"
          ),
          events: []
        };
      }
      return {
        response: makeSuccessRes(req.id, {
          memory: parseToolJsonOutput(toolResult.output)
        }),
        events: []
      };
    }

    case "memory.appendDaily": {
      const toolResult = await internalToolExecutor.execute(
        {
          name: "memory.appendDaily",
          args: req.params
        },
        {
          runId: `memory_append_${Date.now().toString(36)}`,
          sessionId: "session_memory_api",
          runtimeMode: "local"
        }
      );
      if (!toolResult.ok) {
        return {
          response: makeErrorRes(
            req.id,
            toolResult.error?.code === "TOOL_EXEC_FAILED" ? "TOOL_EXEC_FAILED" : "INTERNAL_ERROR",
            toolResult.error?.message ?? "memory.appendDaily 失败"
          ),
          events: []
        };
      }
      return {
        response: makeSuccessRes(req.id, {
          result: parseToolJsonOutput(toolResult.output)
        }),
        events: []
      };
    }

    case "memory.archive": {
      const date = normalizeMemoryDate(req.params.date);
      if (!date) {
        return invalidParams(req.id, "memory.archive 的 date 必须为 YYYY-MM-DD");
      }
      const includeLongTerm = req.params.includeLongTerm !== false;
      const clearDaily = req.params.clearDaily !== false;
      const dailyPath = `memory/${date}.md`;

      let dailyText = "";
      const readResult = await internalToolExecutor.execute(
        {
          name: "file.read",
          args: {
            path: dailyPath
          }
        },
        {
          runId: `memory_archive_read_${Date.now().toString(36)}`,
          sessionId: "session_memory_api",
          runtimeMode: "local"
        }
      );
      if (readResult.ok) {
        dailyText = readResult.output ?? "";
      } else if (!String(readResult.error?.message ?? "").includes("ENOENT")) {
        return {
          response: makeErrorRes(
            req.id,
            readResult.error?.code === "TOOL_EXEC_FAILED" ? "TOOL_EXEC_FAILED" : "INTERNAL_ERROR",
            readResult.error?.message ?? "memory.archive 读取失败"
          ),
          events: []
        };
      }

      if (includeLongTerm && dailyText.trim().length > 0) {
        const archivedContent = [
          `## Archived ${date} (${now().toISOString()})`,
          "",
          dailyText.trimEnd(),
          ""
        ].join("\n");
        const appendResult = await internalToolExecutor.execute(
          {
            name: "file.write",
            args: {
              path: "MEMORY.md",
              content: `${archivedContent}\n`,
              append: true
            }
          },
          {
            runId: `memory_archive_append_${Date.now().toString(36)}`,
            sessionId: "session_memory_api",
            runtimeMode: "local"
          }
        );
        if (!appendResult.ok) {
          return {
            response: makeErrorRes(
              req.id,
              appendResult.error?.code === "TOOL_EXEC_FAILED" ? "TOOL_EXEC_FAILED" : "INTERNAL_ERROR",
              appendResult.error?.message ?? "memory.archive 归档失败"
            ),
            events: []
          };
        }
      }

      if (clearDaily) {
        const clearResult = await internalToolExecutor.execute(
          {
            name: "file.write",
            args: {
              path: dailyPath,
              content: "",
              append: false
            }
          },
          {
            runId: `memory_archive_clear_${Date.now().toString(36)}`,
            sessionId: "session_memory_api",
            runtimeMode: "local"
          }
        );
        if (!clearResult.ok) {
          return {
            response: makeErrorRes(
              req.id,
              clearResult.error?.code === "TOOL_EXEC_FAILED" ? "TOOL_EXEC_FAILED" : "INTERNAL_ERROR",
              clearResult.error?.message ?? "memory.archive 清理失败"
            ),
            events: []
          };
        }
      }

      return {
        response: makeSuccessRes(req.id, {
          result: {
            date,
            dailyPath,
            includeLongTerm,
            clearDaily,
            archivedLines: dailyText.length > 0 ? dailyText.split(/\r?\n/).length : 0,
            archivedBytes: byteLen(dailyText)
          }
        }),
        events: []
      };
    }

    default: {
      return {
        response: makeErrorRes(req.id, "METHOD_NOT_FOUND", `未知方法: ${req.method}`),
        events: []
      };
    }
  }
}

async function persistTranscript(
  sessionId: string,
  transcriptRepo: TranscriptRepository,
  runId: string | undefined,
  events: EventFrame[],
  now: () => Date
): Promise<void> {
  for (const event of filterEventsForTranscript(events)) {
    await transcriptRepo.append({
      sessionId,
      runId,
      event: event.event,
      payload: event.payload,
      createdAt: now().toISOString()
    });
  }
}

const TRANSCRIPT_KEY_EVENT_NAMES = new Set<EventFrame["event"]>([
  "agent.accepted",
  "agent.delta",
  "agent.tool_call_start",
  "agent.tool_call",
  "agent.tool_result_start",
  "agent.tool_result",
  "agent.completed",
  "agent.failed",
  "runtime.mode_changed",
  "session.updated"
]);

function filterEventsForTranscript(events: EventFrame[]): EventFrame[] {
  return events.filter((event) => TRANSCRIPT_KEY_EVENT_NAMES.has(event.event));
}

async function handleHttpRequest(
  req: any,
  res: any,
  router: GatewayRouter,
  httpConnections: Map<string, ConnectionState>
): Promise<void> {
  const method = typeof req.method === "string" ? req.method.toUpperCase() : "";
  const pathname = readPathname(req.url, req.headers?.host);

  if (method === "OPTIONS") {
    writeCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/health") {
    writeJson(res, 200, {
      ok: true,
      service: "gateway",
      time: new Date().toISOString()
    });
    return;
  }

  if (method === "POST" && pathname === "/auth/login") {
    const body = await readJsonBody(req);
    if (!isObjectRecord(body)) {
      writeJson(res, 400, {
        error: "INVALID_REQUEST",
        message: "body 必须是对象"
      });
      return;
    }
    try {
      const payload = await router.auth?.login(body);
      writeJson(res, 200, payload ?? {
        error: "NOT_SUPPORTED",
        message: "auth endpoint not enabled"
      });
    } catch (error) {
      writeAuthHttpError(res, error);
    }
    return;
  }

  if (method === "POST" && pathname === "/auth/refresh") {
    const body = await readJsonBody(req);
    if (!isObjectRecord(body)) {
      writeJson(res, 400, {
        error: "INVALID_REQUEST",
        message: "body 必须是对象"
      });
      return;
    }
    try {
      const payload = await router.auth?.refresh(body);
      writeJson(res, 200, payload ?? {
        error: "NOT_SUPPORTED",
        message: "auth endpoint not enabled"
      });
    } catch (error) {
      writeAuthHttpError(res, error);
    }
    return;
  }

  if (method === "GET" && pathname === "/auth/me") {
    const authorization = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
    try {
      const payload = await router.auth?.me(authorization);
      writeJson(res, 200, payload ?? {
        error: "NOT_SUPPORTED",
        message: "auth endpoint not enabled"
      });
    } catch (error) {
      writeAuthHttpError(res, error);
    }
    return;
  }

  if (method === "POST" && pathname === "/auth/logout") {
    const body = await readJsonBody(req);
    if (!isObjectRecord(body)) {
      writeJson(res, 400, {
        error: "INVALID_REQUEST",
        message: "body 必须是对象"
      });
      return;
    }
    try {
      const payload = await router.auth?.logout(body);
      writeJson(res, 200, payload ?? {
        error: "NOT_SUPPORTED",
        message: "auth endpoint not enabled"
      });
    } catch (error) {
      writeAuthHttpError(res, error);
    }
    return;
  }

  if (method === "POST" && pathname === "/rpc") {
    const body = await readJsonBody(req);
    const connectionId = readConnectionId(req.url, req.headers?.host, req.headers?.["x-openfoal-connection-id"]);
    const state = getOrCreateConnectionState(httpConnections, connectionId);
    const result = await router.handle(body, state, {
      transport: "http"
    });
    writeJson(res, 200, result);
    return;
  }

  writeJson(res, 404, {
    error: "NOT_FOUND"
  });
}

async function handleUpgrade(req: any, socket: any, head: any, router: GatewayRouter): Promise<void> {
  try {
    const pathname = readPathname(req.url, req.headers?.host);
    if (pathname !== "/ws") {
      writeUpgradeFailure(socket, 404, "Not Found");
      return;
    }

    const wsKey = req.headers?.["sec-websocket-key"];
    if (typeof wsKey !== "string" || wsKey.trim().length === 0) {
      writeUpgradeFailure(socket, 400, "Missing Sec-WebSocket-Key");
      return;
    }

    const accept = createHash("sha1")
      .update(`${wsKey.trim()}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        ""
      ].join("\r\n")
    );

    const state = createConnectionState();
    let raw = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
    let processing = Promise.resolve();

    socket.on("data", (chunk: any) => {
      raw = Buffer.concat([raw, chunk]);
      processing = processing
        .then(async () => {
          while (true) {
            const parsed = tryParseWsFrame(raw);
            if (!parsed) {
              break;
            }
            raw = parsed.rest;

            if (parsed.opcode === 0x8) {
              socket.end();
              return;
            }

            if (parsed.opcode === 0x9) {
              socket.write(encodeWsFrame(parsed.payload, 0x0a));
              continue;
            }

            if (parsed.opcode !== 0x1) {
              continue;
            }

            const text = parsed.payload.toString("utf8");
            let input: unknown;
            try {
              input = JSON.parse(text);
            } catch {
              input = text;
            }

            const method = readWsMethod(input);
            if (method === "agent.run") {
              const result = await router.handle(input, state, {
                transport: "ws",
                onEvent: (event) => {
                  socket.write(encodeWsFrame(Buffer.from(JSON.stringify(event), "utf8"), 0x1));
                }
              });
              socket.write(encodeWsFrame(Buffer.from(JSON.stringify(result.response), "utf8"), 0x1));
              continue;
            }

            const result = await router.handle(input, state, {
              transport: "ws"
            });
            socket.write(encodeWsFrame(Buffer.from(JSON.stringify(result.response), "utf8"), 0x1));
            for (const event of result.events) {
              socket.write(encodeWsFrame(Buffer.from(JSON.stringify(event), "utf8"), 0x1));
            }
          }
        })
        .catch(() => {
          if (!socket.destroyed) {
            socket.destroy();
          }
        });
    });

    socket.on("error", () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    });
  } catch {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }
}

function writeUpgradeFailure(socket: any, code: number, message: string): void {
  socket.write(
    [
      `HTTP/1.1 ${code} ${message}`,
      "Connection: close",
      "Content-Length: 0",
      "",
      ""
    ].join("\r\n")
  );
  socket.destroy();
}

function tryParseWsFrame(raw: any): { opcode: number; payload: any; rest: any } | null {
  if (raw.length < 2) {
    return null;
  }

  const first = raw[0];
  const second = raw[1];
  const opcode = first & 0x0f;
  let offset = 2;
  let payloadLength = second & 0x7f;
  const masked = (second & 0x80) !== 0;

  if (payloadLength === 126) {
    if (raw.length < offset + 2) {
      return null;
    }
    payloadLength = raw.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (raw.length < offset + 8) {
      return null;
    }
    const high = raw.readUInt32BE(offset);
    const low = raw.readUInt32BE(offset + 4);
    payloadLength = high * 2 ** 32 + low;
    offset += 8;
  }

  let mask: any = null;
  if (masked) {
    if (raw.length < offset + 4) {
      return null;
    }
    mask = raw.subarray(offset, offset + 4);
    offset += 4;
  }

  if (raw.length < offset + payloadLength) {
    return null;
  }

  const payload = Buffer.from(raw.subarray(offset, offset + payloadLength));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = payload[i] ^ mask[i % 4];
    }
  }

  return {
    opcode,
    payload,
    rest: raw.subarray(offset + payloadLength)
  };
}

function encodeWsFrame(payload: any, opcode: number): any {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header: number[] = [0x80 | (opcode & 0x0f)];

  if (bytes.length < 126) {
    header.push(bytes.length);
  } else if (bytes.length <= 0xffff) {
    header.push(126, (bytes.length >>> 8) & 0xff, bytes.length & 0xff);
  } else {
    const high = Math.floor(bytes.length / 2 ** 32);
    const low = bytes.length >>> 0;
    header.push(
      127,
      (high >>> 24) & 0xff,
      (high >>> 16) & 0xff,
      (high >>> 8) & 0xff,
      high & 0xff,
      (low >>> 24) & 0xff,
      (low >>> 16) & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff
    );
  }

  return Buffer.concat([Buffer.from(header), bytes]);
}

function readPathname(rawUrl: string | undefined, host: string | undefined): string {
  const url = new URL(rawUrl ?? "/", `http://${host ?? "127.0.0.1"}`);
  return url.pathname;
}

function readConnectionId(rawUrl: string | undefined, host: string | undefined, headerValue: unknown): string {
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  const url = new URL(rawUrl ?? "/", `http://${host ?? "127.0.0.1"}`);
  const fromQuery = url.searchParams.get("connectionId");
  return fromQuery && fromQuery.trim().length > 0 ? fromQuery.trim() : "http_default";
}

function readWsMethod(input: unknown): MethodName | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const method = (input as Record<string, unknown>).method;
  if (typeof method !== "string") {
    return undefined;
  }
  return method as MethodName;
}

async function readJsonBody(req: any): Promise<unknown> {
  const chunks: any[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: any) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve();
    });
    req.on("error", (error: unknown) => {
      reject(error);
    });
  });

  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function writeJson(res: any, statusCode: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.statusCode = statusCode;
  writeCorsHeaders(res);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(Buffer.byteLength(text)));
  res.end(text);
}

function writeAuthHttpError(res: any, error: unknown): void {
  if (error instanceof AuthHttpError) {
    writeJson(res, error.statusCode, {
      error: error.code,
      message: error.message
    });
    return;
  }
  writeJson(res, 500, {
    error: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error)
  });
}

function writeCorsHeaders(res: any): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization,x-openfoal-connection-id");
}

function getOrCreateConnectionState(
  states: Map<string, ConnectionState>,
  connectionId: string
): ConnectionState {
  const existing = states.get(connectionId);
  if (existing) {
    return existing;
  }
  const created = createConnectionState();
  states.set(connectionId, created);
  return created;
}

async function listen(server: any, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: any): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function createSession(id: string, runtimeMode: RuntimeMode, title = DEFAULT_SESSION_TITLE): SessionRecord {
  return {
    id,
    sessionKey: `workspace:w_default/agent:a_default/main:thread:${id}`,
    title: normalizeSessionTitle(title),
    preview: DEFAULT_SESSION_PREVIEW,
    runtimeMode,
    syncState: "local_only",
    contextUsage: 0,
    compactionCount: 0,
    memoryFlushState: "idle",
    updatedAt: new Date().toISOString()
  };
}

function createSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function withSessionInput(session: SessionRecord, input: string): SessionRecord {
  const nextTitle =
    session.title === DEFAULT_SESSION_TITLE ? normalizeSessionTitle(summarizeInputForTitle(input)) : session.title;
  const nextPreview = summarizeInputForPreview(input);
  return {
    ...session,
    title: nextTitle,
    preview: nextPreview
  };
}

function summarizeInputForTitle(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return DEFAULT_SESSION_TITLE;
  }
  return compact.slice(0, 32);
}

function summarizeInputForPreview(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return DEFAULT_SESSION_PREVIEW;
  }
  return compact.slice(0, 80);
}

function normalizeSessionTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return DEFAULT_SESSION_TITLE;
  }
  return compact.slice(0, 32);
}

function mapCoreEvent(coreEvent: CoreEvent): { event: EventFrame["event"]; payload: Record<string, unknown> } {
  switch (coreEvent.type) {
    case "accepted":
      return {
        event: "agent.accepted",
        payload: {
          runId: coreEvent.runId,
          sessionId: coreEvent.sessionId,
          runtimeMode: coreEvent.runtimeMode
        }
      };
    case "delta":
      return {
        event: "agent.delta",
        payload: {
          runId: coreEvent.runId,
          delta: coreEvent.text
        }
      };
    case "tool_call_start":
      return {
        event: "agent.tool_call_start",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName
        }
      };
    case "tool_call_delta":
      return {
        event: "agent.tool_call_delta",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          delta: coreEvent.delta
        }
      };
    case "tool_call":
      return {
        event: "agent.tool_call",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          args: coreEvent.args
        }
      };
    case "tool_result_start":
      return {
        event: "agent.tool_result_start",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName
        }
      };
    case "tool_result_delta":
      return {
        event: "agent.tool_result_delta",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          delta: coreEvent.delta
        }
      };
    case "tool_result":
      return {
        event: "agent.tool_result",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          output: coreEvent.output
        }
      };
    case "completed":
      return {
        event: "agent.completed",
        payload: {
          runId: coreEvent.runId,
          output: coreEvent.output
        }
      };
    case "failed":
      return {
        event: "agent.failed",
        payload: {
          runId: coreEvent.runId,
          code: coreEvent.code,
          message: coreEvent.message
        }
      };
    default:
      return assertNever(coreEvent);
  }
}

function createEvent(
  state: ConnectionState,
  event: EventFrame["event"],
  payload: Record<string, unknown>
): EventFrame {
  state.stateVersion += 1;
  const frame: EventFrame = {
    type: "event",
    event,
    payload,
    seq: state.nextSeq,
    stateVersion: state.stateVersion
  };
  state.nextSeq += 1;
  return frame;
}

function isHttpCompatibleRunEvent(eventName: EventFrame["event"]): boolean {
  return (
    eventName !== "agent.tool_call_start" &&
    eventName !== "agent.tool_call_delta" &&
    eventName !== "agent.tool_result_start" &&
    eventName !== "agent.tool_result_delta"
  );
}

function invalidParams(id: string, message: string): GatewayHandleResult {
  return {
    response: makeErrorRes(id, "INVALID_REQUEST", message),
    events: []
  };
}

function requireString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRuntimeMode(value: unknown): RuntimeMode | undefined {
  return value === "local" || value === "cloud" ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const floored = Math.floor(value);
  if (floored <= 0) {
    return undefined;
  }
  return floored;
}

function asLlmOptions(
  value: unknown
):
  | {
      modelRef?: string;
      provider?: string;
      modelId?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const data = value as Record<string, unknown>;
  const modelRef = requireString(data, "modelRef");
  const provider = requireString(data, "provider");
  const modelId = requireString(data, "modelId");
  const apiKey = requireString(data, "apiKey");
  const baseUrl = requireString(data, "baseUrl");

  if (!modelRef && !provider && !modelId && !apiKey && !baseUrl) {
    return undefined;
  }

  return {
    ...(modelRef ? { modelRef } : {}),
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {})
  };
}

const HIGH_RISK_TOOLS = new Set(["bash.exec", "http.request", "file.write", "memory.appendDaily"]);
const PRE_COMPACTION_THRESHOLD = 0.85;

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

function asPolicyDecision(value: unknown): PolicyDecision | undefined {
  return value === "deny" || value === "allow" ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPolicyPatch(params: Record<string, unknown>): PolicyPatch | undefined {
  const source = isObjectRecord(params.patch) ? params.patch : params;
  const toolDefault = asPolicyDecision(source.toolDefault);
  const highRisk = asPolicyDecision(source.highRisk);
  const bashMode = source.bashMode === "host" || source.bashMode === "sandbox" ? source.bashMode : undefined;
  const tools: Record<string, PolicyDecision> = {};
  if (isObjectRecord(source.tools)) {
    for (const [name, decision] of Object.entries(source.tools)) {
      const parsed = asPolicyDecision(decision);
      if (parsed) {
        tools[name] = parsed;
      }
    }
  }

  const patch: PolicyPatch = {
    ...(toolDefault ? { toolDefault } : {}),
    ...(highRisk ? { highRisk } : {}),
    ...(bashMode ? { bashMode } : {}),
    ...(Object.keys(tools).length > 0 ? { tools } : {})
  };
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function toBudgetPatch(params: Record<string, unknown>): BudgetPolicyPatch | undefined {
  const source = isObjectRecord(params.patch) ? params.patch : params;
  const tokenDailyLimit = toNullableLimit(source.tokenDailyLimit);
  const costMonthlyUsdLimit = toNullableLimit(source.costMonthlyUsdLimit);
  const hardLimit = typeof source.hardLimit === "boolean" ? source.hardLimit : undefined;

  const patch: BudgetPolicyPatch = {
    ...(tokenDailyLimit !== undefined ? { tokenDailyLimit } : {}),
    ...(costMonthlyUsdLimit !== undefined ? { costMonthlyUsdLimit } : {}),
    ...(hardLimit !== undefined ? { hardLimit } : {})
  };
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function toNullableLimit(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < 0) {
    return 0;
  }
  return Number(value.toFixed(6));
}

function toMetricsScope(params: Record<string, unknown>): MetricsScopeFilter {
  return {
    ...(requireString(params, "tenantId") ? { tenantId: requireString(params, "tenantId") } : {}),
    ...(requireString(params, "workspaceId") ? { workspaceId: requireString(params, "workspaceId") } : {}),
    ...(requireString(params, "agentId") ? { agentId: requireString(params, "agentId") } : {})
  };
}

function toAuditQuery(params: Record<string, unknown>): AuditQuery {
  return {
    ...(requireString(params, "tenantId") ? { tenantId: requireString(params, "tenantId") } : {}),
    ...(requireString(params, "workspaceId") ? { workspaceId: requireString(params, "workspaceId") } : {}),
    ...(requireString(params, "action") ? { action: requireString(params, "action") } : {}),
    ...(requireString(params, "from") ? { from: requireString(params, "from") } : {}),
    ...(requireString(params, "to") ? { to: requireString(params, "to") } : {}),
    ...(asPositiveInt(params.limit) ? { limit: asPositiveInt(params.limit) } : {}),
    ...(asPositiveInt(params.cursor) ? { cursor: asPositiveInt(params.cursor) } : {})
  };
}

async function resolveExecutionTarget(input: {
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

function resolveBudgetScopeKey(
  params: Record<string, unknown>,
  tenantId: string,
  workspaceId: string,
  agentId: string
): string {
  const explicit = requireString(params, "budgetScopeKey");
  if (explicit) {
    return explicit;
  }
  const level = requireString(params, "budgetLevel");
  if (level === "agent") {
    return `agent:${tenantId}:${workspaceId}:${agentId}`;
  }
  if (level === "tenant") {
    return `tenant:${tenantId}`;
  }
  return `workspace:${tenantId}:${workspaceId}`;
}

function getBudgetExceededReason(
  policy: {
    tokenDailyLimit: number | null;
    costMonthlyUsdLimit: number | null;
    hardLimit: boolean;
  },
  usage: {
    tokensUsedDaily: number;
    costUsdMonthly: number;
  }
): string | undefined {
  if (!policy.hardLimit) {
    return undefined;
  }
  if (policy.tokenDailyLimit !== null && usage.tokensUsedDaily >= policy.tokenDailyLimit) {
    return `tokenDailyLimit(${policy.tokenDailyLimit})`;
  }
  if (policy.costMonthlyUsdLimit !== null && usage.costUsdMonthly >= policy.costMonthlyUsdLimit) {
    return `costMonthlyUsdLimit(${policy.costMonthlyUsdLimit})`;
  }
  return undefined;
}

function estimateRunUsage(input: string, output: string): { tokensUsed: number; costUsd: number } {
  const totalChars = Math.max(0, input.length + output.length);
  const tokensUsed = Math.max(1, Math.ceil(totalChars / 4));
  const costUsd = Number((tokensUsed * 0.000002).toFixed(6));
  return {
    tokensUsed,
    costUsd
  };
}

function defaultBudgetScopeKey(): string {
  return "workspace:t_default:w_default";
}

function resolveToolDecision(policy: PolicyRecord, toolName: string): PolicyDecision {
  const exact = policy.tools[toolName];
  if (exact) {
    return exact;
  }
  if (HIGH_RISK_TOOLS.has(toolName)) {
    return policy.highRisk;
  }
  return policy.toolDefault;
}

function createPolicyAwareToolExecutor(input: {
  base: ToolExecutor;
  policyRepo: PolicyRepository;
}): ToolExecutor {
  return {
    async execute(call, ctx, hooks): Promise<ToolResult> {
      const policy = await input.policyRepo.get("default");
      const decision = resolveToolDecision(policy, call.name);

      if (decision === "deny") {
        return {
          ok: false,
          error: {
            code: "POLICY_DENIED",
            message: `策略拒绝执行工具: ${call.name}`
          }
        };
      }

      return await input.base.execute(call, ctx, hooks);
    }
  };
}

function createExecutionTargetToolExecutor(input: {
  local: ToolExecutor;
  dockerRunnerInvoker: DockerRunnerInvoker;
  getExecutionTarget: (sessionId: string) => ExecutionTargetRecord | undefined;
}): ToolExecutor {
  return {
    async execute(call: ToolCall, ctx: ToolContext, hooks?: ToolExecutionHooks): Promise<ToolResult> {
      const target = input.getExecutionTarget(ctx.sessionId);
      if (!target || target.kind === "local-host") {
        return await input.local.execute(call, ctx, hooks);
      }
      return await input.dockerRunnerInvoker({
        target,
        call,
        ctx,
        hooks
      });
    }
  };
}

async function invokeDockerRunnerOverHttp(input: DockerRunnerInvokeInput): Promise<ToolResult> {
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

async function prepareSessionForRun(input: {
  sessionRepo: SessionRepository;
  toolExecutor: ToolExecutor;
  session: SessionRecord;
  input: string;
  now: () => Date;
}): Promise<SessionRecord> {
  let current = input.session;
  const projectedUsage = estimateContextUsage(current.contextUsage, input.input);
  const initialMeta = await input.sessionRepo.updateMeta(current.id, {
    contextUsage: projectedUsage,
    memoryFlushState: projectedUsage >= PRE_COMPACTION_THRESHOLD ? "pending" : "idle"
  });
  if (initialMeta) {
    current = initialMeta;
  }

  if (projectedUsage < PRE_COMPACTION_THRESHOLD) {
    return current;
  }

  let flushState: "flushed" | "skipped" = "skipped";
  try {
    const flush = await input.toolExecutor.execute(
      {
        name: "memory.appendDaily",
        args: {
          content: `[NO_REPLY] pre-compaction session=${current.id} ${summarizeForMemory(input.input)}`,
          includeLongTerm: false
        }
      },
      {
        runId: `flush_${Date.now().toString(36)}`,
        sessionId: current.id,
        runtimeMode: current.runtimeMode
      }
    );
    flushState = flush.ok ? "flushed" : "skipped";
  } catch {
    flushState = "skipped";
  }

  const flushedMeta = await input.sessionRepo.updateMeta(current.id, {
    memoryFlushState: flushState,
    ...(flushState === "flushed"
      ? {
          memoryFlushAt: input.now().toISOString(),
          compactionCount: current.compactionCount + 1,
          contextUsage: Math.max(0.35, projectedUsage - 0.45)
        }
      : {})
  });
  if (flushedMeta) {
    current = flushedMeta;
  }
  return current;
}

function summarizeForMemory(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(empty input)";
  }
  return compact.slice(0, 320);
}

function estimateContextUsage(current: number, inputText: string, outputText = ""): number {
  const base = Number.isFinite(current) ? Math.max(0, Math.min(1, current)) : 0;
  const delta = Math.min(0.45, (inputText.length + outputText.length) / 12_000);
  return Math.min(1, Number((base + delta).toFixed(6)));
}

function getIdempotencyKey(req: ReqFrame): string | undefined {
  if (!isSideEffectMethod(req.method)) {
    return undefined;
  }
  const value = req.params.idempotencyKey;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function buildIdempotencyCacheKey(req: ReqFrame, idempotencyKey: string): string {
  const scope =
    requireString(req.params, "sessionId") ?? requireString(req.params, "runId") ?? "global";
  return `${req.method}:${scope}:${idempotencyKey}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    output[key] = sortObject(input[key]);
  }
  return output;
}

function cloneResult(result: GatewayHandleResult): GatewayHandleResult {
  return JSON.parse(JSON.stringify(result)) as GatewayHandleResult;
}

function parseToolJsonOutput(output: string | undefined): unknown {
  if (!output) {
    return {};
  }
  try {
    return JSON.parse(output);
  } catch {
    return {
      text: output
    };
  }
}

function normalizeMemoryDate(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  if (value === undefined || value === null) {
    return new Date().toISOString().slice(0, 10);
  }
  return undefined;
}

function byteLen(text: string): number {
  return Buffer.byteLength(text ?? "");
}

function extractRequestId(input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const maybeId = (input as Record<string, unknown>).id;
    if (typeof maybeId === "string" && maybeId.trim().length > 0) {
      return maybeId;
    }
  }
  return "invalid_req";
}

function assertNever(x: never): never {
  throw new Error(`Unhandled core event variant: ${JSON.stringify(x)}`);
}
