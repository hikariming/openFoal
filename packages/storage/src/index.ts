// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { spawnSync } from "node:child_process";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { mkdirSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, resolve } from "node:path";

declare const process: any;

export type RuntimeMode = "local" | "cloud";
export type SyncState = "local_only" | "syncing" | "synced" | "conflict";
export type MemoryFlushState = "idle" | "pending" | "flushed" | "skipped";
export type PolicyDecision = "deny" | "allow";

export const DEFAULT_SESSION_TITLE = "new-session";
export const DEFAULT_SESSION_PREVIEW = "";

export interface SessionRecord {
  id: string;
  sessionKey: string;
  title: string;
  preview: string;
  runtimeMode: RuntimeMode;
  syncState: SyncState;
  contextUsage: number;
  compactionCount: number;
  memoryFlushState: MemoryFlushState;
  memoryFlushAt?: string;
  updatedAt: string;
}

export interface SessionMetaPatch {
  contextUsage?: number;
  compactionCount?: number;
  memoryFlushState?: MemoryFlushState;
  memoryFlushAt?: string;
}

export interface SessionRepository {
  list(): Promise<SessionRecord[]>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  upsert(session: SessionRecord): Promise<void>;
  setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode): Promise<SessionRecord | undefined>;
  updateMeta(sessionId: string, patch: SessionMetaPatch): Promise<SessionRecord | undefined>;
}

export interface TranscriptRecord {
  id: number;
  sessionId: string;
  runId?: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TranscriptRepository {
  append(entry: {
    sessionId: string;
    runId?: string;
    event: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void>;
  list(sessionId: string, limit?: number, beforeId?: number): Promise<TranscriptRecord[]>;
}

export interface IdempotencyResult {
  response: unknown;
  events: unknown[];
}

export interface IdempotencyRecord {
  fingerprint: string;
  result: IdempotencyResult;
  createdAt: string;
}

export interface IdempotencyRepository {
  get(cacheKey: string): Promise<IdempotencyRecord | undefined>;
  set(
    cacheKey: string,
    value: {
      fingerprint: string;
      result: IdempotencyResult;
      createdAt?: string;
    }
  ): Promise<void>;
}

export interface PolicyRecord {
  scopeKey: string;
  toolDefault: PolicyDecision;
  highRisk: PolicyDecision;
  bashMode: "sandbox" | "host";
  tools: Record<string, PolicyDecision>;
  version: number;
  updatedAt: string;
}

export interface PolicyPatch {
  toolDefault?: PolicyDecision;
  highRisk?: PolicyDecision;
  bashMode?: "sandbox" | "host";
  tools?: Record<string, PolicyDecision>;
}

export interface PolicyRepository {
  get(scopeKey?: string): Promise<PolicyRecord>;
  update(patch: PolicyPatch, scopeKey?: string): Promise<PolicyRecord>;
}

export interface MetricsRunRecord {
  id: number;
  sessionId: string;
  runId?: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  status: "completed" | "failed";
  durationMs: number;
  toolCalls: number;
  toolFailures: number;
  createdAt: string;
}

export interface MetricsSummary {
  runsTotal: number;
  runsFailed: number;
  toolCallsTotal: number;
  toolFailures: number;
  p95LatencyMs: number;
}

export interface MetricsScopeFilter {
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
}

export interface MetricsRepository {
  recordRun(entry: {
    sessionId: string;
    runId?: string;
    tenantId?: string;
    workspaceId?: string;
    agentId?: string;
    status: "completed" | "failed";
    durationMs: number;
    toolCalls: number;
    toolFailures: number;
    createdAt?: string;
  }): Promise<void>;
  summary(scope?: MetricsScopeFilter): Promise<MetricsSummary>;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(initialSessions?: SessionRecord[]) {
    const seed = initialSessions ?? [defaultSession()];
    for (const session of seed) {
      this.sessions.set(session.id, normalizeSession(session));
    }
  }

  async list(): Promise<SessionRecord[]> {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(sessionId);
  }

  async upsert(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, {
      ...normalizeSession(session),
      updatedAt: nowIso()
    });
  }

  async setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode): Promise<SessionRecord | undefined> {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return undefined;
    }

    const next: SessionRecord = {
      ...current,
      runtimeMode,
      updatedAt: nowIso()
    };
    this.sessions.set(sessionId, next);
    return next;
  }

