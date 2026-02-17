import { createRuntimeCoreService, type CoreEvent, type CoreService } from "../../../packages/core/dist/index.js";
import {
  DEFAULT_SESSION_PREVIEW,
  DEFAULT_SESSION_TITLE,
  FsBlobStore,
  InMemoryAuthStore,
  InMemoryIdempotencyRepository,
  InMemoryAgentRepository,
  InMemoryAuditRepository,
  InMemoryBudgetRepository,
  InMemoryExecutionTargetRepository,
  InMemoryModelSecretRepository,
  InMemoryMetricsRepository,
  InMemoryPolicyRepository,
  InMemorySessionRepository,
  InMemoryTranscriptRepository,
  MinioBlobStore,
  PostgresAgentRepository,
  PostgresAuditRepository,
  PostgresAuthStore,
  PostgresBudgetRepository,
  PostgresExecutionTargetRepository,
  PostgresIdempotencyRepository,
  PostgresMetricsRepository,
  PostgresModelSecretRepository,
  PostgresPolicyRepository,
  PostgresSessionRepository,
  PostgresTranscriptRepository,
  RedisConnectionBindingStore,
  RedisIdempotencyRepository,
  SqliteAgentRepository,
  SqliteAuthStore,
  SqliteAuditRepository,
  SqliteBudgetRepository,
  SqliteExecutionTargetRepository,
  SqliteIdempotencyRepository,
  SqliteModelSecretRepository,
  SqliteMetricsRepository,
  SqlitePolicyRepository,
  SqliteSessionRepository,
  SqliteTranscriptRepository,
  syncLocalDirectoryToMinio,
  type AgentDefinitionRecord,
  type AgentRepository,
  type AuditQuery,
  type AuditRepository,
  type BlobStore,
  type BudgetPolicyPatch,
  type BudgetRepository,
  type ExecutionTargetRecord,
  type ExecutionTargetRepository,
  type IdempotencyRepository,
  type MembershipRole,
  type MetricsRepository,
  type MetricsScopeFilter,
  type ModelSecretMetaRecord,
  type ModelSecretRecord,
  type ModelSecretRepository,
  type AuthStore,
  type PolicyDecision,
  type PolicyPatch,
  type PolicyRecord,
  type PolicyRepository,
  type RuntimeMode,
  type SessionRecord,
  type SessionRepository,
  type TenantUserRecord,
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
  computeNextDailyRunAt,
  defaultSkillSyncConfig,
  defaultTimezone,
  isSkillSyncScope,
  normalizeSkillSyncPatch,
  resolveEffectiveSkillSyncConfig,
  validateSecurityBoundary,
  type SkillSyncConfig,
  type SkillSyncConfigPatch,
  type SkillSyncLicense,
  type SkillSyncMode,
  type SkillSyncScope
} from "../../../packages/skill-engine/dist/index.js";
import {
  AuthHttpError,
  createGatewayAuthRuntime,
  hashPasswordForStorage,
  resolveAuthRuntimeConfig,
  type GatewayAuthRuntime,
  type Principal
} from "./auth.js";
import { handleAgentRun } from "./agent/handle-agent-run.js";
import {
  createExecutionTargetToolExecutor as createExecutionTargetToolExecutorModule,
  createPolicyAwareToolExecutor as createPolicyAwareToolExecutorModule
} from "./agent/tool-executor-adapters.js";
import { invokeDockerRunnerOverHttp as invokeDockerRunnerOverHttpModule } from "./agent/execution-target.js";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createServer, request as httpRequest } from "node:http";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpsRequest } from "node:https";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createHash } from "node:crypto";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { resolve as resolvePath } from "node:path";

declare const Buffer: any;
declare const process: any;

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
  runSkillSyncSchedulerTick?: () => Promise<void>;
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
  storageBackend?: "sqlite" | "postgres";
  postgresUrl?: string;
  redisUrl?: string;
  blobBackend?: "fs" | "minio";
  enterpriseStorageRoot?: string;
  router?: GatewayRouter;
}

export interface GatewayServerHandle {
  host: string;
  port: number;
  close(): Promise<void>;
}

type SkillSyncScopeRef = {
  scope: SkillSyncScope;
  tenantId: string;
  workspaceId: string;
  userId: string;
  key: string;
};

type SkillSyncConfigRecord = {
  scope: SkillSyncScope;
  tenantId: string;
  workspaceId: string;
  userId: string;
  config: SkillSyncConfigPatch;
  updatedAt: string;
  updatedBy: string;
};

type SkillSyncRunStatus =
  | "success"
  | "skipped_offline"
  | "skipped_manual_only"
  | "skipped_bundle_only"
  | "failed";

type SkillSyncRunRecord = {
  runId: string;
  scope: SkillSyncScope;
  tenantId: string;
  workspaceId: string;
  userId: string;
  startedAt: string;
  finishedAt: string;
  status: SkillSyncRunStatus;
  trigger: "scheduled" | "manual";
  fetchedSources: number;
  importedSkills: number;
  error?: string;
};

type SkillSyncStatusRecord = {
  scope: SkillSyncScope;
  tenantId: string;
  workspaceId: string;
  userId: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastOutcome?: SkillSyncRunStatus;
  lastError?: string;
};

type SkillBundleItemRecord = {
  skillId: string;
  source?: string;
  commit?: string;
  path?: string;
  checksum?: string;
  license?: SkillSyncLicense;
  tags: string[];
};

type SkillBundleRecord = {
  bundleId: string;
  name: string;
  checksum: string;
  signature?: string;
  createdAt: string;
  createdBy: string;
  items: SkillBundleItemRecord[];
};

type SkillCatalogAvailability = "online" | "cached" | "unavailable";

type SkillCatalogItem = {
  skillId: string;
  source?: string;
  commit?: string;
  path?: string;
  checksum?: string;
  license?: SkillSyncLicense;
  tags: string[];
  availability: SkillCatalogAvailability;
};

type SkillInstalledRecord = {
  skillId: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  installedAt: string;
  installedBy: string;
  source?: string;
  commit?: string;
  path?: string;
  checksum?: string;
  license?: SkillSyncLicense;
  tags: string[];
};

type DockerRunnerInvokeInput = {
  target: ExecutionTargetRecord;
  call: ToolCall;
  ctx: ToolContext;
  hooks?: ToolExecutionHooks;
};

type DockerRunnerInvoker = (input: DockerRunnerInvokeInput) => Promise<ToolResult>;

type GatewayLlmOptions = {
  modelRef?: string;
  provider?: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
};