  async updateMeta(sessionId: string, patch: SessionMetaPatch): Promise<SessionRecord | undefined> {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return undefined;
    }

    const next: SessionRecord = {
      ...current,
      ...(patch.contextUsage !== undefined ? { contextUsage: normalizeUsage(patch.contextUsage) } : {}),
      ...(patch.compactionCount !== undefined ? { compactionCount: normalizeCompactionCount(patch.compactionCount) } : {}),
      ...(patch.memoryFlushState !== undefined ? { memoryFlushState: patch.memoryFlushState } : {}),
      ...(patch.memoryFlushAt !== undefined ? { memoryFlushAt: patch.memoryFlushAt } : {}),
      updatedAt: nowIso()
    };
    this.sessions.set(sessionId, next);
    return next;
  }
}

export class InMemoryTranscriptRepository implements TranscriptRepository {
  private readonly items: TranscriptRecord[] = [];
  private nextId = 1;

  async append(entry: {
    sessionId: string;
    runId?: string;
    event: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    this.items.push({
      id: this.nextId++,
      sessionId: entry.sessionId,
      runId: entry.runId,
      event: entry.event,
      payload: entry.payload,
      createdAt: entry.createdAt ?? nowIso()
    });
  }

  async list(sessionId: string, limit = 50, beforeId?: number): Promise<TranscriptRecord[]> {
    const filtered = this.items.filter((item) => item.sessionId === sessionId && (beforeId ? item.id < beforeId : true));
    return filtered.slice(Math.max(0, filtered.length - limit));
  }
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly store = new Map<string, IdempotencyRecord>();

  async get(cacheKey: string): Promise<IdempotencyRecord | undefined> {
    return this.store.get(cacheKey);
  }

  async set(
    cacheKey: string,
    value: {
      fingerprint: string;
      result: IdempotencyResult;
      createdAt?: string;
    }
  ): Promise<void> {
    this.store.set(cacheKey, {
      fingerprint: value.fingerprint,
      result: value.result,
      createdAt: value.createdAt ?? nowIso()
    });
  }
}

export class InMemoryPolicyRepository implements PolicyRepository {
  private readonly store = new Map<string, PolicyRecord>();

  constructor(seed?: PolicyRecord[]) {
    const initial = seed ?? [defaultPolicy()];
    for (const item of initial) {
      this.store.set(item.scopeKey, normalizePolicy(item));
    }
  }

  async get(scopeKey = "default"): Promise<PolicyRecord> {
    const existing = this.store.get(scopeKey);
    if (existing) {
      return { ...existing, tools: { ...existing.tools } };
    }
    const created = { ...defaultPolicy(), scopeKey };
    this.store.set(scopeKey, created);
    return { ...created, tools: { ...created.tools } };
  }

  async update(patch: PolicyPatch, scopeKey = "default"): Promise<PolicyRecord> {
    const current = await this.get(scopeKey);
    const merged: PolicyRecord = normalizePolicy({
      ...current,
      ...(patch.toolDefault ? { toolDefault: patch.toolDefault } : {}),
      ...(patch.highRisk ? { highRisk: patch.highRisk } : {}),
      ...(patch.bashMode ? { bashMode: patch.bashMode } : {}),
      ...(patch.tools ? { tools: { ...current.tools, ...sanitizePolicyMap(patch.tools) } } : {}),
      version: current.version + 1,
      updatedAt: nowIso()
    });
    this.store.set(scopeKey, merged);
    return { ...merged, tools: { ...merged.tools } };
  }
}

export class InMemoryMetricsRepository implements MetricsRepository {
  private readonly rows: MetricsRunRecord[] = [];
  private nextId = 1;

  async recordRun(entry: {
    sessionId: string;
    runId?: string;
    tenantId?: string;
    workspaceId?: string;
    agentId?: string;
    status: "completed" | "failed";
    durationMs: number;
    toolCalls: number;
    toolFailures: number;
    createdAt?: string;
  }): Promise<void> {
    this.rows.push({
      id: this.nextId++,
      sessionId: entry.sessionId,
      runId: entry.runId,
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      agentId: entry.agentId,
      status: entry.status,
      durationMs: Math.max(0, Math.round(entry.durationMs)),
      toolCalls: Math.max(0, Math.floor(entry.toolCalls)),
      toolFailures: Math.max(0, Math.floor(entry.toolFailures)),
      createdAt: entry.createdAt ?? nowIso()
    });
  }

  async summary(scope: MetricsScopeFilter = {}): Promise<MetricsSummary> {
    return summarizeMetrics(
      this.rows.filter((row) => (scope.tenantId ? row.tenantId === scope.tenantId : true))
        .filter((row) => (scope.workspaceId ? row.workspaceId === scope.workspaceId : true))
        .filter((row) => (scope.agentId ? row.agentId === scope.agentId : true))
    );
  }
}

export class SqliteSessionRepository implements SessionRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async list(): Promise<SessionRecord[]> {
    ensureSchema(this.dbPath);
    return queryJson<SessionRecord>(
      this.dbPath,
      `
        SELECT
          id AS id,
          session_key AS sessionKey,
          title AS title,
          preview AS preview,
          runtime_mode AS runtimeMode,
          sync_state AS syncState,
          context_usage AS contextUsage,
          compaction_count AS compactionCount,
          memory_flush_state AS memoryFlushState,
          memory_flush_at AS memoryFlushAt,
          updated_at AS updatedAt
        FROM sessions
        ORDER BY updated_at DESC;
      `
    ).map(normalizeSession);
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    ensureSchema(this.dbPath);
    const rows = queryJson<SessionRecord>(
      this.dbPath,
      `
        SELECT
          id AS id,
          session_key AS sessionKey,
          title AS title,
          preview AS preview,
          runtime_mode AS runtimeMode,
          sync_state AS syncState,
          context_usage AS contextUsage,
          compaction_count AS compactionCount,
          memory_flush_state AS memoryFlushState,
          memory_flush_at AS memoryFlushAt,
          updated_at AS updatedAt
        FROM sessions
        WHERE id = ${sqlString(sessionId)}
        LIMIT 1;
      `
    );
    return rows[0] ? normalizeSession(rows[0]) : undefined;
  }

  async upsert(session: SessionRecord): Promise<void> {
    ensureSchema(this.dbPath);
    const normalized = normalizeSession(session);
    const updatedAt = nowIso();
    execSql(
      this.dbPath,
      `
        INSERT INTO sessions (
          id,
          session_key,
          title,
          preview,
          runtime_mode,
          sync_state,
          context_usage,
          compaction_count,
          memory_flush_state,
          memory_flush_at,
          updated_at
        )
        VALUES (
          ${sqlString(normalized.id)},
          ${sqlString(normalized.sessionKey)},
          ${sqlString(normalized.title)},
          ${sqlString(normalized.preview)},
          ${sqlString(normalized.runtimeMode)},
          ${sqlString(normalized.syncState)},
          ${sqlNumber(normalized.contextUsage)},
          ${sqlInt(normalized.compactionCount)},
          ${sqlString(normalized.memoryFlushState)},
          ${sqlMaybeString(normalized.memoryFlushAt)},
          ${sqlString(updatedAt)}
        )
        ON CONFLICT(id) DO UPDATE SET
          session_key = excluded.session_key,
          title = excluded.title,
          preview = excluded.preview,
          runtime_mode = excluded.runtime_mode,
          sync_state = excluded.sync_state,
          context_usage = excluded.context_usage,
          compaction_count = excluded.compaction_count,
          memory_flush_state = excluded.memory_flush_state,
          memory_flush_at = excluded.memory_flush_at,
          updated_at = excluded.updated_at;
      `
    );
  }