type CloudFailurePolicy = "deny" | "fallback_local";

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
  modelSecretRepo?: ModelSecretRepository;
  policyRepo?: PolicyRepository;
  metricsRepo?: MetricsRepository;
  authStore?: AuthStore;
  authRuntime?: GatewayAuthRuntime;
  blobStore?: BlobStore;
  blobBackend?: "fs" | "minio";
  storageBackend?: "memory" | "sqlite" | "postgres";
  enterpriseStorageRoot?: string;
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
  const modelSecretRepo = deps.modelSecretRepo ?? new InMemoryModelSecretRepository();
  const policyRepo = deps.policyRepo ?? new InMemoryPolicyRepository();
  const metricsRepo = deps.metricsRepo ?? new InMemoryMetricsRepository();
  const authStore = deps.authStore ?? new InMemoryAuthStore();
  const now = deps.now ?? (() => new Date());
  const blobStore = deps.blobStore;
  const blobBackend = deps.blobBackend ?? "fs";
  const storageBackend = deps.storageBackend ?? "memory";
  const enterpriseStorageRoot = deps.enterpriseStorageRoot ?? sanitizeStorageRoot(process.env.OPENFOAL_ENTERPRISE_STORAGE_ROOT ?? "/data/openfoal");
  const authRuntime = deps.authRuntime ?? createGatewayAuthRuntime({
    config: resolveAuthRuntimeConfig(),
    store: authStore,
    now
  });
  const baseToolExecutor = deps.toolExecutor ?? createLocalToolExecutor();
  const internalToolExecutor = deps.internalToolExecutor ?? baseToolExecutor;
  const enableCloudProbe = deps.dockerRunnerInvoker === undefined;
  const dockerRunnerInvoker = deps.dockerRunnerInvoker ?? invokeDockerRunnerOverHttpModule;
  const sessionExecutionTargets = new Map<string, ExecutionTargetRecord>();
  const sessionToolScopes = new Map<string, { tenantId: string; workspaceId: string; userId: string; workspaceRoot?: string }>();
  const targetAwareToolExecutor = createExecutionTargetToolExecutorModule({
    local: baseToolExecutor,
    dockerRunnerInvoker,
    getExecutionTarget: (sessionId) => sessionExecutionTargets.get(sessionId),
    getToolScope: (sessionId) => sessionToolScopes.get(sessionId)
  });
  const policyAwareToolExecutor = createPolicyAwareToolExecutorModule({
    base: targetAwareToolExecutor,
    policyRepo
  });
  const coreService = deps.coreService ?? createRuntimeCoreService({ toolExecutor: policyAwareToolExecutor });
  const skillSyncConfigs = new Map<string, SkillSyncConfigRecord>();
  const skillSyncStatuses = new Map<string, SkillSyncStatusRecord>();
  const skillSyncRuns: SkillSyncRunRecord[] = [];
  const skillBundles = new Map<string, SkillBundleRecord>();
  const skillCatalog = new Map<string, SkillCatalogItem>();
  const installedSkills = new Map<string, SkillInstalledRecord>();
  const knownSkillSources = new Set<string>(defaultSkillSyncConfig({}).sourceFilters);
  const runSkillSyncSchedulerTick = async (): Promise<void> => {
    await tickSkillSyncScheduler({
      now,
      configs: skillSyncConfigs,
      statuses: skillSyncStatuses,
      runs: skillSyncRuns,
      catalog: skillCatalog,
      knownSources: knownSkillSources
    });
  };

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
        modelSecretRepo,
        policyRepo,
        metricsRepo,
        authStore,
        idempotencyRepo,
        internalToolExecutor,
        sessionExecutionTargets,
        sessionToolScopes,
        enableCloudProbe,
        storageBackend,
        blobBackend,
        blobStore,
        enterpriseStorageRoot,
        now,
        options,
        skillSyncConfigs,
        skillSyncStatuses,
        skillSyncRuns,
        skillBundles,
        skillCatalog,
        installedSkills,
        knownSkillSources
      );

      if (idempotencyKey && result.response.ok) {
        await idempotencyRepo.set(idempotencyKey, {
          fingerprint,
          result: cloneResult(result)
        });
      }

      return result;
    },
    runSkillSyncSchedulerTick,
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
  const storageBackend = options.storageBackend ?? resolveGatewayStorageBackend(process.env.OPENFOAL_GATEWAY_STORAGE_BACKEND);
  const postgresUrl = options.postgresUrl ?? readNonEmptyString(process.env.OPENFOAL_POSTGRES_URL);
  const redisUrl = options.redisUrl ?? readNonEmptyString(process.env.OPENFOAL_REDIS_URL);
  const blobBackend = options.blobBackend ?? resolveBlobBackend(process.env.OPENFOAL_BLOB_BACKEND);
  const enterpriseStorageRoot = options.enterpriseStorageRoot ?? sanitizeStorageRoot(process.env.OPENFOAL_ENTERPRISE_STORAGE_ROOT ?? "/data/openfoal");
  const idempotencyBackend = resolveIdempotencyBackend(process.env.OPENFOAL_IDEMPOTENCY_BACKEND, storageBackend);
  const blobStore =
    storageBackend === "postgres"
      ? blobBackend === "minio"
        ? new MinioBlobStore({
            endpoint: readNonEmptyString(process.env.OPENFOAL_MINIO_ENDPOINT),
            region: readNonEmptyString(process.env.OPENFOAL_MINIO_REGION),
            accessKeyId: readNonEmptyString(process.env.OPENFOAL_MINIO_ACCESS_KEY),
            secretAccessKey: readNonEmptyString(process.env.OPENFOAL_MINIO_SECRET_KEY),
            bucket: readNonEmptyString(process.env.OPENFOAL_MINIO_BUCKET)
          })
        : new FsBlobStore(enterpriseStorageRoot)
      : undefined;
  const connectionBindingStore =
    storageBackend === "postgres" && redisUrl
      ? new RedisConnectionBindingStore({
          redisUrl,
          keyPrefix: "openfoal:conn"
        })
      : undefined;

  const router =
    options.router ??
    (storageBackend === "postgres"
      ? createGatewayRouter({
          sessionRepo: new PostgresSessionRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          transcriptRepo: new PostgresTranscriptRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          idempotencyRepo:
            idempotencyBackend === "redis" && redisUrl
              ? new RedisIdempotencyRepository({
                  redisUrl,
                  keyPrefix: "openfoal:idem"
                })
              : new PostgresIdempotencyRepository({
                  ...(postgresUrl ? { connectionString: postgresUrl } : {})
                }),
          agentRepo: new PostgresAgentRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          executionTargetRepo: new PostgresExecutionTargetRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          budgetRepo: new PostgresBudgetRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          auditRepo: new PostgresAuditRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          modelSecretRepo: new PostgresModelSecretRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          policyRepo: new PostgresPolicyRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          metricsRepo: new PostgresMetricsRepository({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          authStore: new PostgresAuthStore({
            ...(postgresUrl ? { connectionString: postgresUrl } : {})
          }),
          ...(blobStore ? { blobStore } : {}),
          blobBackend,
          storageBackend: "postgres",
          enterpriseStorageRoot
        })
      : createGatewayRouter({
          sessionRepo: new SqliteSessionRepository(options.sqlitePath),
          transcriptRepo: new SqliteTranscriptRepository(options.sqlitePath),
          idempotencyRepo: new SqliteIdempotencyRepository(options.sqlitePath),
          agentRepo: new SqliteAgentRepository(options.sqlitePath),
          executionTargetRepo: new SqliteExecutionTargetRepository(options.sqlitePath),
          budgetRepo: new SqliteBudgetRepository(options.sqlitePath),
          auditRepo: new SqliteAuditRepository(options.sqlitePath),
          modelSecretRepo: new SqliteModelSecretRepository(options.sqlitePath),
          policyRepo: new SqlitePolicyRepository(options.sqlitePath),
          metricsRepo: new SqliteMetricsRepository(options.sqlitePath),
          authStore: new SqliteAuthStore(options.sqlitePath),
          storageBackend: "sqlite",
          enterpriseStorageRoot
        }));
  const httpConnections = new Map<string, ConnectionState>();
  const sockets = new Set<any>();
  const skillSyncSchedulerTimer =
    typeof router.runSkillSyncSchedulerTick === "function"
      ? setInterval(() => {
          void router.runSkillSyncSchedulerTick?.();
        }, 60_000)
      : undefined;
  if (router.runSkillSyncSchedulerTick) {
    void router.runSkillSyncSchedulerTick();
  }

  const server = createServer(async (req: any, res: any) => {
    try {
      await handleHttpRequest(req, res, router, httpConnections, connectionBindingStore);
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
      if (skillSyncSchedulerTimer) {
        clearInterval(skillSyncSchedulerTimer);
      }
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
  modelSecretRepo: ModelSecretRepository,
  policyRepo: PolicyRepository,
  metricsRepo: MetricsRepository,
  authStore: AuthStore,
  idempotencyRepo: IdempotencyRepository,
  internalToolExecutor: ToolExecutor,
  sessionExecutionTargets: Map<string, ExecutionTargetRecord>,
  sessionToolScopes: Map<string, { tenantId: string; workspaceId: string; userId: string; workspaceRoot?: string }>,
  enableCloudProbe: boolean,
  storageBackend: "memory" | "sqlite" | "postgres",
  blobBackend: "fs" | "minio",
  blobStore: BlobStore | undefined,
  enterpriseStorageRoot: string,
  now: () => Date,
  options: GatewayHandleOptions,
  skillSyncConfigs: Map<string, SkillSyncConfigRecord>,
  skillSyncStatuses: Map<string, SkillSyncStatusRecord>,
  skillSyncRuns: SkillSyncRunRecord[],
  skillBundles: Map<string, SkillBundleRecord>,
  skillCatalog: Map<string, SkillCatalogItem>,
  installedSkills: Map<string, SkillInstalledRecord>,
  knownSkillSources: Set<string>
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
                  userId: state.principal.userId,
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
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default";
      const ownerUserId = resolveSessionOwnerUserId(req.params, state);
      const visibility = resolveSessionVisibility(req.params, state);
      const session = createSession({
        id: createSessionId(),
        runtimeMode,
        title: titleParam ?? DEFAULT_SESSION_TITLE,
        tenantId,
        workspaceId,
        ownerUserId,
        visibility
      });
      await sessionRepo.upsert(session);
      return {
        response: makeSuccessRes(req.id, { session }),
        events: [createEvent(state, "session.updated", { session })]
      };
    }

    case "sessions.list": {
      const scope = resolveSessionScope(req.params, state);
      let items = await sessionRepo.list(scope);
      if (items.length === 0) {
        const recovered = await recoverLegacyDefaultSessionsForPrincipal({
          params: req.params,
          state,
          targetScope: scope,
          sessionRepo,
          transcriptRepo,
          now
        });
        if (recovered > 0) {
          items = await sessionRepo.list(scope);
        }
      }
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
      const scope = resolveSessionScope(req.params, state);
      let session = await sessionRepo.get(sessionId, scope);
      if (!session) {
        const recovered = await recoverLegacyDefaultSessionsForPrincipal({
          params: req.params,
          state,
          targetScope: scope,
          sessionRepo,
          transcriptRepo,
          now,
          sessionId
        });
        if (recovered > 0) {
          session = await sessionRepo.get(sessionId, scope);
        }
      }
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

      const scope = resolveSessionScope(req.params, state);
      let session = await sessionRepo.get(sessionId, scope);
      if (!session) {
        const recovered = await recoverLegacyDefaultSessionsForPrincipal({
          params: req.params,
          state,
          targetScope: scope,
          sessionRepo,
          transcriptRepo,
          now,
          sessionId
        });
        if (recovered > 0) {
          session = await sessionRepo.get(sessionId, scope);
        }
      }
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

      const items = (await transcriptRepo.list(sessionId, scope, limit, beforeId)).map((item) =>
        normalizeTranscriptItemForClient(item)
      );
      return {
        response: makeSuccessRes(req.id, { items }),
        events: []
      };
    }

    case "agents.list": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
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
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default";
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

    case "users.list": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId");
      const items = await authStore.listTenantUsers(tenantId);
      const filtered = workspaceId
        ? items.filter((item) => item.memberships.some((membership) => membership.workspaceId === workspaceId))
        : items;
      return {
        response: makeSuccessRes(req.id, {
          items: filtered.map((item) => toTenantUserPayload(item))
        }),
        events: []
      };
    }

    case "users.create": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const username = requireString(req.params, "username");
      const password = requireString(req.params, "password");
      if (!username || !password) {
        return invalidParams(req.id, "users.create 需要 username 和 password");
      }
      const existing = await authStore.findLocalUser(tenantId, username);
      if (existing) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", "用户已存在"),
          events: []
        };
      }
      const membershipsInput = readMembershipPatch(
        req.params,
        requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default",
        normalizeMembershipRole(req.params.role)
      );
      const primary = membershipsInput[0];
      const passwordHash = hashPasswordForStorage(password);
      const user = await authStore.upsertLocalUser({
        tenantId,
        username,
        passwordHash,
        ...(requireString(req.params, "displayName") ? { displayName: requireString(req.params, "displayName") } : {}),
        ...(requireString(req.params, "email") ? { email: requireString(req.params, "email") } : {}),
        defaultWorkspaceId: primary.workspaceId,
        role: primary.role
      });
      await authStore.replaceWorkspaceMemberships({
        tenantId,
        userId: user.id,
        memberships: membershipsInput
      });
      const status = normalizeUserStatus(req.params.status);
      if (status === "disabled") {
        await authStore.updateUserStatus({
          tenantId,
          userId: user.id,
          status
        });
      }
      const users = await authStore.listTenantUsers(tenantId);
      const created = users.find((item) => item.user.id === user.id);
      await auditRepo.append({
        tenantId,
        workspaceId: primary.workspaceId,
        action: "users.created",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "user",
        resourceId: user.id,
        metadata: {
          username: user.username,
          status: status ?? "active",
          memberships: membershipsInput.map((item) => ({
            workspaceId: item.workspaceId,
            role: item.role
          }))
        },
        createdAt: now().toISOString()
      });
      return {
        response: makeSuccessRes(req.id, {
          user: created ? toTenantUserPayload(created) : null
        }),
        events: []
      };
    }

    case "users.updateStatus": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const userId = requireString(req.params, "userId");
      const status = normalizeUserStatus(req.params.status);
      if (!userId || !status) {
        return invalidParams(req.id, "users.updateStatus 需要 userId 和 status(active|disabled)");
      }
      const updated = await authStore.updateUserStatus({
        tenantId,
        userId,
        status
      });
      if (!updated) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", "用户不存在"),
          events: []
        };
      }
      const memberships = await authStore.listWorkspaceMemberships(tenantId, userId);
      await auditRepo.append({
        tenantId,
        workspaceId: memberships[0]?.workspaceId ?? "w_default",
        action: "users.status_changed",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "user",
        resourceId: userId,
        metadata: {
          status
        },
        createdAt: now().toISOString()
      });
      return {
        response: makeSuccessRes(req.id, {
          user: toUserPayload(updated),
          status
        }),
        events: []
      };
    }

    case "users.resetPassword": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const userId = requireString(req.params, "userId");
      const nextPassword = requireString(req.params, "newPassword");
      if (!userId || !nextPassword) {
        return invalidParams(req.id, "users.resetPassword 需要 userId 和 newPassword");
      }
      const updated = await authStore.setLocalUserPassword({
        tenantId,
        userId,
        passwordHash: hashPasswordForStorage(nextPassword)
      });
      if (!updated) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", "用户不存在或不是本地账号"),
          events: []
        };
      }
      const memberships = await authStore.listWorkspaceMemberships(tenantId, userId);
      await auditRepo.append({
        tenantId,
        workspaceId: memberships[0]?.workspaceId ?? "w_default",
        action: "users.password_reset",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "user",
        resourceId: userId,
        metadata: {
          source: updated.source
        },
        createdAt: now().toISOString()
      });
      return {
        response: makeSuccessRes(req.id, {
          ok: true
        }),
        events: []
      };
    }

    case "users.updateMemberships": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const userId = requireString(req.params, "userId");
      if (!userId) {
        return invalidParams(req.id, "users.updateMemberships 需要 userId");
      }
      if (!Array.isArray(req.params.memberships)) {
        return invalidParams(req.id, "users.updateMemberships 需要 memberships 数组");
      }
      const membershipsInput = readMembershipPatch(req.params, state.principal?.workspaceIds[0] ?? "w_default", "member");
      const memberships = await authStore.replaceWorkspaceMemberships({
        tenantId,
        userId,
        memberships: membershipsInput
      });
      if (memberships.length === 0) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", "membership 更新失败"),
          events: []
        };
      }
      await auditRepo.append({
        tenantId,
        workspaceId: memberships[0]?.workspaceId ?? "w_default",
        action: "users.memberships_updated",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "user",
        resourceId: userId,
        metadata: {
          memberships: memberships.map((item) => ({
            workspaceId: item.workspaceId,
            role: item.role
          }))
        },
        createdAt: now().toISOString()
      });
      return {
        response: makeSuccessRes(req.id, {
          memberships: memberships.map((item) => ({
            tenantId: item.tenantId,
            workspaceId: item.workspaceId,
            userId: item.userId,
            role: item.role,
            updatedAt: item.updatedAt
          }))
        }),
        events: []
      };
    }

    case "secrets.upsertModelKey": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const providerRaw = requireString(req.params, "provider");
      const provider = providerRaw ? normalizeLlmProvider(providerRaw) : undefined;
      const apiKey = requireString(req.params, "apiKey");
      if (!provider || !apiKey) {
        return invalidParams(req.id, "secrets.upsertModelKey 需要 provider 和 apiKey");
      }
      const workspaceId =
        requireString(req.params, "workspaceId") ??
        (state.principal?.workspaceIds[0] ? state.principal.workspaceIds[0] : "w_default");
      const updated = await modelSecretRepo.upsert({
        tenantId,
        workspaceId,
        provider,
        ...(requireString(req.params, "modelId") ? { modelId: requireString(req.params, "modelId") } : {}),
        ...(requireString(req.params, "baseUrl") ? { baseUrl: requireString(req.params, "baseUrl") } : {}),
        apiKey,
        updatedBy: requireString(req.params, "actor") ?? "system",
        updatedAt: now().toISOString()
      });
      await auditRepo.append({
        tenantId,
        workspaceId: workspaceId ?? "w_default",
        action: "secrets.model_key_upserted",
        actor: requireString(req.params, "actor") ?? "system",
        resourceType: "model_secret",
        resourceId: `${workspaceId ?? "tenant"}:${provider}`,
        metadata: {
          provider: updated.provider,
          workspaceId: updated.workspaceId,
          modelId: updated.modelId
        },
        createdAt: now().toISOString()
      });
      return {
        response: makeSuccessRes(req.id, {
          secret: toModelSecretMetaPayload(updated)
        }),
        events: []
      };
    }

    case "secrets.getModelKeyMeta": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0];
      const items = await modelSecretRepo.listMeta({
        tenantId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(requireString(req.params, "provider") ? { provider: requireString(req.params, "provider") } : {})
      });
      return {
        response: makeSuccessRes(req.id, {
          items: items.map((item) => toModelSecretMetaPayload(item))
        }),
        events: []
      };
    }

    case "executionTargets.list": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
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
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
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
        tenantId: requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default",
        workspaceId: requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default",
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
      const auditTenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const auditWorkspaceId = requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default";
      const auditActor = requireString(req.params, "actor") ?? state.principal?.displayName ?? state.principal?.subject ?? "system";
      const executionMode = runtimeMode === "local" ? "local_sandbox" : "enterprise_cloud";
      const scope = resolveSessionScope(req.params, state);

      if (state.runningSessionIds.has(sessionId)) {
        state.queuedModeChanges.set(sessionId, runtimeMode);
        await auditRepo.append({
          tenantId: auditTenantId,
          workspaceId: auditWorkspaceId,
          action: "execution.mode_changed",
          actor: auditActor,
          resourceType: "session",
          resourceId: sessionId,
          metadata: {
            runtimeMode,
            executionMode,
            status: "queued-change"
          },
          createdAt: now().toISOString()
        });
        return {
          response: makeSuccessRes(req.id, {
            sessionId,
            runtimeMode,
            executionMode,
            status: "queued-change",
            effectiveOn: "next_turn"
          }),
          events: []
        };
      }

      const updated = await sessionRepo.setRuntimeMode(sessionId, runtimeMode, scope);
      if (!updated) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", `未知会话: ${sessionId}`),
          events: []
        };
      }

      await auditRepo.append({
        tenantId: auditTenantId,
        workspaceId: auditWorkspaceId,
        action: "execution.mode_changed",
        actor: auditActor,
        resourceType: "session",
        resourceId: sessionId,
        metadata: {
          runtimeMode,
          executionMode,
          status: "applied"
        },
        createdAt: now().toISOString()
      });

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
          executionMode,
          status: "applied"
        }),
        events
      };
    }

    case "agent.run":
      return await handleAgentRun({
        req,
        state,
        coreService,
        sessionRepo,
        transcriptRepo,
        agentRepo,
        executionTargetRepo,
        budgetRepo,
        auditRepo,
        modelSecretRepo,
        metricsRepo,
        internalToolExecutor,
        sessionExecutionTargets,
        sessionToolScopes,
        enableCloudProbe,
        now,
        options,
        helpers: {
          requireString,
          asRuntimeMode,
          asLlmOptions,
          resolveSessionOwnerUserId,
          canReadCrossUserSessions,
          resolvePrincipalUserId,
          resolveSessionVisibility,
          createSession,
          resolveBudgetScopeKey,
          getBudgetExceededReason,
          withSessionInput,
          createEvent,
          estimateRunUsage,
          isObjectRecord
        }
      });

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
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default";
      const scopeKey = requireString(req.params, "scopeKey") ?? "default";
      const policy = await policyRepo.get({
        tenantId,
        workspaceId,
        scopeKey
      });
      return {
        response: makeSuccessRes(req.id, {
          policy
        }),
        events: []
      };
    }

    case "policy.update": {
      const tenantId = requireString(req.params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
      const workspaceId = requireString(req.params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default";
      const scopeKey = requireString(req.params, "scopeKey") ?? "default";
      const patch = toPolicyPatch(req.params);
      if (!patch) {
        return invalidParams(req.id, "policy.update 需要至少一个可更新字段");
      }
      const policy = await policyRepo.update(patch, {
        tenantId,
        workspaceId,
        scopeKey
      });
      await auditRepo.append({
        tenantId,
        workspaceId,
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

    case "sandbox.usage": {
      const sessionId = requireString(req.params, "sessionId");
      if (!sessionId) {
        return invalidParams(req.id, "sandbox.usage 需要 sessionId");
      }
      const scope = resolveSessionScope(req.params, state);
      let session = await sessionRepo.get(sessionId, scope);
      if (!session) {
        const recovered = await recoverLegacyDefaultSessionsForPrincipal({
          params: req.params,
          state,
          targetScope: scope,
          sessionRepo,
          transcriptRepo,
          now,
          sessionId
        });
        if (recovered > 0) {
          session = await sessionRepo.get(sessionId, scope);
        }
      }
      if (!session) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", `未知会话: ${sessionId}`),
          events: []
        };
      }
      if (session.runtimeMode !== "cloud") {
        return {
          response: makeSuccessRes(req.id, {
            usage: {
              available: false,
              runtimeMode: session.runtimeMode,
              checkedAt: now().toISOString(),
              reason: "local_runtime"
            }
          }),
          events: []
        };
      }
      const explicitTargetId = requireString(req.params, "executionTargetId");
      const target =
        sessionExecutionTargets.get(sessionId) ??
        (explicitTargetId ? await executionTargetRepo.get(explicitTargetId) : undefined) ??
        (await executionTargetRepo.findDefault(scope.tenantId, scope.workspaceId)) ??
        undefined;
      if (!target || !target.enabled || target.kind !== "docker-runner") {
        return {
          response: makeSuccessRes(req.id, {
            usage: {
              available: false,
              runtimeMode: "cloud",
              checkedAt: now().toISOString(),
              reason: "target_unavailable"
            }
          }),
          events: []
        };
      }
      const usage = await readCloudSandboxUsage(target);
      return {
        response: makeSuccessRes(req.id, {
          usage: {
            ...usage,
            runtimeMode: "cloud",
            checkedAt: now().toISOString(),
            targetId: target.targetId
          }
        }),
        events: []
      };
    }

    case "infra.health": {
      if (!state.principal || !state.principal.roles.includes("tenant_admin")) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", "仅 tenant_admin 可访问 infra.health"),
          events: []
        };
      }
      const tenantId = state.principal.tenantId;
      const workspaceId = state.principal.workspaceIds[0] ?? "w_default";

      const checks: Record<string, unknown> = {
        storage: {
          backend: storageBackend,
          ok: true
        },
        idempotency: {
          backend: idempotencyRepo instanceof RedisIdempotencyRepository ? "redis" : storageBackend === "postgres" ? "postgres" : "sqlite",
          ok: true
        },
        blob: {
          backend: blobBackend,
          ok: blobStore ? true : false
        },
        orchestrator: {
          endpoint: process.env.OPENFOAL_ORCHESTRATOR_HEALTH_URL ?? "",
          ok: true
        }
      };

      try {
        await sessionRepo.list({
          tenantId,
          workspaceId
        });
      } catch (error) {
        checks.storage = {
          backend: storageBackend,
          ok: false,
          error: toErrorMessage(error)
        };
      }

      try {
        const probeKey = `health/${tenantId}/${Date.now().toString(36)}.json`;
        await idempotencyRepo.set(probeKey, {
          fingerprint: "health-check",
          result: {
            response: {
              ok: true
            },
            events: []
          }
        });
        const found = await idempotencyRepo.get(probeKey);
        checks.idempotency = {
          backend: idempotencyRepo instanceof RedisIdempotencyRepository ? "redis" : storageBackend === "postgres" ? "postgres" : "sqlite",
          ok: Boolean(found)
        };
      } catch (error) {
        checks.idempotency = {
          backend: idempotencyRepo instanceof RedisIdempotencyRepository ? "redis" : storageBackend === "postgres" ? "postgres" : "sqlite",
          ok: false,
          error: toErrorMessage(error)
        };
      }

      if (blobStore) {
        try {
          const healthKey = `health/${tenantId}/probe.txt`;
          await blobStore.putText(healthKey, `ok ${now().toISOString()}`);
          const head = await blobStore.head(healthKey);
          checks.blob = {
            backend: blobBackend,
            ok: Boolean(head),
            ...(head ? { size: head.size } : {})
          };
        } catch (error) {
          checks.blob = {
            backend: blobBackend,
            ok: false,
            error: toErrorMessage(error)
          };
        }
      }

      return {
        response: makeSuccessRes(req.id, {
          health: {
            serverTime: now().toISOString(),
            checks
          }
        }),
        events: []
      };
    }

    case "infra.storage.reconcile": {
      if (!state.principal || !state.principal.roles.includes("tenant_admin")) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", "仅 tenant_admin 可执行 infra.storage.reconcile"),
          events: []
        };
      }
      if (!blobStore || blobBackend !== "minio" || !(blobStore instanceof MinioBlobStore)) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", "当前环境未启用 MinIO blob backend"),
          events: []
        };
      }
      try {
        const report = await syncLocalDirectoryToMinio({
          localRoot: enterpriseStorageRoot,
          keyPrefix: "",
          store: blobStore
        });
        await auditRepo.append({
          tenantId: state.principal.tenantId,
          workspaceId: state.principal.workspaceIds[0] ?? "w_default",
          action: "infra.storage.reconcile",
          actor: state.principal.displayName ?? state.principal.subject,
          resourceType: "blob_storage",
          resourceId: "openfoal-enterprise",
          metadata: {
            uploaded: report.uploaded,
            scanned: report.scanned
          },
          createdAt: now().toISOString()
        });
        return {
          response: makeSuccessRes(req.id, {
            reconcile: report
          }),
          events: []
        };
      } catch (error) {
        return {
          response: makeErrorRes(req.id, "INTERNAL_ERROR", `reconcile 失败: ${toErrorMessage(error)}`),
          events: []
        };
      }
    }

    case "memory.get": {
      const memoryScope = resolveMemoryToolArgs(req.params, state, "read");
      if (!memoryScope.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", memoryScope.message),
          events: []
        };
      }
      const toolResult = await internalToolExecutor.execute(
        {
          name: "memory.get",
          args: memoryScope.args
        },
        {
          runId: `memory_get_${Date.now().toString(36)}`,
          sessionId: "session_memory_api",
          runtimeMode: "local",
          ...(memoryScope.ctx.tenantId ? { tenantId: memoryScope.ctx.tenantId } : {}),
          ...(memoryScope.ctx.workspaceId ? { workspaceId: memoryScope.ctx.workspaceId } : {}),
          ...(memoryScope.ctx.userId ? { userId: memoryScope.ctx.userId } : {})
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

    case "memory.search": {
      const memoryScope = resolveMemoryToolArgs(req.params, state, "read");
      if (!memoryScope.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", memoryScope.message),
          events: []
        };
      }
      const toolResult = await internalToolExecutor.execute(
        {
          name: "memory.search",
          args: memoryScope.args
        },
        {
          runId: `memory_search_${Date.now().toString(36)}`,
          sessionId: "session_memory_api",
          runtimeMode: "local",
          ...(memoryScope.ctx.tenantId ? { tenantId: memoryScope.ctx.tenantId } : {}),
          ...(memoryScope.ctx.workspaceId ? { workspaceId: memoryScope.ctx.workspaceId } : {}),
          ...(memoryScope.ctx.userId ? { userId: memoryScope.ctx.userId } : {})
        }
      );
      if (!toolResult.ok) {
        return {
          response: makeErrorRes(
            req.id,
            toolResult.error?.code === "TOOL_EXEC_FAILED" ? "TOOL_EXEC_FAILED" : "INTERNAL_ERROR",
            toolResult.error?.message ?? "memory.search 失败"
          ),
          events: []
        };
      }
      return {
        response: makeSuccessRes(req.id, {
          search: parseToolJsonOutput(toolResult.output)
        }),
        events: []
      };
    }

    case "memory.appendDaily": {
      const memoryScope = resolveMemoryToolArgs(req.params, state, "write");
      if (!memoryScope.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", memoryScope.message),
          events: []
        };
      }
      const toolResult = await internalToolExecutor.execute(
        {
          name: "memory.appendDaily",
          args: memoryScope.args
        },
        {
          runId: `memory_append_${Date.now().toString(36)}`,
          sessionId: "session_memory_api",
          runtimeMode: "local",
          ...(memoryScope.ctx.tenantId ? { tenantId: memoryScope.ctx.tenantId } : {}),
          ...(memoryScope.ctx.workspaceId ? { workspaceId: memoryScope.ctx.workspaceId } : {}),
          ...(memoryScope.ctx.userId ? { userId: memoryScope.ctx.userId } : {})
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
      const memoryScope = resolveMemoryToolArgs(req.params, state, "write");
      if (!memoryScope.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", memoryScope.message),
          events: []
        };
      }
      const date = normalizeMemoryDate(req.params.date);
      if (!date) {
        return invalidParams(req.id, "memory.archive 的 date 必须为 YYYY-MM-DD");
      }
      const includeLongTerm = req.params.includeLongTerm !== false;
      const clearDaily = req.params.clearDaily !== false;
      const dailyPath = resolveDailyMemoryPath(memoryScope.args, date);
      const legacyDailyPath = resolveLegacyDailyMemoryPath(memoryScope.args, date);
      const longTermPath = resolveLongTermMemoryPath();

      let dailyText = "";
      let dailySourcePath = dailyPath;
      let readResult = await internalToolExecutor.execute(
        {
          name: "file.read",
          args: {
            ...memoryScope.args,
            path: dailyPath
          }
        },
        {
          runId: `memory_archive_read_${Date.now().toString(36)}`,
          sessionId: "session_memory_api",
          runtimeMode: "local",
          ...(memoryScope.ctx.tenantId ? { tenantId: memoryScope.ctx.tenantId } : {}),
          ...(memoryScope.ctx.workspaceId ? { workspaceId: memoryScope.ctx.workspaceId } : {}),
          ...(memoryScope.ctx.userId ? { userId: memoryScope.ctx.userId } : {})
        }
      );
      if (!readResult.ok && isFileNotFoundError(readResult.error?.message) && legacyDailyPath !== dailyPath) {
        const legacyReadResult = await internalToolExecutor.execute(
          {
            name: "file.read",
            args: {
              ...memoryScope.args,
              path: legacyDailyPath
            }
          },
          {
            runId: `memory_archive_read_legacy_${Date.now().toString(36)}`,
            sessionId: "session_memory_api",
            runtimeMode: "local",
            ...(memoryScope.ctx.tenantId ? { tenantId: memoryScope.ctx.tenantId } : {}),
            ...(memoryScope.ctx.workspaceId ? { workspaceId: memoryScope.ctx.workspaceId } : {}),
            ...(memoryScope.ctx.userId ? { userId: memoryScope.ctx.userId } : {})
          }
        );
        if (legacyReadResult.ok) {
          readResult = legacyReadResult;
          dailySourcePath = legacyDailyPath;
        } else {
          readResult = legacyReadResult;
        }
      }
      if (readResult.ok) {
        dailyText = readResult.output ?? "";
      } else if (!isFileNotFoundError(readResult.error?.message)) {
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
              ...memoryScope.args,
              path: longTermPath,
              content: `${archivedContent}\n`,
              append: true
            }
          },
          {
            runId: `memory_archive_append_${Date.now().toString(36)}`,
            sessionId: "session_memory_api",
            runtimeMode: "local",
            ...(memoryScope.ctx.tenantId ? { tenantId: memoryScope.ctx.tenantId } : {}),
            ...(memoryScope.ctx.workspaceId ? { workspaceId: memoryScope.ctx.workspaceId } : {}),
            ...(memoryScope.ctx.userId ? { userId: memoryScope.ctx.userId } : {})
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
        const clearPaths = new Set([dailyPath, dailySourcePath]);
        for (const clearPath of clearPaths) {
          const clearResult = await internalToolExecutor.execute(
            {
              name: "file.write",
              args: {
                ...memoryScope.args,
                path: clearPath,
                content: "",
                append: false
              }
            },
            {
              runId: `memory_archive_clear_${Date.now().toString(36)}`,
              sessionId: "session_memory_api",
              runtimeMode: "local",
              ...(memoryScope.ctx.tenantId ? { tenantId: memoryScope.ctx.tenantId } : {}),
              ...(memoryScope.ctx.workspaceId ? { workspaceId: memoryScope.ctx.workspaceId } : {}),
              ...(memoryScope.ctx.userId ? { userId: memoryScope.ctx.userId } : {})
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

    case "context.get": {
      const contextRead = resolveContextAccess(req.params, state, "read");
      if (!contextRead.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", contextRead.message),
          events: []
        };
      }
      let readResult = await internalToolExecutor.execute(
        {
          name: "file.read",
          args: {
            path: contextRead.fileName
          }
        },
        {
          runId: `context_get_${Date.now().toString(36)}`,
          sessionId: "session_context_api",
          runtimeMode: "local",
          workspaceRoot: contextRead.root
        }
      );
      if (!readResult.ok && isFileNotFoundError(readResult.error?.message) && contextRead.legacyRoot) {
        readResult = await internalToolExecutor.execute(
          {
            name: "file.read",
            args: {
              path: contextRead.fileName
            }
          },
          {
            runId: `context_get_legacy_${Date.now().toString(36)}`,
            sessionId: "session_context_api",
            runtimeMode: "local",
            workspaceRoot: contextRead.legacyRoot
          }
        );
      }
      if (!readResult.ok) {
        if (isFileNotFoundError(readResult.error?.message)) {
          return {
            response: makeSuccessRes(req.id, {
              context: {
                layer: contextRead.layer,
                file: contextRead.fileName,
                text: defaultContextFileContent(contextRead.fileName)
              }
            }),
            events: []
          };
        }
        return {
          response: makeErrorRes(
            req.id,
            readResult.error?.code === "TOOL_EXEC_FAILED" ? "TOOL_EXEC_FAILED" : "INTERNAL_ERROR",
            readResult.error?.message ?? "context.get 失败"
          ),
          events: []
        };
      }
      return {
        response: makeSuccessRes(req.id, {
          context: {
            layer: contextRead.layer,
            file: contextRead.fileName,
            text: readResult.output ?? ""
          }
        }),
        events: []
      };
    }

    case "context.upsert": {
      const contextWrite = resolveContextAccess(req.params, state, "write");
      if (!contextWrite.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", contextWrite.message),
          events: []
        };
      }
      const content = requireString(req.params, "content");
      if (!content) {
        return invalidParams(req.id, "context.upsert 需要 content");
      }
      const writeResult = await internalToolExecutor.execute(
        {
          name: "file.write",
          args: {
            path: contextWrite.fileName,
            content,
            append: false
          }
        },
        {
          runId: `context_upsert_${Date.now().toString(36)}`,
          sessionId: "session_context_api",
          runtimeMode: "local",
          workspaceRoot: contextWrite.root
        }
      );
      if (!writeResult.ok) {
        return {
          response: makeErrorRes(
            req.id,
            writeResult.error?.code === "TOOL_EXEC_FAILED" ? "TOOL_EXEC_FAILED" : "INTERNAL_ERROR",
            writeResult.error?.message ?? "context.upsert 失败"
          ),
          events: []
        };
      }
      return {
        response: makeSuccessRes(req.id, {
          context: {
            layer: contextWrite.layer,
            file: contextWrite.fileName
          }
        }),
        events: []
      };
    }

    case "skills.syncConfig.get": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }
      const defaults = buildSkillSyncDefaults(req.params, knownSkillSources);
      const effectiveConfig = resolveEffectiveSkillSyncConfigForScope({
        scopeRef: scopeRef.value,
        defaults,
        configs: skillSyncConfigs
      });
      const scopedConfig = skillSyncConfigs.get(scopeRef.value.key);
      const status = reconcileSkillSyncStatusRecord({
        scopeRef: scopeRef.value,
        effectiveConfig,
        statuses: skillSyncStatuses,
        now,
        resetNextRun: false
      });
      return {
        response: makeSuccessRes(req.id, {
          scope: scopeRef.value.scope,
          target: toSkillSyncTarget(scopeRef.value),
          config: scopedConfig?.config ?? {},
          effectiveConfig,
          status: toSkillSyncStatusPayload(status),
          recentRuns: listSkillSyncRuns(skillSyncRuns, scopeRef.value, 20)
        }),
        events: []
      };
    }

    case "skills.syncConfig.upsert": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }

      const rawPatch = isObjectRecord(req.params.config) ? req.params.config : req.params;
      const patch = normalizeSkillSyncPatch(rawPatch);
      if (!hasSkillSyncPatch(patch)) {
        return invalidParams(req.id, "skills.syncConfig.upsert 需要 config 字段");
      }

      const defaults = buildSkillSyncDefaults(req.params, knownSkillSources);
      const parentEffective = resolveParentSkillSyncConfig({
        scopeRef: scopeRef.value,
        defaults,
        configs: skillSyncConfigs
      });
      if (parentEffective) {
        const boundary = validateSecurityBoundary({
          parent: parentEffective,
          childPatch: patch
        });
        if (!boundary.ok) {
          return {
            response: makeErrorRes(req.id, "FORBIDDEN", boundary.message),
            events: []
          };
        }
      }

      const existing = skillSyncConfigs.get(scopeRef.value.key);
      const merged: SkillSyncConfigPatch = {
        ...(existing?.config ?? {}),
        ...patch
      };
      const updatedAt = now().toISOString();
      const updatedBy = requireString(req.params, "actor") ?? state.principal?.subject ?? "system";
      const nextRecord: SkillSyncConfigRecord = {
        scope: scopeRef.value.scope,
        tenantId: scopeRef.value.tenantId,
        workspaceId: scopeRef.value.workspaceId,
        userId: scopeRef.value.userId,
        config: merged,
        updatedAt,
        updatedBy
      };
      skillSyncConfigs.set(scopeRef.value.key, nextRecord);
      for (const source of merged.sourceFilters ?? []) {
        knownSkillSources.add(source);
      }

      const effectiveConfig = resolveEffectiveSkillSyncConfigForScope({
        scopeRef: scopeRef.value,
        defaults,
        configs: skillSyncConfigs
      });
      const status = reconcileSkillSyncStatusRecord({
        scopeRef: scopeRef.value,
        effectiveConfig,
        statuses: skillSyncStatuses,
        now,
        resetNextRun: true
      });
      return {
        response: makeSuccessRes(req.id, {
          scope: scopeRef.value.scope,
          target: toSkillSyncTarget(scopeRef.value),
          config: nextRecord.config,
          updatedAt,
          updatedBy,
          effectiveConfig,
          status: toSkillSyncStatusPayload(status)
        }),
        events: []
      };
    }

    case "skills.syncStatus.get": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }
      const defaults = buildSkillSyncDefaults(req.params, knownSkillSources);
      const effectiveConfig = resolveEffectiveSkillSyncConfigForScope({
        scopeRef: scopeRef.value,
        defaults,
        configs: skillSyncConfigs
      });
      const status = reconcileSkillSyncStatusRecord({
        scopeRef: scopeRef.value,
        effectiveConfig,
        statuses: skillSyncStatuses,
        now,
        resetNextRun: false
      });
      return {
        response: makeSuccessRes(req.id, {
          scope: scopeRef.value.scope,
          target: toSkillSyncTarget(scopeRef.value),
          effectiveConfig,
          status: toSkillSyncStatusPayload(status),
          recentRuns: listSkillSyncRuns(skillSyncRuns, scopeRef.value, 50)
        }),
        events: []
      };
    }

    case "skills.sync.runNow": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }
      const defaults = buildSkillSyncDefaults(req.params, knownSkillSources);
      const effectiveConfig = resolveEffectiveSkillSyncConfigForScope({
        scopeRef: scopeRef.value,
        defaults,
        configs: skillSyncConfigs
      });
      const run = executeSkillSyncRun({
        scopeRef: scopeRef.value,
        effectiveConfig,
        now,
        statuses: skillSyncStatuses,
        runs: skillSyncRuns,
        catalog: skillCatalog,
        knownSources: knownSkillSources,
        preserveNextRunAt: true,
        trigger: "manual",
        offlineHint: req.params.offline === true || toBoolean(process.env.OPENFOAL_FORCE_OFFLINE, false)
      });
      return {
        response: makeSuccessRes(req.id, {
          scope: scopeRef.value.scope,
          target: toSkillSyncTarget(scopeRef.value),
          run,
          status: toSkillSyncStatusPayload(skillSyncStatuses.get(scopeRef.value.key))
        }),
        events: []
      };
    }

    case "skills.bundle.import": {
      const bundleAccess = authorizeSkillBundleAccess(state.principal);
      if (!bundleAccess.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", bundleAccess.message),
          events: []
        };
      }
      if (!isObjectRecord(req.params.bundle)) {
        return invalidParams(req.id, "skills.bundle.import 需要 bundle 对象");
      }
      try {
        const imported = importSkillBundle({
          bundle: req.params.bundle,
          actor: requireString(req.params, "actor") ?? state.principal?.subject ?? "system",
          now,
          bundles: skillBundles,
          catalog: skillCatalog,
          knownSources: knownSkillSources
        });
        return {
          response: makeSuccessRes(req.id, {
            bundle: toSkillBundlePayload(imported.bundle),
            importedCount: imported.importedCount,
            catalogSize: skillCatalog.size
          }),
          events: []
        };
      } catch (error) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", toErrorMessage(error)),
          events: []
        };
      }
    }

    case "skills.bundle.export": {
      const bundleAccess = authorizeSkillBundleAccess(state.principal);
      if (!bundleAccess.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", bundleAccess.message),
          events: []
        };
      }
      try {
        const bundle = exportSkillBundle({
          bundleId: requireString(req.params, "bundleId"),
          name: requireString(req.params, "name"),
          actor: requireString(req.params, "actor") ?? state.principal?.subject ?? "system",
          skillIds: toStringList(req.params.skillIds),
          now,
          bundles: skillBundles,
          catalog: skillCatalog
        });
        return {
          response: makeSuccessRes(req.id, {
            bundle: toSkillBundlePayload(bundle)
          }),
          events: []
        };
      } catch (error) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", toErrorMessage(error)),
          events: []
        };
      }
    }

    case "skills.bundle.list": {
      const bundleAccess = authorizeSkillBundleAccess(state.principal);
      if (!bundleAccess.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", bundleAccess.message),
          events: []
        };
      }
      const items = [...skillBundles.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((item) => ({
          bundleId: item.bundleId,
          name: item.name,
          checksum: item.checksum,
          signature: item.signature,
          createdAt: item.createdAt,
          createdBy: item.createdBy,
          itemCount: item.items.length
        }));
      return {
        response: makeSuccessRes(req.id, {
          items
        }),
        events: []
      };
    }

    case "skills.installed.list": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }
      const items = listInstalledSkills(installedSkills, scopeRef.value).map((item) => toInstalledSkillPayload(item));
      return {
        response: makeSuccessRes(req.id, {
          items
        }),
        events: []
      };
    }

    case "skills.install": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }
      const skillId = requireString(req.params, "skillId");
      if (!skillId) {
        return invalidParams(req.id, "skills.install 需要 skillId");
      }
      const installedBy = requireString(req.params, "actor") ?? state.principal?.subject ?? "system";
      const key = buildInstalledSkillKey(scopeRef.value, skillId);
      const nowIso = now().toISOString();
      const catalogItem = skillCatalog.get(skillId);
      const existing = installedSkills.get(key);
      const record: SkillInstalledRecord = {
        skillId,
        tenantId: scopeRef.value.tenantId,
        workspaceId: scopeRef.value.workspaceId,
        userId: scopeRef.value.userId,
        installedAt: existing?.installedAt ?? nowIso,
        installedBy: existing?.installedBy ?? installedBy,
        source: catalogItem?.source ?? existing?.source,
        commit: catalogItem?.commit ?? existing?.commit,
        path: catalogItem?.path ?? existing?.path,
        checksum: catalogItem?.checksum ?? existing?.checksum,
        license: catalogItem?.license ?? existing?.license,
        tags: catalogItem?.tags ?? existing?.tags ?? []
      };
      installedSkills.set(key, record);
      return {
        response: makeSuccessRes(req.id, {
          item: toInstalledSkillPayload(record),
          alreadyInstalled: Boolean(existing)
        }),
        events: []
      };
    }

    case "skills.uninstall": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }
      const skillId = requireString(req.params, "skillId");
      if (!skillId) {
        return invalidParams(req.id, "skills.uninstall 需要 skillId");
      }
      const key = buildInstalledSkillKey(scopeRef.value, skillId);
      const removed = installedSkills.delete(key);
      return {
        response: makeSuccessRes(req.id, {
          skillId,
          removed
        }),
        events: []
      };
    }

    case "skills.catalog.list": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }
      const defaults = buildSkillSyncDefaults(req.params, knownSkillSources);
      const effectiveConfig = resolveEffectiveSkillSyncConfigForScope({
        scopeRef: scopeRef.value,
        defaults,
        configs: skillSyncConfigs
      });
      const items = applySkillCatalogFilters([...skillCatalog.values()], effectiveConfig).map((item) => ({
        skillId: item.skillId,
        source: item.source,
        commit: item.commit,
        path: item.path,
        checksum: item.checksum,
        license: item.license,
        tags: item.tags,
        availability: item.availability
      }));
      return {
        response: makeSuccessRes(req.id, {
          items,
          effectiveFilters: {
            sourceFilters: effectiveConfig.sourceFilters,
            licenseFilters: effectiveConfig.licenseFilters,
            tagFilters: effectiveConfig.tagFilters
          },
          availability: resolveCatalogAvailability(items, effectiveConfig.syncMode)
        }),
        events: []
      };
    }

    case "skills.catalog.refresh": {
      const scopeRef = resolveSkillSyncScopeRef(req.params, state);
      if (!scopeRef.ok) {
        return invalidParams(req.id, scopeRef.message);
      }
      const permission = authorizeSkillSyncScopeAccess(req.method, scopeRef.value, state.principal);
      if (!permission.ok) {
        return {
          response: makeErrorRes(req.id, "FORBIDDEN", permission.message),
          events: []
        };
      }
      const defaults = buildSkillSyncDefaults(req.params, knownSkillSources);
      const effectiveConfig = resolveEffectiveSkillSyncConfigForScope({
        scopeRef: scopeRef.value,
        defaults,
        configs: skillSyncConfigs
      });
      const run = executeSkillSyncRun({
        scopeRef: scopeRef.value,
        effectiveConfig,
        now,
        statuses: skillSyncStatuses,
        runs: skillSyncRuns,
        catalog: skillCatalog,
        knownSources: knownSkillSources,
        preserveNextRunAt: true,
        trigger: "manual",
        offlineHint: req.params.offline === true || toBoolean(process.env.OPENFOAL_FORCE_OFFLINE, false)
      });
      const items = applySkillCatalogFilters([...skillCatalog.values()], effectiveConfig);
      return {
        response: makeSuccessRes(req.id, {
          run,
          itemCount: items.length,
          availability: resolveCatalogAvailability(items, effectiveConfig.syncMode)
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
  session: SessionRecord,
  transcriptRepo: TranscriptRepository,
  runId: string | undefined,
  events: EventFrame[],
  now: () => Date
): Promise<void> {
  for (const event of filterEventsForTranscript(events)) {
    await transcriptRepo.append({
      sessionId: session.id,
      tenantId: session.tenantId,
      workspaceId: session.workspaceId,
      ownerUserId: session.ownerUserId,
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
  httpConnections: Map<string, ConnectionState>,
  connectionBindingStore?: RedisConnectionBindingStore
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
    const authorization = typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined;
    const rpcMethod = readWsMethod(body);
    if (state.principal && rpcMethod !== "connect") {
      if (!authorization) {
        writeJson(res, 401, {
          error: "AUTH_REQUIRED",
          message: "enterprise 模式下 /rpc 每次请求都必须带 Authorization"
        });
        return;
      }
      try {
        const mePayload = await router.auth?.me(authorization);
        const current = readPrincipalFromMePayload(mePayload);
        if (!current || current.subject !== state.principal.subject || current.tenantId !== state.principal.tenantId) {
          writeJson(res, 401, {
            error: "UNAUTHORIZED",
            message: "Authorization 与 connection principal 不一致"
          });
          return;
        }
        if (connectionBindingStore) {
          const binding = await connectionBindingStore.get(connectionId);
          if (!binding || binding.subject !== state.principal.subject || binding.tenantId !== state.principal.tenantId) {
            writeJson(res, 401, {
              error: "UNAUTHORIZED",
              message: "connection principal 与 redis 绑定不一致"
            });
            return;
          }
        }
      } catch (error) {
        writeAuthHttpError(res, error);
        return;
      }
    }
    const result = await router.handle(body, state, {
      transport: "http"
    });
    if (connectionBindingStore && rpcMethod === "connect") {
      if (result.response.ok && state.principal) {
        await connectionBindingStore.bind({
          connectionId,
          subject: state.principal.subject,
          userId: resolvePrincipalUserId(state.principal),
          tenantId: state.principal.tenantId,
          workspaceIds: [...state.principal.workspaceIds],
          roles: [...state.principal.roles],
          boundAt: new Date().toISOString()
        });
      } else {
        await connectionBindingStore.remove(connectionId);
      }
    }
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

function readPrincipalFromMePayload(payload: Record<string, unknown> | undefined): {
  subject: string;
  tenantId: string;
} | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const principalRaw = (payload as Record<string, unknown>).principal;
  if (!principalRaw || typeof principalRaw !== "object" || Array.isArray(principalRaw)) {
    return undefined;
  }
  const subject = asString((principalRaw as Record<string, unknown>).subject);
  const tenantId = asString((principalRaw as Record<string, unknown>).tenantId);
  if (!subject || !tenantId) {
    return undefined;
  }
  return {
    subject,
    tenantId
  };
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

function createSession(input: {
  id: string;
  runtimeMode: RuntimeMode;
  title?: string;
  tenantId: string;
  workspaceId: string;
  ownerUserId: string;
  visibility: "private" | "workspace";
}): SessionRecord {
  return {
    id: input.id,
    sessionKey: `tenant:${input.tenantId}/workspace:${input.workspaceId}/owner:${input.ownerUserId}/thread:${input.id}`,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    visibility: input.visibility,
    title: normalizeSessionTitle(input.title ?? DEFAULT_SESSION_TITLE),
    preview: DEFAULT_SESSION_PREVIEW,
    runtimeMode: input.runtimeMode,
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

function resolveSessionScope(params: Record<string, unknown>, state: ConnectionState): {
  tenantId: string;
  workspaceId: string;
  ownerUserId?: string;
} {
  const tenantId = requireString(params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
  const workspaceId = requireString(params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default";
  if (!state.principal) {
    const userId = requireString(params, "userId");
    return {
      tenantId,
      workspaceId,
      ...(userId ? { ownerUserId: userId } : {})
    };
  }
  if (canReadCrossUserSessions(state.principal)) {
    const requestedUserId = requireString(params, "userId");
    return {
      tenantId,
      workspaceId,
      ...(requestedUserId ? { ownerUserId: requestedUserId } : {})
    };
  }
  const principalUserId = resolvePrincipalUserId(state.principal);
  return {
    tenantId,
    workspaceId,
    ownerUserId: principalUserId
  };
}

async function recoverLegacyDefaultSessionsForPrincipal(input: {
  params: Record<string, unknown>;
  state: ConnectionState;
  targetScope: {
    tenantId: string;
    workspaceId: string;
    ownerUserId?: string;
  };
  sessionRepo: SessionRepository;
  transcriptRepo: TranscriptRepository;
  now: () => Date;
  sessionId?: string;
}): Promise<number> {
  if (!input.state.principal) {
    return 0;
  }
  if (requireString(input.params, "tenantId") || requireString(input.params, "workspaceId") || requireString(input.params, "userId")) {
    return 0;
  }
  if (input.targetScope.tenantId === "t_default" && input.targetScope.workspaceId === "w_default") {
    return 0;
  }

  const principalUserId = resolvePrincipalUserId(input.state.principal);
  const legacyScope = {
    tenantId: "t_default",
    workspaceId: "w_default",
    ownerUserId: principalUserId
  };
  const legacySessions = input.sessionId
    ? [await input.sessionRepo.get(input.sessionId, legacyScope)].filter((item): item is SessionRecord => Boolean(item))
    : await input.sessionRepo.list(legacyScope);
  if (legacySessions.length === 0) {
    return 0;
  }

  let migrated = 0;
  for (const session of legacySessions) {
    const ownerUserId = input.targetScope.ownerUserId ?? session.ownerUserId ?? principalUserId;
    await copyLegacyTranscriptIfNeeded({
      sessionId: session.id,
      from: legacyScope,
      to: {
        tenantId: input.targetScope.tenantId,
        workspaceId: input.targetScope.workspaceId,
        ownerUserId
      },
      transcriptRepo: input.transcriptRepo
    });
    await input.sessionRepo.upsert({
      ...session,
      tenantId: input.targetScope.tenantId,
      workspaceId: input.targetScope.workspaceId,
      ownerUserId,
      sessionKey: buildSessionKey(input.targetScope.tenantId, input.targetScope.workspaceId, ownerUserId, session.id),
      updatedAt: input.now().toISOString()
    });
    migrated += 1;
  }
  return migrated;
}

async function copyLegacyTranscriptIfNeeded(input: {
  sessionId: string;
  from: {
    tenantId: string;
    workspaceId: string;
    ownerUserId?: string;
  };
  to: {
    tenantId: string;
    workspaceId: string;
    ownerUserId: string;
  };
  transcriptRepo: TranscriptRepository;
}): Promise<void> {
  const existing = await input.transcriptRepo.list(input.sessionId, input.to, 1);
  if (existing.length > 0) {
    return;
  }

  let beforeId: number | undefined;
  while (true) {
    const batch = await input.transcriptRepo.list(input.sessionId, input.from, 500, beforeId);
    if (batch.length === 0) {
      return;
    }

    for (const item of batch) {
      await input.transcriptRepo.append({
        sessionId: item.sessionId,
        tenantId: input.to.tenantId,
        workspaceId: input.to.workspaceId,
        ownerUserId: input.to.ownerUserId,
        ...(item.runId ? { runId: item.runId } : {}),
        event: item.event,
        payload: item.payload,
        createdAt: item.createdAt
      });
    }
    if (batch.length < 500) {
      return;
    }
    const nextBeforeId = batch[0]?.id;
    if (!nextBeforeId) {
      return;
    }
    beforeId = nextBeforeId;
  }
}

function buildSessionKey(tenantId: string, workspaceId: string, ownerUserId: string, sessionId: string): string {
  return `tenant:${tenantId}/workspace:${workspaceId}/owner:${ownerUserId}/thread:${sessionId}`;
}

function resolveSessionOwnerUserId(params: Record<string, unknown>, state: ConnectionState): string {
  const requested = requireString(params, "userId");
  if (!state.principal) {
    return requested ?? "u_legacy";
  }
  if (canReadCrossUserSessions(state.principal) && requested) {
    return requested;
  }
  return resolvePrincipalUserId(state.principal);
}

function resolveSessionVisibility(params: Record<string, unknown>, state: ConnectionState): "private" | "workspace" {
  const requested = params.visibility === "workspace" ? "workspace" : params.visibility === "private" ? "private" : undefined;
  if (!state.principal) {
    return requested ?? "workspace";
  }
  if (canReadCrossUserSessions(state.principal)) {
    return requested ?? "workspace";
  }
  return requested ?? "private";
}

function canReadCrossUserSessions(principal: Principal | undefined): boolean {
  if (!principal) {
    return false;
  }
  return principal.roles.includes("tenant_admin") || principal.roles.includes("workspace_admin");
}

function resolvePrincipalUserId(principal: Principal | undefined): string {
  if (!principal) {
    return "u_legacy";
  }
  if (typeof principal.userId === "string" && principal.userId.trim().length > 0) {
    return principal.userId;
  }
  return principal.subject;
}

function resolveSkillSyncScopeRef(
  params: Record<string, unknown>,
  state: ConnectionState
): { ok: true; value: SkillSyncScopeRef } | { ok: false; message: string } {
  const rawScope = requireString(params, "scope");
  const scope: SkillSyncScope = rawScope ? (isSkillSyncScope(rawScope) ? rawScope : "user") : "user";
  if (rawScope && !isSkillSyncScope(rawScope)) {
    return {
      ok: false,
      message: "skills scope 必须是 tenant/workspace/user"
    };
  }

  const tenantId = requireString(params, "tenantId") ?? state.principal?.tenantId ?? "t_default";
  const workspaceId = requireString(params, "workspaceId") ?? state.principal?.workspaceIds[0] ?? "w_default";
  const userId = requireString(params, "userId") ?? resolvePrincipalUserId(state.principal);
  return {
    ok: true,
    value: {
      scope,
      tenantId,
      workspaceId,
      userId,
      key: buildSkillSyncScopeKey(scope, tenantId, workspaceId, userId)
    }
  };
}

function buildSkillSyncScopeKey(
  scope: SkillSyncScope,
  tenantId: string,
  workspaceId: string,
  userId: string
): string {
  if (scope === "tenant") {
    return `skill_sync:tenant:${tenantId}`;
  }
  if (scope === "workspace") {
    return `skill_sync:workspace:${tenantId}:${workspaceId}`;
  }
  return `skill_sync:user:${tenantId}:${workspaceId}:${userId}`;
}

function buildInstalledSkillKey(scopeRef: SkillSyncScopeRef, skillId: string): string {
  return `installed:${scopeRef.tenantId}:${scopeRef.workspaceId}:${scopeRef.userId}:${skillId}`;
}

function listInstalledSkills(
  installedSkills: Map<string, SkillInstalledRecord>,
  scopeRef: SkillSyncScopeRef
): SkillInstalledRecord[] {
  return [...installedSkills.values()]
    .filter(
      (item) =>
        item.tenantId === scopeRef.tenantId &&
        item.workspaceId === scopeRef.workspaceId &&
        item.userId === scopeRef.userId
    )
    .sort((left, right) => right.installedAt.localeCompare(left.installedAt));
}

function toInstalledSkillPayload(item: SkillInstalledRecord): Record<string, unknown> {
  return {
    skillId: item.skillId,
    tenantId: item.tenantId,
    workspaceId: item.workspaceId,
    userId: item.userId,
    installedAt: item.installedAt,
    installedBy: item.installedBy,
    source: item.source,
    commit: item.commit,
    path: item.path,
    checksum: item.checksum,
    license: item.license,
    tags: item.tags
  };
}

function buildSkillSyncDefaults(params: Record<string, unknown>, knownSources: Set<string>): SkillSyncConfig {
  return defaultSkillSyncConfig({
    timezone: requireString(params, "timezone") ?? defaultTimezone(),
    registeredSources: [...knownSources.values()]
  });
}

function toSkillSyncTarget(scopeRef: SkillSyncScopeRef): Record<string, unknown> {
  return {
    tenantId: scopeRef.tenantId,
    ...(scopeRef.scope !== "tenant" ? { workspaceId: scopeRef.workspaceId } : {}),
    ...(scopeRef.scope === "user" ? { userId: scopeRef.userId } : {})
  };
}

function hasSkillSyncPatch(patch: SkillSyncConfigPatch): boolean {
  return Object.keys(patch).length > 0;
}

function resolveEffectiveSkillSyncConfigForScope(input: {
  scopeRef: SkillSyncScopeRef;
  defaults: SkillSyncConfig;
  configs: Map<string, SkillSyncConfigRecord>;
}): SkillSyncConfig {
  const layers = readSkillSyncLayersForScope(input.scopeRef, input.configs);
  return resolveEffectiveSkillSyncConfig({
    defaults: input.defaults,
    layers
  });
}

function resolveParentSkillSyncConfig(input: {
  scopeRef: SkillSyncScopeRef;
  defaults: SkillSyncConfig;
  configs: Map<string, SkillSyncConfigRecord>;
}): SkillSyncConfig | undefined {
  if (input.scopeRef.scope === "tenant") {
    return undefined;
  }
  if (input.scopeRef.scope === "workspace") {
    const tenantKey = buildSkillSyncScopeKey("tenant", input.scopeRef.tenantId, input.scopeRef.workspaceId, input.scopeRef.userId);
    const tenantConfig = input.configs.get(tenantKey)?.config;
    return resolveEffectiveSkillSyncConfig({
      defaults: input.defaults,
      layers: {
        tenant: tenantConfig
      }
    });
  }
  const tenantKey = buildSkillSyncScopeKey("tenant", input.scopeRef.tenantId, input.scopeRef.workspaceId, input.scopeRef.userId);
  const workspaceKey = buildSkillSyncScopeKey(
    "workspace",
    input.scopeRef.tenantId,
    input.scopeRef.workspaceId,
    input.scopeRef.userId
  );
  const tenantConfig = input.configs.get(tenantKey)?.config;
  const workspaceConfig = input.configs.get(workspaceKey)?.config;
  return resolveEffectiveSkillSyncConfig({
    defaults: input.defaults,
    layers: {
      tenant: tenantConfig,
      workspace: workspaceConfig
    }
  });
}

function readSkillSyncLayersForScope(
  scopeRef: SkillSyncScopeRef,
  configs: Map<string, SkillSyncConfigRecord>
): {
  tenant?: SkillSyncConfigPatch;
  workspace?: SkillSyncConfigPatch;
  user?: SkillSyncConfigPatch;
} {
  const tenantKey = buildSkillSyncScopeKey("tenant", scopeRef.tenantId, scopeRef.workspaceId, scopeRef.userId);
  const workspaceKey = buildSkillSyncScopeKey("workspace", scopeRef.tenantId, scopeRef.workspaceId, scopeRef.userId);
  const userKey = buildSkillSyncScopeKey("user", scopeRef.tenantId, scopeRef.workspaceId, scopeRef.userId);
  const tenant = configs.get(tenantKey)?.config;
  const workspace = configs.get(workspaceKey)?.config;
  const user = configs.get(userKey)?.config;

  if (scopeRef.scope === "tenant") {
    return {
      ...(tenant ? { tenant } : {})
    };
  }
  if (scopeRef.scope === "workspace") {
    return {
      ...(tenant ? { tenant } : {}),
      ...(workspace ? { workspace } : {})
    };
  }
  return {
    ...(tenant ? { tenant } : {}),
    ...(workspace ? { workspace } : {}),
    ...(user ? { user } : {})
  };
}

function authorizeSkillSyncScopeAccess(
  method: MethodName,
  scopeRef: SkillSyncScopeRef,
  principal?: Principal
): { ok: true } | { ok: false; message: string } {
  if (!principal) {
    return { ok: true };
  }
  const isTenantAdmin = principal.roles.includes("tenant_admin");
  if (isTenantAdmin) {
    return { ok: true };
  }
  if (method.startsWith("skills.bundle.")) {
    return {
      ok: false,
      message: "仅 tenant_admin 可管理 bundle"
    };
  }
  const isWorkspaceAdmin = principal.roles.includes("workspace_admin");
  const principalUserId = resolvePrincipalUserId(principal);
  if (scopeRef.scope === "tenant") {
    return {
      ok: false,
      message: "仅 tenant_admin 可管理 tenant 级 skill sync"
    };
  }
  if (scopeRef.scope === "workspace") {
    if (isWorkspaceAdmin) {
      return { ok: true };
    }
    return {
      ok: false,
      message: "member 仅可管理 user 级 skill sync"
    };
  }
  if (!isWorkspaceAdmin && scopeRef.userId !== principalUserId) {
    return {
      ok: false,
      message: "member 仅可管理自己的 user 级 skill sync"
    };
  }
  return { ok: true };
}

function authorizeSkillBundleAccess(principal?: Principal): { ok: true } | { ok: false; message: string } {
  if (!principal) {
    return { ok: true };
  }
  if (principal.roles.includes("tenant_admin")) {
    return { ok: true };
  }
  return {
    ok: false,
    message: "仅 tenant_admin 可访问 skills.bundle.*"
  };
}

function reconcileSkillSyncStatusRecord(input: {
  scopeRef: SkillSyncScopeRef;
  effectiveConfig: SkillSyncConfig;
  statuses: Map<string, SkillSyncStatusRecord>;
  now: () => Date;
  resetNextRun: boolean;
}): SkillSyncStatusRecord {
  const existing = input.statuses.get(input.scopeRef.key);
  const next: SkillSyncStatusRecord = {
    scope: input.scopeRef.scope,
    tenantId: input.scopeRef.tenantId,
    workspaceId: input.scopeRef.workspaceId,
    userId: input.scopeRef.userId,
    ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
    ...(existing?.lastOutcome ? { lastOutcome: existing.lastOutcome } : {}),
    ...(existing?.lastError ? { lastError: existing.lastError } : {}),
    ...(existing?.nextRunAt ? { nextRunAt: existing.nextRunAt } : {})
  };
  if (!input.effectiveConfig.autoSyncEnabled || input.effectiveConfig.manualOnly) {
    delete next.nextRunAt;
  } else if (input.resetNextRun || !next.nextRunAt) {
    next.nextRunAt = computeNextDailyRunAt({
      now: input.now(),
      syncTime: input.effectiveConfig.syncTime,
      timezone: input.effectiveConfig.timezone
    });
  }
  input.statuses.set(input.scopeRef.key, next);
  return next;
}

function toSkillSyncStatusPayload(status: SkillSyncStatusRecord | undefined): Record<string, unknown> {
  if (!status) {
    return {};
  }
  return {
    ...(status.lastRunAt ? { lastRunAt: status.lastRunAt } : {}),
    ...(status.nextRunAt ? { nextRunAt: status.nextRunAt } : {}),
    ...(status.lastOutcome ? { lastOutcome: status.lastOutcome } : {}),
    ...(status.lastError ? { lastError: status.lastError } : {})
  };
}

function listSkillSyncRuns(runs: SkillSyncRunRecord[], scopeRef: SkillSyncScopeRef, limit: number): SkillSyncRunRecord[] {
  return runs
    .filter(
      (item) =>
        item.scope === scopeRef.scope &&
        item.tenantId === scopeRef.tenantId &&
        item.workspaceId === scopeRef.workspaceId &&
        item.userId === scopeRef.userId
    )
    .slice(-limit)
    .reverse();
}

function executeSkillSyncRun(input: {
  scopeRef: SkillSyncScopeRef;
  effectiveConfig: SkillSyncConfig;
  now: () => Date;
  statuses: Map<string, SkillSyncStatusRecord>;
  runs: SkillSyncRunRecord[];
  catalog: Map<string, SkillCatalogItem>;
  knownSources: Set<string>;
  preserveNextRunAt: boolean;
  trigger: "scheduled" | "manual";
  offlineHint: boolean;
}): SkillSyncRunRecord {
  const startedAt = input.now().toISOString();
  let status: SkillSyncRunStatus = "success";
  let fetchedSources = 0;
  let importedSkills = 0;
  let error: string | undefined;

  if (input.trigger === "scheduled" && input.effectiveConfig.manualOnly) {
    status = "skipped_manual_only";
  } else if (input.effectiveConfig.syncMode === "bundle_only") {
    status = "skipped_bundle_only";
  } else if (input.offlineHint) {
    status = "skipped_offline";
  } else {
    try {
      const sources =
        input.effectiveConfig.sourceFilters.length > 0
          ? input.effectiveConfig.sourceFilters
          : [...input.knownSources.values()];
      fetchedSources = sources.length;
      for (const source of sources) {
        input.knownSources.add(source);
        const skillId = `${source.replace(/[/:]/g, "_")}.starter`;
        const tags = input.effectiveConfig.tagFilters.length > 0 ? [...input.effectiveConfig.tagFilters] : ["starter"];
        const license: SkillSyncLicense = input.effectiveConfig.licenseFilters.includes("review") ? "review" : "allow";
        const nextItem: SkillCatalogItem = {
          skillId,
          source,
          commit: `sync_${Date.now().toString(36)}`,
          path: "SKILL.md",
          checksum: sha256(stableStringify({ skillId, source, tags, license })),
          license,
          tags,
          availability: "online"
        };
        input.catalog.set(skillId, nextItem);
        importedSkills += 1;
      }
    } catch (runError) {
      status = "failed";
      error = toErrorMessage(runError);
    }
  }

  const finishedAt = input.now().toISOString();
  const run: SkillSyncRunRecord = {
    runId: `skill_sync_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`,
    scope: input.scopeRef.scope,
    tenantId: input.scopeRef.tenantId,
    workspaceId: input.scopeRef.workspaceId,
    userId: input.scopeRef.userId,
    startedAt,
    finishedAt,
    status,
    trigger: input.trigger,
    fetchedSources,
    importedSkills,
    ...(error ? { error } : {})
  };
  input.runs.push(run);
  if (input.runs.length > 600) {
    input.runs.splice(0, input.runs.length - 600);
  }

  const current =
    input.statuses.get(input.scopeRef.key) ??
    ({
      scope: input.scopeRef.scope,
      tenantId: input.scopeRef.tenantId,
      workspaceId: input.scopeRef.workspaceId,
      userId: input.scopeRef.userId
    } as SkillSyncStatusRecord);
  current.lastRunAt = finishedAt;
  current.lastOutcome = status;
  current.lastError = error;
  if (!input.preserveNextRunAt) {
    if (input.effectiveConfig.autoSyncEnabled && !input.effectiveConfig.manualOnly) {
      current.nextRunAt = computeNextDailyRunAt({
        now: input.now(),
        syncTime: input.effectiveConfig.syncTime,
        timezone: input.effectiveConfig.timezone
      });
    } else {
      delete current.nextRunAt;
    }
  }
  input.statuses.set(input.scopeRef.key, current);
  return run;
}

async function tickSkillSyncScheduler(input: {
  now: () => Date;
  configs: Map<string, SkillSyncConfigRecord>;
  statuses: Map<string, SkillSyncStatusRecord>;
  runs: SkillSyncRunRecord[];
  catalog: Map<string, SkillCatalogItem>;
  knownSources: Set<string>;
}): Promise<void> {
  const refs = [...input.configs.values()].map<SkillSyncScopeRef>((item) => ({
    scope: item.scope,
    tenantId: item.tenantId,
    workspaceId: item.workspaceId,
    userId: item.userId,
    key: buildSkillSyncScopeKey(item.scope, item.tenantId, item.workspaceId, item.userId)
  }));
  for (const scopeRef of refs) {
    const defaults = defaultSkillSyncConfig({
      registeredSources: [...input.knownSources.values()]
    });
    const effectiveConfig = resolveEffectiveSkillSyncConfigForScope({
      scopeRef,
      defaults,
      configs: input.configs
    });
    const status = reconcileSkillSyncStatusRecord({
      scopeRef,
      effectiveConfig,
      statuses: input.statuses,
      now: input.now,
      resetNextRun: false
    });
    if (!status.nextRunAt) {
      continue;
    }
    const dueAt = Date.parse(status.nextRunAt);
    if (!Number.isFinite(dueAt) || dueAt > input.now().getTime()) {
      continue;
    }
    executeSkillSyncRun({
      scopeRef,
      effectiveConfig,
      now: input.now,
      statuses: input.statuses,
      runs: input.runs,
      catalog: input.catalog,
      knownSources: input.knownSources,
      preserveNextRunAt: false,
      trigger: "scheduled",
      offlineHint: toBoolean(process.env.OPENFOAL_FORCE_OFFLINE, false)
    });
  }
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    list.push(trimmed);
  }
  return list;
}

function applySkillCatalogFilters(items: SkillCatalogItem[], effectiveConfig: SkillSyncConfig): SkillCatalogItem[] {
  const sourceFilterSet = new Set(effectiveConfig.sourceFilters);
  const licenseFilterSet = new Set<SkillSyncLicense>(effectiveConfig.licenseFilters);
  const tagFilterSet = new Set(effectiveConfig.tagFilters);
  return items.filter((item) => {
    if (sourceFilterSet.size > 0) {
      if (!item.source || !sourceFilterSet.has(item.source)) {
        return false;
      }
    }
    if (licenseFilterSet.size > 0) {
      if (!item.license || !licenseFilterSet.has(item.license)) {
        return false;
      }
    }
    if (tagFilterSet.size > 0) {
      if (!item.tags.some((tag) => tagFilterSet.has(tag))) {
        return false;
      }
    }
    return true;
  });
}

function resolveCatalogAvailability(
  items: Array<{ availability?: SkillCatalogAvailability }>,
  syncMode: SkillSyncMode
): SkillCatalogAvailability {
  if (items.some((item) => item.availability === "online")) {
    return "online";
  }
  if (items.length > 0 || syncMode === "bundle_only") {
    return "cached";
  }
  return "unavailable";
}

function importSkillBundle(input: {
  bundle: Record<string, unknown>;
  actor: string;
  now: () => Date;
  bundles: Map<string, SkillBundleRecord>;
  catalog: Map<string, SkillCatalogItem>;
  knownSources: Set<string>;
}): { bundle: SkillBundleRecord; importedCount: number } {
  const items = normalizeSkillBundleItems(input.bundle.items);
  const checksum = computeBundleChecksum(items);
  const bundleChecksum = requireString(input.bundle, "checksum");
  if (bundleChecksum && bundleChecksum !== checksum) {
    throw new Error("bundle checksum 校验失败");
  }
  const signature = requireString(input.bundle, "signature");
  if (signature && signature !== buildBundleSignature(checksum)) {
    throw new Error("bundle signature 校验失败");
  }
  const bundleId = requireString(input.bundle, "bundleId") ?? `bundle_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
  const name = requireString(input.bundle, "name") ?? bundleId;
  const createdAt = requireString(input.bundle, "createdAt") ?? input.now().toISOString();
  const nextBundle: SkillBundleRecord = {
    bundleId,
    name,
    checksum,
    ...(signature ? { signature } : {}),
    createdAt,
    createdBy: input.actor,
    items
  };
  input.bundles.set(bundleId, nextBundle);

  for (const item of items) {
    if (item.source) {
      input.knownSources.add(item.source);
    }
    input.catalog.set(item.skillId, {
      ...item,
      availability: "cached"
    });
  }

  return {
    bundle: nextBundle,
    importedCount: items.length
  };
}

function exportSkillBundle(input: {
  bundleId?: string;
  name?: string;
  actor: string;
  skillIds: string[];
  now: () => Date;
  bundles: Map<string, SkillBundleRecord>;
  catalog: Map<string, SkillCatalogItem>;
}): SkillBundleRecord {
  if (input.bundleId) {
    const existing = input.bundles.get(input.bundleId);
    if (!existing) {
      throw new Error(`未知 bundle: ${input.bundleId}`);
    }
    return existing;
  }

  const selected = input.skillIds.length > 0
    ? input.skillIds.map((skillId) => input.catalog.get(skillId)).filter((item): item is SkillCatalogItem => Boolean(item))
    : [...input.catalog.values()];
  const items: SkillBundleItemRecord[] = selected.map((item) => ({
    skillId: item.skillId,
    ...(item.source ? { source: item.source } : {}),
    ...(item.commit ? { commit: item.commit } : {}),
    ...(item.path ? { path: item.path } : {}),
    ...(item.checksum ? { checksum: item.checksum } : {}),
    ...(item.license ? { license: item.license } : {}),
    tags: [...item.tags]
  }));
  const checksum = computeBundleChecksum(items);
  const bundleId = `bundle_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
  const bundle: SkillBundleRecord = {
    bundleId,
    name: input.name?.trim() || `bundle-${new Date().toISOString().slice(0, 10)}`,
    checksum,
    signature: buildBundleSignature(checksum),
    createdAt: input.now().toISOString(),
    createdBy: input.actor,
    items
  };
  input.bundles.set(bundle.bundleId, bundle);
  return bundle;
}

function toSkillBundlePayload(bundle: SkillBundleRecord): Record<string, unknown> {
  return {
    bundleId: bundle.bundleId,
    name: bundle.name,
    checksum: bundle.checksum,
    ...(bundle.signature ? { signature: bundle.signature } : {}),
    createdAt: bundle.createdAt,
    createdBy: bundle.createdBy,
    items: bundle.items.map((item) => ({
      skillId: item.skillId,
      source: item.source,
      commit: item.commit,
      path: item.path,
      checksum: item.checksum,
      license: item.license,
      tags: item.tags
    }))
  };
}

function normalizeSkillBundleItems(value: unknown): SkillBundleItemRecord[] {
  if (!Array.isArray(value)) {
    throw new Error("bundle.items 必须是数组");
  }
  const out: SkillBundleItemRecord[] = [];
  for (const item of value) {
    if (!isObjectRecord(item)) {
      continue;
    }
    const skillId = requireString(item, "skillId");
    if (!skillId) {
      continue;
    }
    const rawLicense = requireString(item, "license");
    const license = rawLicense && (rawLicense === "allow" || rawLicense === "review" || rawLicense === "deny") ? rawLicense : undefined;
    out.push({
      skillId,
      ...(requireString(item, "source") ? { source: requireString(item, "source") } : {}),
      ...(requireString(item, "commit") ? { commit: requireString(item, "commit") } : {}),
      ...(requireString(item, "path") ? { path: requireString(item, "path") } : {}),
      ...(requireString(item, "checksum") ? { checksum: requireString(item, "checksum") } : {}),
      ...(license ? { license } : {}),
      tags: toStringList(item.tags)
    });
  }
  if (out.length === 0) {
    throw new Error("bundle.items 不能为空");
  }
  return out;
}

function computeBundleChecksum(items: SkillBundleItemRecord[]): string {
  return sha256(stableStringify(items));
}

function buildBundleSignature(checksum: string): string {
  return `sig:${checksum}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no") {
      return false;
    }
  }
  return fallback;
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

function asLlmOptions(value: unknown): GatewayLlmOptions | undefined {
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
    ...(provider ? { provider: normalizeLlmProvider(provider) } : {}),
    ...(modelId ? { modelId } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {})
  };
}

function toAcceptedLlmPayload(value: GatewayLlmOptions | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const modelRef = typeof value.modelRef === "string" && value.modelRef.trim().length > 0 ? value.modelRef.trim() : undefined;
  const provider = typeof value.provider === "string" && value.provider.trim().length > 0 ? value.provider.trim() : undefined;
  const modelId = typeof value.modelId === "string" && value.modelId.trim().length > 0 ? value.modelId.trim() : undefined;
  const baseUrl = typeof value.baseUrl === "string" && value.baseUrl.trim().length > 0 ? value.baseUrl.trim() : undefined;
  if (!modelRef && !provider && !modelId && !baseUrl) {
    return undefined;
  }
  return {
    ...(modelRef ? { modelRef } : {}),
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
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

function normalizeTranscriptItemForClient<T extends { event: string; payload: Record<string, unknown> }>(item: T): T {
  if (item.event !== "agent.delta") {
    return item;
  }
  const delta = asString(item.payload.delta);
  if (delta !== undefined) {
    return item;
  }
  const legacyText = asString(item.payload.text);
  if (legacyText === undefined) {
    return item;
  }
  return {
    ...item,
    payload: {
      ...item.payload,
      delta: legacyText
    }
  };
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

function resolveMemoryToolArgs(
  params: Record<string, unknown>,
  state: ConnectionState,
  mode: "read" | "write"
): {
  ok: true;
  args: Record<string, unknown>;
  ctx: {
    tenantId?: string;
    workspaceId?: string;
    userId?: string;
  };
} | {
  ok: false;
  message: string;
} {
  if (!state.principal) {
    return {
      ok: true,
      args: { ...params },
      ctx: {}
    };
  }
  const namespace = params.namespace === "workspace" ? "workspace" : "user";
  if (namespace === "workspace" && mode === "write" && !canReadCrossUserSessions(state.principal)) {
    return {
      ok: false,
      message: "member 不允许写入 workspace 共享记忆"
    };
  }
  const tenantId = requireString(params, "tenantId") ?? state.principal.tenantId;
  const workspaceId = requireString(params, "workspaceId") ?? state.principal.workspaceIds[0] ?? "w_default";
  const principalUserId = resolvePrincipalUserId(state.principal);
  const resolvedUserId =
    canReadCrossUserSessions(state.principal) && requireString(params, "userId")
      ? requireString(params, "userId")
      : principalUserId;
  const args: Record<string, unknown> = {
    ...params,
    namespace,
    resourceType: "memory",
    tenantId,
    workspaceId,
    userId: resolvedUserId
  };
  return {
    ok: true,
    args,
    ctx: {
      tenantId,
      workspaceId,
      userId: resolvedUserId
    }
  };
}

function resolveContextAccess(
  params: Record<string, unknown>,
  state: ConnectionState,
  mode: "read" | "write"
): {
  ok: true;
  root: string;
  legacyRoot?: string;
  layer: "tenant" | "workspace" | "user";
  fileName: string;
} | {
  ok: false;
  message: string;
} {
  const fileName = normalizeContextFileName(params.file);
  if (!fileName) {
    return {
      ok: false,
      message: "context 仅允许 AGENTS.md/SOUL.md/TOOLS.md/USER.md"
    };
  }
  if (!state.principal) {
    const legacyRoot = process.cwd();
    return {
      ok: true,
      root: joinPath(legacyRoot, ".openfoal", "context"),
      legacyRoot,
      layer: "user",
      fileName
    };
  }
  const layer = params.layer === "tenant" || params.layer === "workspace" ? params.layer : "user";
  const isTenantAdmin = state.principal.roles.includes("tenant_admin");
  const isWorkspaceAdmin = state.principal.roles.includes("workspace_admin");
  if (layer === "tenant" && !isTenantAdmin) {
    return {
      ok: false,
      message: "仅 tenant_admin 可访问 tenant 级 context"
    };
  }
  if (layer === "workspace" && !(isTenantAdmin || isWorkspaceAdmin)) {
    return {
      ok: false,
      message: "仅管理员可访问 workspace 级 context"
    };
  }
  if (mode === "write" && layer === "user" && !canReadCrossUserSessions(state.principal)) {
    const targetUserId = requireString(params, "userId");
    const principalUserId = resolvePrincipalUserId(state.principal);
    if (targetUserId && targetUserId !== principalUserId) {
      return {
        ok: false,
        message: "member 不允许写入其他用户 context"
      };
    }
  }
  const tenantId = sanitizeScopePathSegment(requireString(params, "tenantId") ?? state.principal.tenantId);
  const workspaceId = sanitizeScopePathSegment(requireString(params, "workspaceId") ?? state.principal.workspaceIds[0] ?? "w_default");
  const targetUserId = sanitizeScopePathSegment(
    canReadCrossUserSessions(state.principal) && requireString(params, "userId")
      ? requireString(params, "userId")!
      : resolvePrincipalUserId(state.principal)
  );
  const storageRoot = sanitizeStorageRoot(process.env.OPENFOAL_ENTERPRISE_STORAGE_ROOT ?? "/data/openfoal");
  const legacyRoot =
    layer === "tenant"
      ? joinPath(storageRoot, "tenants", tenantId, "workspaces", workspaceId, "skills", "tenant")
      : layer === "workspace"
        ? joinPath(storageRoot, "tenants", tenantId, "workspaces", workspaceId, "skills", "workspace")
        : joinPath(storageRoot, "tenants", tenantId, "workspaces", workspaceId, "users", targetUserId, "skills");
  return {
    ok: true,
    root: joinPath(legacyRoot, ".openfoal", "context"),
    legacyRoot,
    layer,
    fileName
  };
}

function normalizeUserStatus(value: unknown): "active" | "disabled" | undefined {
  if (value === "active" || value === "disabled") {
    return value;
  }
  return undefined;
}

function normalizeMembershipRole(value: unknown): MembershipRole {
  if (value === "tenant_admin" || value === "workspace_admin") {
    return value;
  }
  return "member";
}

function readMembershipPatch(
  params: Record<string, unknown>,
  fallbackWorkspaceId: string,
  fallbackRole: MembershipRole
): Array<{ workspaceId: string; role: MembershipRole }> {
  const source = params.memberships;
  if (!Array.isArray(source)) {
    return [
      {
        workspaceId: fallbackWorkspaceId,
        role: fallbackRole
      }
    ];
  }
  const out: Array<{ workspaceId: string; role: MembershipRole }> = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const workspaceId = requireString(row, "workspaceId");
    if (!workspaceId || seen.has(workspaceId)) {
      continue;
    }
    seen.add(workspaceId);
    out.push({
      workspaceId,
      role: normalizeMembershipRole(row.role)
    });
  }
  if (out.length === 0) {
    out.push({
      workspaceId: fallbackWorkspaceId,
      role: fallbackRole
    });
  }
  return out;
}

function toUserPayload(user: {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  status: "active" | "disabled";
  source: "local" | "external";
  lastLoginAt?: string;
}): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    ...(user.email ? { email: user.email } : {}),
    status: user.status,
    source: user.source,
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt } : {})
  };
}

function toTenantUserPayload(item: TenantUserRecord): Record<string, unknown> {
  return {
    user: toUserPayload(item.user),
    tenant: {
      tenantId: item.tenant.tenantId,
      userId: item.tenant.userId,
      defaultWorkspaceId: item.tenant.defaultWorkspaceId,
      status: item.tenant.status,
      updatedAt: item.tenant.updatedAt
    },
    memberships: item.memberships.map((membership) => ({
      workspaceId: membership.workspaceId,
      role: membership.role,
      updatedAt: membership.updatedAt
    }))
  };
}

function toModelSecretMetaPayload(input: ModelSecretRecord | ModelSecretMetaRecord): Record<string, unknown> {
  const apiKey = "apiKey" in input ? String(input.apiKey ?? "") : undefined;
  return {
    tenantId: input.tenantId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    provider: input.provider,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    maskedKey: "maskedKey" in input ? input.maskedKey : maskSecret(apiKey ?? ""),
    keyLast4: "keyLast4" in input ? input.keyLast4 : (apiKey ?? "").slice(-4),
    updatedBy: input.updatedBy,
    updatedAt: input.updatedAt
  };
}

async function resolveRunLlmOptions(input: {
  requested?: GatewayLlmOptions;
  principal?: Principal;
  preferSecretConfig?: boolean;
  tenantId: string;
  workspaceId: string;
  modelSecretRepo: ModelSecretRepository;
}): Promise<GatewayLlmOptions | undefined> {
  const requested: GatewayLlmOptions = input.requested ? { ...input.requested } : {};
  if (requested.provider) {
    requested.provider = normalizeLlmProvider(requested.provider);
  }
  if (input.principal) {
    delete requested.apiKey;
  }

  const providerHint = requested.provider;
  const providerCandidates = providerHint ? resolveProviderCandidates(providerHint) : [];
  let secret: ModelSecretRecord | undefined;
  if (providerCandidates.length > 0) {
    for (const candidate of providerCandidates) {
      secret = await input.modelSecretRepo.getForRun({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        provider: candidate
      });
      if (secret) {
        break;
      }
    }
  } else {
    secret = await input.modelSecretRepo.getForRun({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId
    });
  }
  if (!secret && providerCandidates.length > 0) {
    secret = await input.modelSecretRepo.getForRun({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId
    });
  }
  if (!secret) {
    return Object.keys(requested).length > 0 ? requested : undefined;
  }

  const preferSecretConfig = input.preferSecretConfig === true;
  const merged: GatewayLlmOptions = {
    ...(Object.keys(requested).length > 0 ? requested : {}),
    provider: preferSecretConfig ? secret.provider ?? requested.provider : requested.provider ?? secret.provider,
    modelId: preferSecretConfig ? secret.modelId ?? requested.modelId : requested.modelId ?? secret.modelId,
    baseUrl: preferSecretConfig ? secret.baseUrl ?? requested.baseUrl : requested.baseUrl ?? secret.baseUrl,
    apiKey: secret.apiKey
  };
  return merged;
}

const PROVIDER_CANONICALS = ["openai", "anthropic", "gemini", "deepseek", "qwen", "doubao", "openrouter", "ollama"] as const;
const KIMI_PROVIDER_ALIASES = ["moonshot", "moonshotai", "kimi-k2.5", "kimi-k2p5", "kimi-k2", "k2.5", "k2p5"] as const;

function normalizeLlmProvider(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized.length === 0) {
    return "openai";
  }
  if (
    normalized === "kimi" ||
    normalized.startsWith("kimi-") ||
    normalized.startsWith("kimi/") ||
    normalized.includes("moonshot") ||
    KIMI_PROVIDER_ALIASES.includes(normalized as (typeof KIMI_PROVIDER_ALIASES)[number])
  ) {
    return "kimi";
  }
  for (const provider of PROVIDER_CANONICALS) {
    if (normalized === provider || normalized.startsWith(`${provider}-`) || normalized.startsWith(`${provider}/`)) {
      return provider;
    }
  }
  return normalized;
}

function resolveProviderCandidates(provider: string): string[] {
  const raw = provider.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const canonical = normalizeLlmProvider(provider);
  const out = new Set<string>();
  if (raw.length > 0) {
    out.add(raw);
  }
  out.add(canonical);
  if (canonical === "kimi") {
    for (const alias of KIMI_PROVIDER_ALIASES) {
      out.add(alias);
    }
  }
  return Array.from(out);
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
      const policy = await input.policyRepo.get({
        tenantId: ctx.tenantId ?? "t_default",
        workspaceId: ctx.workspaceId ?? "w_default",
        scopeKey: "default"
      });
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
  getToolScope?: (sessionId: string) => { tenantId: string; workspaceId: string; userId: string; workspaceRoot?: string } | undefined;
}): ToolExecutor {
  return {
    async execute(call: ToolCall, ctx: ToolContext, hooks?: ToolExecutionHooks): Promise<ToolResult> {
      const toolScope = input.getToolScope?.(ctx.sessionId);
      const scopedCtx: ToolContext = {
        ...ctx,
        ...(toolScope
          ? {
              tenantId: toolScope.tenantId,
              workspaceId: toolScope.workspaceId,
              userId: toolScope.userId,
              ...(toolScope.workspaceRoot ? { workspaceRoot: toolScope.workspaceRoot } : {})
            }
          : {})
      };
      const target = input.getExecutionTarget(ctx.sessionId);
      if (!target || target.kind === "local-host") {
        return await input.local.execute(call, scopedCtx, hooks);
      }
      return await input.dockerRunnerInvoker({
        target,
        call,
        ctx: scopedCtx,
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

function resolveCloudFailurePolicy(
  params: Record<string, unknown>,
  targetConfig: Record<string, unknown>
): CloudFailurePolicy {
  return (
    normalizeCloudFailurePolicy(requireString(params, "cloudFailurePolicy")) ??
    normalizeCloudFailurePolicy(isObjectRecord(targetConfig) ? requireString(targetConfig, "cloudFailurePolicy") : undefined) ??
    "deny"
  );
}

function normalizeCloudFailurePolicy(value: unknown): CloudFailurePolicy | undefined {
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

async function probeExecutionTargetAvailability(target: ExecutionTargetRecord): Promise<{ ok: boolean; reason?: string }> {
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

function createLocalFallbackExecutionTarget(input: {
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

async function readCloudSandboxUsage(target: ExecutionTargetRecord): Promise<{
  available: boolean;
  source?: string;
  reason?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
}> {
  const endpoint = resolveDockerRunnerEndpoint(target);
  if (!endpoint) {
    return {
      available: false,
      reason: `docker-runner 缺少 endpoint: ${target.targetId}`
    };
  }
  const healthEndpoint = resolveDockerRunnerHealthEndpoint(endpoint);
  const timeoutMs = Math.max(1_000, Math.min(5_000, resolveDockerRunnerTimeoutMs(target.config)));
  const headers: Record<string, string> = {};
  if (target.authToken) {
    headers.authorization = `Bearer ${target.authToken}`;
  }

  try {
    const response = await sendDockerRunnerHealthRequest({
      endpoint: healthEndpoint,
      timeoutMs,
      headers
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return {
        available: false,
        reason: `health 响应异常(${response.statusCode})`
      };
    }
    const payload = parseJsonObject(response.text);
    if (!payload) {
      return {
        available: false,
        reason: "health 返回非 JSON"
      };
    }
    const usage = parseSandboxUsage(payload);
    if (!usage) {
      return {
        available: false,
        reason: "health 缺少 usage 字段"
      };
    }
    return {
      available: true,
      source: asString(payload.service) ?? "docker-runner",
      ...usage
    };
  } catch (error) {
    return {
      available: false,
      reason: toErrorMessage(error)
    };
  }
}

function resolveDockerRunnerHealthEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  const rawPath = url.pathname || "/";
  if (/\/execute\/?$/.test(rawPath)) {
    url.pathname = rawPath.replace(/\/execute\/?$/, "/health");
  } else {
    url.pathname = `${rawPath.replace(/\/+$/, "")}/health`;
  }
  url.search = "";
  return url.toString();
}

async function sendDockerRunnerHealthRequest(input: {
  endpoint: string;
  timeoutMs: number;
  headers: Record<string, string>;
}): Promise<{ statusCode: number; text: string }> {
  const url = new URL(input.endpoint);
  return await new Promise((resolve, reject) => {
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname || "/"}${url.search || ""}`,
        method: "GET",
        headers: input.headers
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
    req.on("error", reject);
    req.end();
  });
}

function parseSandboxUsage(payload: Record<string, unknown>): {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
} | undefined {
  const usageRoot = isObjectRecord(payload.usage) ? payload.usage : payload;
  const cpuPercent = normalizePercentField(
    usageRoot.cpuPercent ?? usageRoot.cpuUsagePercent ?? usageRoot.cpu ?? usageRoot.cpuUsage
  );
  const memoryPercent = normalizePercentField(
    usageRoot.memoryPercent ?? usageRoot.memPercent ?? usageRoot.memory ?? usageRoot.memoryUsage
  );
  const diskPercent = normalizePercentField(
    usageRoot.diskPercent ?? usageRoot.storagePercent ?? usageRoot.disk ?? usageRoot.diskUsage
  );
  if (cpuPercent === undefined || memoryPercent === undefined || diskPercent === undefined) {
    return undefined;
  }
  return {
    cpuPercent,
    memoryPercent,
    diskPercent
  };
}

function normalizePercentField(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const raw = value >= 0 && value <= 1 ? value * 100 : value;
  const clamped = Math.max(0, Math.min(100, raw));
  return Number(clamped.toFixed(1));
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

function maskSecret(value: string): string {
  const raw = String(value ?? "");
  if (raw.length <= 4) {
    return "****";
  }
  if (raw.length <= 8) {
    return `${raw.slice(0, 1)}***${raw.slice(-2)}`;
  }
  return `${raw.slice(0, 2)}***${raw.slice(-4)}`;
}

function normalizeContextFileName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "AGENTS.md";
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "AGENTS" || normalized === "AGENTS.MD") {
    return "AGENTS.md";
  }
  if (normalized === "SOUL" || normalized === "SOUL.MD") {
    return "SOUL.md";
  }
  if (normalized === "TOOLS" || normalized === "TOOLS.MD") {
    return "TOOLS.md";
  }
  if (normalized === "USER" || normalized === "USER.MD") {
    return "USER.md";
  }
  return undefined;
}

function defaultContextFileContent(fileName: string): string {
  switch (fileName) {
    case "AGENTS.md":
      return "# AGENTS.md\n\n- Follow project coding and safety policies.\n- Keep responses concise and executable.\n";
    case "SOUL.md":
      return "# SOUL.md\n\nPragmatic, direct engineering assistant persona.\n";
    case "TOOLS.md":
      return "# TOOLS.md\n\n- Prefer workspace-safe tools.\n- Explain side effects before destructive actions.\n";
    case "USER.md":
      return "# USER.md\n\n- Preferred language: zh-CN\n- Style: concise and practical\n";
    default:
      return "";
  }
}

function isFileNotFoundError(message: unknown): boolean {
  return typeof message === "string" && message.includes("ENOENT");
}

function sanitizeScopePathSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
}

function sanitizeStorageRoot(value: string): string {
  return resolvePath(value.trim().length > 0 ? value : "/data/openfoal");
}

function resolveGatewayStorageBackend(value: unknown): "sqlite" | "postgres" {
  if (typeof value !== "string") {
    return "sqlite";
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "postgres" || normalized === "pg" ? "postgres" : "sqlite";
}

function resolveBlobBackend(value: unknown): "fs" | "minio" {
  if (typeof value !== "string") {
    return "fs";
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "minio" ? "minio" : "fs";
}

function resolveIdempotencyBackend(value: unknown, storageBackend: "sqlite" | "postgres"): "redis" | "storage" {
  if (typeof value === "string" && value.trim().toLowerCase() === "redis") {
    return "redis";
  }
  if (storageBackend === "postgres") {
    return "redis";
  }
  return "storage";
}

function joinPath(...segments: string[]): string {
  return resolvePath(...segments.map((item) => item.trim()).filter((item) => item.length > 0));
}

async function prepareSessionForRun(input: {
  sessionRepo: SessionRepository;
  toolExecutor: ToolExecutor;
  session: SessionRecord;
  scope: {
    tenantId: string;
    workspaceId: string;
    ownerUserId?: string;
  };
  toolContext: {
    tenantId: string;
    workspaceId: string;
    userId: string;
  };
  input: string;
  now: () => Date;
}): Promise<SessionRecord> {
  let current = input.session;
  const projectedUsage = estimateContextUsage(current.contextUsage, input.input);
  const initialMeta = await input.sessionRepo.updateMeta(current.id, {
    contextUsage: projectedUsage,
    memoryFlushState: projectedUsage >= PRE_COMPACTION_THRESHOLD ? "pending" : "idle"
  }, input.scope);
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
          includeLongTerm: false,
          namespace: "user",
          tenantId: input.toolContext.tenantId,
          workspaceId: input.toolContext.workspaceId,
          userId: input.toolContext.userId
        }
      },
      {
        runId: `flush_${Date.now().toString(36)}`,
        sessionId: current.id,
        runtimeMode: current.runtimeMode,
        tenantId: input.toolContext.tenantId,
        workspaceId: input.toolContext.workspaceId,
        userId: input.toolContext.userId
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
  }, input.scope);
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
  const tenantId = requireString(req.params, "tenantId") ?? "t_default";
  const workspaceId = requireString(req.params, "workspaceId") ?? "w_default";
  const scope = requireString(req.params, "sessionId") ?? requireString(req.params, "runId") ?? "global";
  return `${tenantId}:${workspaceId}:${req.method}:${scope}:${idempotencyKey}`;
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

function resolveDailyMemoryPath(args: Record<string, unknown>, date: string): string {
  void args;
  return `.openfoal/memory/daily/${date}.md`;
}

function resolveLegacyDailyMemoryPath(args: Record<string, unknown>, date: string): string {
  const namespace = args.namespace === "workspace" || args.namespace === "user" ? args.namespace : undefined;
  if (namespace) {
    return `daily/${date}.md`;
  }
  return `memory/${date}.md`;
}

function resolveLongTermMemoryPath(): string {
  return ".openfoal/memory/MEMORY.md";
}

function byteLen(text: string): number {
  return Buffer.byteLength(text ?? "");
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