  async setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode): Promise<SessionRecord | undefined> {
    ensureSchema(this.dbPath);
    const existing = await this.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const updatedAt = nowIso();
    execSql(
      this.dbPath,
      `
        UPDATE sessions
        SET runtime_mode = ${sqlString(runtimeMode)}, updated_at = ${sqlString(updatedAt)}
        WHERE id = ${sqlString(sessionId)};
      `
    );

    return await this.get(sessionId);
  }

  async updateMeta(sessionId: string, patch: SessionMetaPatch): Promise<SessionRecord | undefined> {
    ensureSchema(this.dbPath);
    const existing = await this.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const merged = {
      contextUsage: patch.contextUsage !== undefined ? normalizeUsage(patch.contextUsage) : existing.contextUsage,
      compactionCount:
        patch.compactionCount !== undefined ? normalizeCompactionCount(patch.compactionCount) : existing.compactionCount,
      memoryFlushState: patch.memoryFlushState ?? existing.memoryFlushState,
      memoryFlushAt: patch.memoryFlushAt !== undefined ? patch.memoryFlushAt : existing.memoryFlushAt,
      updatedAt: nowIso()
    };

    execSql(
      this.dbPath,
      `
        UPDATE sessions
        SET
          context_usage = ${sqlNumber(merged.contextUsage)},
          compaction_count = ${sqlInt(merged.compactionCount)},
          memory_flush_state = ${sqlString(merged.memoryFlushState)},
          memory_flush_at = ${sqlMaybeString(merged.memoryFlushAt)},
          updated_at = ${sqlString(merged.updatedAt)}
        WHERE id = ${sqlString(sessionId)};
      `
    );

    return await this.get(sessionId);
  }
}

export class SqliteTranscriptRepository implements TranscriptRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async append(entry: {
    sessionId: string;
    runId?: string;
    event: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    ensureSchema(this.dbPath);
    execSql(
      this.dbPath,
      `
        INSERT INTO transcript (session_id, run_id, event, payload_json, created_at)
        VALUES (
          ${sqlString(entry.sessionId)},
          ${sqlMaybeString(entry.runId)},
          ${sqlString(entry.event)},
          ${sqlString(JSON.stringify(entry.payload))},
          ${sqlString(entry.createdAt ?? nowIso())}
        );
      `
    );
  }

  async list(sessionId: string, limit = 50, beforeId?: number): Promise<TranscriptRecord[]> {
    ensureSchema(this.dbPath);
    const safeLimit = Math.max(1, Math.floor(limit));
    const beforeFilter = typeof beforeId === "number" && Number.isFinite(beforeId) ? ` AND id < ${Math.floor(beforeId)}` : "";
    const rows = queryJson<{
      id: number;
      sessionId: string;
      runId: string | null;
      event: string;
      payloadJson: string;
      createdAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          id AS id,
          session_id AS sessionId,
          run_id AS runId,
          event AS event,
          payload_json AS payloadJson,
          created_at AS createdAt
        FROM (
          SELECT
            id,
            session_id,
            run_id,
            event,
            payload_json,
            created_at
          FROM transcript
          WHERE session_id = ${sqlString(sessionId)}
          ${beforeFilter}
          ORDER BY id DESC
          LIMIT ${safeLimit}
        )
        ORDER BY id ASC;
      `
    );

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      runId: row.runId ?? undefined,
      event: row.event,
      payload: parseJsonObject(row.payloadJson),
      createdAt: row.createdAt
    }));
  }
}

export class SqliteIdempotencyRepository implements IdempotencyRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async get(cacheKey: string): Promise<IdempotencyRecord | undefined> {
    ensureSchema(this.dbPath);
    const rows = queryJson<{
      fingerprint: string;
      resultJson: string;
      createdAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          fingerprint AS fingerprint,
          result_json AS resultJson,
          created_at AS createdAt
        FROM idempotency
        WHERE cache_key = ${sqlString(cacheKey)}
        LIMIT 1;
      `
    );
    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    return {
      fingerprint: row.fingerprint,
      result: parseIdempotencyResult(row.resultJson),
      createdAt: row.createdAt
    };
  }

  async set(
    cacheKey: string,
    value: {
      fingerprint: string;
      result: IdempotencyResult;
      createdAt?: string;
    }
  ): Promise<void> {
    ensureSchema(this.dbPath);
    execSql(
      this.dbPath,
      `
        INSERT INTO idempotency (cache_key, fingerprint, result_json, created_at)
        VALUES (
          ${sqlString(cacheKey)},
          ${sqlString(value.fingerprint)},
          ${sqlString(JSON.stringify(value.result))},
          ${sqlString(value.createdAt ?? nowIso())}
        )
        ON CONFLICT(cache_key) DO UPDATE SET
          fingerprint = excluded.fingerprint,
          result_json = excluded.result_json,
          created_at = excluded.created_at;
      `
    );
  }
}

export class SqlitePolicyRepository implements PolicyRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async get(scopeKey = "default"): Promise<PolicyRecord> {
    ensureSchema(this.dbPath);
    const rows = queryJson<{
      scopeKey: string;
      policyJson: string;
      version: number;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          scope_key AS scopeKey,
          policy_json AS policyJson,
          version AS version,
          updated_at AS updatedAt
        FROM policy
        WHERE scope_key = ${sqlString(scopeKey)}
        LIMIT 1;
      `
    );

    if (rows.length === 0) {
      const created = normalizePolicy({ ...defaultPolicy(), scopeKey });
      await this.update(created, scopeKey);
      return await this.get(scopeKey);
    }

    return parsePolicyRow(rows[0]);
  }

  async update(patch: PolicyPatch, scopeKey = "default"): Promise<PolicyRecord> {
    ensureSchema(this.dbPath);
    const current = await this.get(scopeKey);
    const merged = normalizePolicy({
      ...current,
      ...(patch.toolDefault ? { toolDefault: patch.toolDefault } : {}),
      ...(patch.highRisk ? { highRisk: patch.highRisk } : {}),
      ...(patch.bashMode ? { bashMode: patch.bashMode } : {}),
      ...(patch.tools ? { tools: { ...current.tools, ...sanitizePolicyMap(patch.tools) } } : {}),
      version: current.version + 1,
      updatedAt: nowIso()
    });

    execSql(
      this.dbPath,
      `
        INSERT INTO policy (scope_key, policy_json, version, updated_at)
        VALUES (
          ${sqlString(scopeKey)},
          ${sqlString(JSON.stringify({
            toolDefault: merged.toolDefault,
            highRisk: merged.highRisk,
            bashMode: merged.bashMode,
            tools: merged.tools
          }))},
          ${sqlInt(merged.version)},
          ${sqlString(merged.updatedAt)}
        )
        ON CONFLICT(scope_key) DO UPDATE SET
          policy_json = excluded.policy_json,
          version = excluded.version,
          updated_at = excluded.updated_at;
      `
    );

    return await this.get(scopeKey);
  }
}

export class SqliteMetricsRepository implements MetricsRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async recordRun(entry: {
    sessionId: string;
    runId?: string;
    tenantId?: string;
    workspaceId?: string;
    agentId?: string;
    status: "completed" | "failed";
    durationMs: number;
    toolCalls: number;
    toolFailures: number;
    createdAt?: string;
  }): Promise<void> {
    ensureSchema(this.dbPath);
    execSql(
      this.dbPath,
      `
        INSERT INTO run_metrics (
          session_id,
          run_id,
          tenant_id,
          workspace_id,
          agent_id,
          status,
          duration_ms,
          tool_calls,
          tool_failures,
          created_at
        )
        VALUES (
          ${sqlString(entry.sessionId)},
          ${sqlMaybeString(entry.runId)},
          ${sqlMaybeString(entry.tenantId)},
          ${sqlMaybeString(entry.workspaceId)},
          ${sqlMaybeString(entry.agentId)},
          ${sqlString(entry.status)},
          ${sqlInt(Math.max(0, Math.round(entry.durationMs)))},
          ${sqlInt(Math.max(0, Math.floor(entry.toolCalls)))},
          ${sqlInt(Math.max(0, Math.floor(entry.toolFailures)))},
          ${sqlString(entry.createdAt ?? nowIso())}
        );
      `
    );
  }

  async summary(scope: MetricsScopeFilter = {}): Promise<MetricsSummary> {
    ensureSchema(this.dbPath);
    const where: string[] = [];
    if (scope.tenantId) {
      where.push(`tenant_id = ${sqlString(scope.tenantId)}`);
    }
    if (scope.workspaceId) {
      where.push(`workspace_id = ${sqlString(scope.workspaceId)}`);
    }
    if (scope.agentId) {
      where.push(`agent_id = ${sqlString(scope.agentId)}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = queryJson<MetricsRunRecord>(
      this.dbPath,
      `
        SELECT
          id AS id,
          session_id AS sessionId,
          run_id AS runId,
          tenant_id AS tenantId,
          workspace_id AS workspaceId,
          agent_id AS agentId,
          status AS status,
          duration_ms AS durationMs,
          tool_calls AS toolCalls,
          tool_failures AS toolFailures,
          created_at AS createdAt
        FROM run_metrics
        ${whereSql}
        ORDER BY id ASC;
      `
    );
    return summarizeMetrics(rows);
  }
}

function parsePolicyRow(row: { scopeKey: string; policyJson: string; version: number; updatedAt: string }): PolicyRecord {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(row.policyJson);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }

  return normalizePolicy({
    scopeKey: row.scopeKey,
    toolDefault: asPolicyDecision(parsed.toolDefault) ?? defaultPolicy().toolDefault,
    highRisk: asPolicyDecision(parsed.highRisk) ?? defaultPolicy().highRisk,
    bashMode: parsed.bashMode === "host" ? "host" : "sandbox",
    tools: sanitizePolicyMap(parsed.tools),
    version: Number.isFinite(Number(row.version)) ? Number(row.version) : 1,
    updatedAt: row.updatedAt
  });
}

function summarizeMetrics(rows: Array<{
  status: string;
  durationMs: number;
  toolCalls: number;
  toolFailures: number;
}>): MetricsSummary {
  const runsTotal = rows.length;
  const runsFailed = rows.filter((row) => row.status === "failed").length;
  const toolCallsTotal = rows.reduce((sum, row) => sum + normalizeInt(row.toolCalls), 0);
  const toolFailures = rows.reduce((sum, row) => sum + normalizeInt(row.toolFailures), 0);
  const durations = rows.map((row) => normalizeInt(row.durationMs)).sort((a, b) => a - b);
  const p95LatencyMs = percentile95(durations);

  return {
    runsTotal,
    runsFailed,
    toolCallsTotal,
    toolFailures,
    p95LatencyMs
  };
}

function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const index = Math.max(0, Math.ceil(values.length * 0.95) - 1);
  return values[Math.min(values.length - 1, index)] ?? 0;
}

function defaultSession(): SessionRecord {
  return {
    id: "s_default",
    sessionKey: "workspace:w_default/agent:a_default/main",
    title: DEFAULT_SESSION_TITLE,
    preview: DEFAULT_SESSION_PREVIEW,
    runtimeMode: "local",
    syncState: "local_only",
    contextUsage: 0,
    compactionCount: 0,
    memoryFlushState: "idle",
    updatedAt: nowIso()
  };
}

function defaultPolicy(): PolicyRecord {
  return {
    scopeKey: "default",
    toolDefault: "deny",
    highRisk: "allow",
    bashMode: "sandbox",
    tools: {
      "math.add": "allow",
      "text.upper": "allow",
      echo: "allow",
      "file.read": "allow",
      "file.list": "allow",
      "memory.get": "allow"
    },
    version: 1,
    updatedAt: nowIso()
  };
}

function defaultSqlitePath(): string {
  const fromEnv = process.env.OPENFOAL_SQLITE_PATH;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return normalizeDbPath(fromEnv.trim());
  }
  return normalizeDbPath(resolve(process.cwd(), ".openfoal", "gateway.sqlite"));
}

const initializedDbPaths = new Set<string>();

function ensureSchema(dbPath: string): void {
  if (initializedDbPaths.has(dbPath)) {
    return;
  }

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  execSql(
    dbPath,
    `
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      DROP INDEX IF EXISTS idx_approval_run_id;
      DROP INDEX IF EXISTS idx_approval_match;
      DROP TABLE IF EXISTS approval_queue;

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'new-session',
        preview TEXT NOT NULL DEFAULT '',
        runtime_mode TEXT NOT NULL,
        sync_state TEXT NOT NULL,
        context_usage REAL NOT NULL DEFAULT 0,
        compaction_count INTEGER NOT NULL DEFAULT 0,
        memory_flush_state TEXT NOT NULL DEFAULT 'idle',
        memory_flush_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
      ON sessions(updated_at DESC);

      CREATE TABLE IF NOT EXISTS transcript (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        run_id TEXT,
        event TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transcript_session_id
      ON transcript(session_id, id DESC);

      CREATE TABLE IF NOT EXISTS idempotency (
        cache_key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS policy (
        scope_key TEXT PRIMARY KEY,
        policy_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        run_id TEXT,
        tenant_id TEXT,
        workspace_id TEXT,
        agent_id TEXT,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        tool_calls INTEGER NOT NULL,
        tool_failures INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `
  );

  ensureSessionColumns(dbPath);
  ensureRunMetricsColumns(dbPath);

  const seed = defaultSession();
  execSql(
    dbPath,
    `
      INSERT OR IGNORE INTO sessions (
        id,
        session_key,
        title,
        preview,
        runtime_mode,
        sync_state,
        context_usage,
        compaction_count,
        memory_flush_state,
        memory_flush_at,
        updated_at
      )
      VALUES (
        ${sqlString(seed.id)},
        ${sqlString(seed.sessionKey)},
        ${sqlString(seed.title)},
        ${sqlString(seed.preview)},
        ${sqlString(seed.runtimeMode)},
        ${sqlString(seed.syncState)},
        ${sqlNumber(seed.contextUsage)},
        ${sqlInt(seed.compactionCount)},
        ${sqlString(seed.memoryFlushState)},
        ${sqlMaybeString(seed.memoryFlushAt)},
        ${sqlString(seed.updatedAt)}
      );
    `
  );

  const policy = defaultPolicy();
  execSql(
    dbPath,
    `
      INSERT OR IGNORE INTO policy (scope_key, policy_json, version, updated_at)
      VALUES (
        ${sqlString(policy.scopeKey)},
        ${sqlString(
          JSON.stringify({
            toolDefault: policy.toolDefault,
            highRisk: policy.highRisk,
            bashMode: policy.bashMode,
            tools: policy.tools
          })
        )},
        ${sqlInt(policy.version)},
        ${sqlString(policy.updatedAt)}
      );
    `
  );

  initializedDbPaths.add(dbPath);
}

function ensureSessionColumns(dbPath: string): void {
  const columns = queryJson<{ name: string }>(
    dbPath,
    `
      PRAGMA table_info(sessions);
    `
  );
  const names = new Set(columns.map((item) => item.name));

  if (!names.has("title")) {
    execSql(
      dbPath,
      `
        ALTER TABLE sessions
        ADD COLUMN title TEXT NOT NULL DEFAULT ${sqlString(DEFAULT_SESSION_TITLE)};
      `
    );
  }

  if (!names.has("preview")) {
    execSql(
      dbPath,
      `
        ALTER TABLE sessions
        ADD COLUMN preview TEXT NOT NULL DEFAULT ${sqlString(DEFAULT_SESSION_PREVIEW)};
      `
    );
  }

  if (!names.has("context_usage")) {
    execSql(
      dbPath,
      `
        ALTER TABLE sessions
        ADD COLUMN context_usage REAL NOT NULL DEFAULT 0;
      `
    );
  }

  if (!names.has("compaction_count")) {
    execSql(
      dbPath,
      `
        ALTER TABLE sessions
        ADD COLUMN compaction_count INTEGER NOT NULL DEFAULT 0;
      `
    );
  }

  if (!names.has("memory_flush_state")) {
    execSql(
      dbPath,
      `
        ALTER TABLE sessions
        ADD COLUMN memory_flush_state TEXT NOT NULL DEFAULT 'idle';
      `
    );
  }

  if (!names.has("memory_flush_at")) {
    execSql(
      dbPath,
      `
        ALTER TABLE sessions
        ADD COLUMN memory_flush_at TEXT;
      `
    );
  }
}

function ensureRunMetricsColumns(dbPath: string): void {
  const columns = queryJson<{ name: string }>(
    dbPath,
    `
      PRAGMA table_info(run_metrics);
    `
  );
  const names = new Set(columns.map((item) => item.name));

  if (!names.has("tenant_id")) {
    execSql(
      dbPath,
      `
        ALTER TABLE run_metrics
        ADD COLUMN tenant_id TEXT;
      `
    );
  }

  if (!names.has("workspace_id")) {
    execSql(
      dbPath,
      `
        ALTER TABLE run_metrics
        ADD COLUMN workspace_id TEXT;
      `
    );
  }

  if (!names.has("agent_id")) {
    execSql(
      dbPath,
      `
        ALTER TABLE run_metrics
        ADD COLUMN agent_id TEXT;
      `
    );
  }
}

function execSql(dbPath: string, sql: string): void {
  const result = spawnSync("sqlite3", [dbPath, sql], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`sqlite exec failed: ${detail}`);
  }
}

function queryJson<T>(dbPath: string, sql: string): T[] {
  const result = spawnSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`sqlite query failed: ${detail}`);
  }
  const text = (result.stdout ?? "").trim();
  if (text.length === 0) {
    return [];
  }
  return JSON.parse(text) as T[];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlMaybeString(value: string | undefined): string {
  if (!value || value.length === 0) {
    return "NULL";
  }
  return sqlString(value);
}

function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(value);
}

function sqlInt(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(Math.floor(value));
}

function normalizeDbPath(dbPath: string): string {
  if (dbPath === ":memory:") {
    return dbPath;
  }
  return resolve(dbPath);
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseIdempotencyResult(value: string): IdempotencyResult {
  try {
    const parsed = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "response" in parsed &&
      "events" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).events)
    ) {
      return parsed as IdempotencyResult;
    }
  } catch {
    // ignore parse error
  }
  return {
    response: null,
    events: []
  };
}

function normalizeSession(input: SessionRecord): SessionRecord {
  return {
    id: input.id,
    sessionKey: input.sessionKey,
    title: input.title,
    preview: input.preview,
    runtimeMode: input.runtimeMode,
    syncState: input.syncState,
    contextUsage: normalizeUsage((input as { contextUsage?: unknown }).contextUsage),
    compactionCount: normalizeCompactionCount((input as { compactionCount?: unknown }).compactionCount),
    memoryFlushState: normalizeMemoryFlushState((input as { memoryFlushState?: unknown }).memoryFlushState),
    ...(typeof input.memoryFlushAt === "string" && input.memoryFlushAt.length > 0 ? { memoryFlushAt: input.memoryFlushAt } : {}),
    updatedAt: input.updatedAt
  };
}

function normalizeUsage(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return Number(value.toFixed(6));
}

function normalizeCompactionCount(value: unknown): number {
  return normalizeInt(value);
}

function normalizeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const num = Math.floor(value);
  return num < 0 ? 0 : num;
}

function normalizeMemoryFlushState(value: unknown): MemoryFlushState {
  if (value === "pending" || value === "flushed" || value === "skipped") {
    return value;
  }
  return "idle";
}

function normalizePolicy(policy: PolicyRecord): PolicyRecord {
  return {
    scopeKey: policy.scopeKey,
    toolDefault: asPolicyDecision(policy.toolDefault) ?? "deny",
    highRisk: asPolicyDecision(policy.highRisk) ?? "allow",
    bashMode: policy.bashMode === "host" ? "host" : "sandbox",
    tools: sanitizePolicyMap(policy.tools),
    version: Number.isFinite(Number(policy.version)) ? Math.max(1, Math.floor(Number(policy.version))) : 1,
    updatedAt: policy.updatedAt
  };
}

function sanitizePolicyMap(input: unknown): Record<string, PolicyDecision> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const out: Record<string, PolicyDecision> = {};
  for (const [key, value] of Object.entries(input)) {
    const parsed = asPolicyDecision(value);
    if (parsed) {
      out[key] = parsed;
    }
  }
  return out;
}

function asPolicyDecision(value: unknown): PolicyDecision | undefined {
  return value === "deny" || value === "allow" ? value : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

export * from "./p2.js";
