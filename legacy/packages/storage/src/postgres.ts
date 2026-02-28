import type { Pool } from "pg";
import {
  clampInt,
  ensurePostgresSchemaOnce,
  getPostgresPool,
  nowIso,
  parseJsonObject,
  parseSafeInt,
  parseSafeNumber,
  resolvePostgresUrl,
  round6,
  sanitizeScopeId
} from "./postgres-shared.js";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyResult,
  MemoryFlushState,
  MetricsRepository,
  MetricsRunRecord,
  MetricsScopeFilter,
  MetricsSummary,
  PolicyDecision,
  PolicyPatch,
  PolicyRecord,
  PolicyRepository,
  RuntimeMode,
  SessionMetaPatch,
  SessionRecord,
  SessionRepository,
  SessionScope,
  SessionVisibility,
  SyncState,
  TranscriptRecord,
  TranscriptRepository
} from "./index.js";

const CORE_SCHEMA_KEY = "openfoal-storage-core-v1";

interface PostgresRepoOptions {
  connectionString?: string;
}

class PostgresRepoBase {
  protected readonly connectionString: string;
  protected readonly pool: Pool;

  constructor(options: PostgresRepoOptions = {}) {
    this.connectionString = resolvePostgresUrl(options.connectionString);
    this.pool = getPostgresPool(this.connectionString);
  }

  protected async ready(): Promise<void> {
    await ensurePostgresCoreSchema(this.connectionString, this.pool);
  }
}

export class PostgresSessionRepository extends PostgresRepoBase implements SessionRepository {
  async list(scope?: SessionScope): Promise<SessionRecord[]> {
    await this.ready();
    const normalized = normalizeRequiredScope(scope);
    const values: unknown[] = [normalized.tenantId];
    let index = values.length + 1;
    let sql = `
      SELECT
        id,
        session_key AS "sessionKey",
        tenant_id AS "tenantId",
        workspace_id AS "workspaceId",
        owner_user_id AS "ownerUserId",
        visibility,
        title,
        preview,
        runtime_mode AS "runtimeMode",
        sync_state AS "syncState",
        context_usage AS "contextUsage",
        compaction_count AS "compactionCount",
        memory_flush_state AS "memoryFlushState",
        memory_flush_at AS "memoryFlushAt",
        updated_at AS "updatedAt"
      FROM sessions
      WHERE tenant_id = $1
    `;
    if (normalized.workspaceId) {
      sql += ` AND workspace_id = $${index}`;
      values.push(normalized.workspaceId);
      index += 1;
    }
    if (normalized.ownerUserId) {
      sql += ` AND owner_user_id = $${index}`;
      values.push(normalized.ownerUserId);
      index += 1;
    }
    sql += " ORDER BY updated_at DESC";
    const rows = await this.pool.query(sql, values);
    return rows.rows.map((row: any) => normalizeSessionRow(row));
  }

  async get(sessionId: string, scope?: SessionScope): Promise<SessionRecord | undefined> {
    await this.ready();
    const normalized = normalizeRequiredScope(scope);
    const values: unknown[] = [sessionId, normalized.tenantId];
    let index = values.length + 1;
    let sql = `
      SELECT
        id,
        session_key AS "sessionKey",
        tenant_id AS "tenantId",
        workspace_id AS "workspaceId",
        owner_user_id AS "ownerUserId",
        visibility,
        title,
        preview,
        runtime_mode AS "runtimeMode",
        sync_state AS "syncState",
        context_usage AS "contextUsage",
        compaction_count AS "compactionCount",
        memory_flush_state AS "memoryFlushState",
        memory_flush_at AS "memoryFlushAt",
        updated_at AS "updatedAt"
      FROM sessions
      WHERE id = $1
        AND tenant_id = $2
    `;
    if (normalized.workspaceId) {
      sql += ` AND workspace_id = $${index}`;
      values.push(normalized.workspaceId);
      index += 1;
    }
    if (normalized.ownerUserId) {
      sql += ` AND owner_user_id = $${index}`;
      values.push(normalized.ownerUserId);
      index += 1;
    }
    sql += " LIMIT 1";

    const result = await this.pool.query(sql, values);
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeSessionRow(result.rows[0]);
  }

  async upsert(session: SessionRecord): Promise<void> {
    await this.ready();
    const normalized = normalizeSession(session);
    await this.pool.query(
      `
        INSERT INTO sessions (
          id,
          session_key,
          tenant_id,
          workspace_id,
          owner_user_id,
          visibility,
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
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        )
        ON CONFLICT(id) DO UPDATE SET
          session_key = EXCLUDED.session_key,
          tenant_id = EXCLUDED.tenant_id,
          workspace_id = EXCLUDED.workspace_id,
          owner_user_id = EXCLUDED.owner_user_id,
          visibility = EXCLUDED.visibility,
          title = EXCLUDED.title,
          preview = EXCLUDED.preview,
          runtime_mode = EXCLUDED.runtime_mode,
          sync_state = EXCLUDED.sync_state,
          context_usage = EXCLUDED.context_usage,
          compaction_count = EXCLUDED.compaction_count,
          memory_flush_state = EXCLUDED.memory_flush_state,
          memory_flush_at = EXCLUDED.memory_flush_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.id,
        normalized.sessionKey,
        normalized.tenantId,
        normalized.workspaceId,
        normalized.ownerUserId,
        normalized.visibility,
        normalized.title,
        normalized.preview,
        normalized.runtimeMode,
        normalized.syncState,
        normalized.contextUsage,
        normalized.compactionCount,
        normalized.memoryFlushState,
        normalized.memoryFlushAt ?? null,
        nowIso()
      ]
    );
  }

  async setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode, scope?: SessionScope): Promise<SessionRecord | undefined> {
    await this.ready();
    const current = await this.get(sessionId, scope);
    if (!current) {
      return undefined;
    }
    await this.pool.query(
      `
        UPDATE sessions
        SET runtime_mode = $1,
            updated_at = $2
        WHERE id = $3
          AND tenant_id = $4
      `,
      [runtimeMode, nowIso(), sessionId, current.tenantId]
    );
    return await this.get(sessionId, {
      tenantId: current.tenantId,
      workspaceId: current.workspaceId,
      ownerUserId: current.ownerUserId
    });
  }

  async updateMeta(sessionId: string, patch: SessionMetaPatch, scope?: SessionScope): Promise<SessionRecord | undefined> {
    await this.ready();
    const current = await this.get(sessionId, scope);
    if (!current) {
      return undefined;
    }
    const nextContextUsage = patch.contextUsage !== undefined ? normalizeUsage(patch.contextUsage) : current.contextUsage;
    const nextCompaction = patch.compactionCount !== undefined ? normalizeCompactionCount(patch.compactionCount) : current.compactionCount;
    const nextFlushState = patch.memoryFlushState ?? current.memoryFlushState;
    const nextFlushAt = patch.memoryFlushAt !== undefined ? patch.memoryFlushAt : current.memoryFlushAt;
    await this.pool.query(
      `
        UPDATE sessions
        SET context_usage = $1,
            compaction_count = $2,
            memory_flush_state = $3,
            memory_flush_at = $4,
            updated_at = $5
        WHERE id = $6
          AND tenant_id = $7
      `,
      [nextContextUsage, nextCompaction, nextFlushState, nextFlushAt ?? null, nowIso(), sessionId, current.tenantId]
    );
    return await this.get(sessionId, {
      tenantId: current.tenantId,
      workspaceId: current.workspaceId,
      ownerUserId: current.ownerUserId
    });
  }
}

export class PostgresTranscriptRepository extends PostgresRepoBase implements TranscriptRepository {
  async append(entry: {
    sessionId: string;
    tenantId?: string;
    workspaceId?: string;
    ownerUserId?: string;
    runId?: string;
    event: string;
    payload: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    await this.ready();
    const tenantId = sanitizeScopeId(entry.tenantId, "t_default");
    const workspaceId = sanitizeScopeId(entry.workspaceId, "w_default");
    const ownerUserId = sanitizeScopeId(entry.ownerUserId, "u_legacy");
    await this.pool.query(
      `
        INSERT INTO transcript (
          session_id,
          tenant_id,
          workspace_id,
          owner_user_id,
          run_id,
          event,
          payload_json,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      `,
      [
        entry.sessionId,
        tenantId,
        workspaceId,
        ownerUserId,
        entry.runId ?? null,
        entry.event,
        JSON.stringify(entry.payload ?? {}),
        entry.createdAt ?? nowIso()
      ]
    );
  }

  async list(sessionId: string, scopeOrLimit?: SessionScope | number, limit?: number, beforeId?: number): Promise<TranscriptRecord[]> {
    await this.ready();
    const resolved = resolveTranscriptArgs(scopeOrLimit, limit, beforeId);
    const values: unknown[] = [sessionId, resolved.scope.tenantId];
    let index = values.length + 1;
    let sql = `
      SELECT
        id,
        session_id AS "sessionId",
        tenant_id AS "tenantId",
        workspace_id AS "workspaceId",
        owner_user_id AS "ownerUserId",
        run_id AS "runId",
        event,
        payload_json AS payload,
        created_at AS "createdAt"
      FROM transcript
      WHERE session_id = $1
        AND tenant_id = $2
    `;
    if (resolved.scope.workspaceId) {
      sql += ` AND workspace_id = $${index}`;
      values.push(resolved.scope.workspaceId);
      index += 1;
    }
    if (resolved.scope.ownerUserId) {
      sql += ` AND owner_user_id = $${index}`;
      values.push(resolved.scope.ownerUserId);
      index += 1;
    }
    if (resolved.beforeId) {
      sql += ` AND id < $${index}`;
      values.push(resolved.beforeId);
      index += 1;
    }
    sql += ` ORDER BY id DESC LIMIT $${index}`;
    values.push(resolved.limit);
    const rows = await this.pool.query(sql, values);
    const reversed = [...rows.rows].reverse();
    return reversed.map((row) => ({
      id: parseSafeInt(row.id, 0),
      sessionId: String(row.sessionId ?? ""),
      tenantId: sanitizeScopeId(row.tenantId, "t_default"),
      workspaceId: sanitizeScopeId(row.workspaceId, "w_default"),
      ownerUserId: sanitizeScopeId(row.ownerUserId, "u_legacy"),
      storageBackend: "postgres",
      runId: typeof row.runId === "string" && row.runId.length > 0 ? row.runId : undefined,
      event: String(row.event ?? ""),
      payload: parseJsonObject(row.payload),
      createdAt: String(row.createdAt ?? nowIso())
    }));
  }
}

export class PostgresIdempotencyRepository extends PostgresRepoBase implements IdempotencyRepository {
  async get(cacheKey: string): Promise<IdempotencyRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT fingerprint, result_json AS "resultJson", created_at AS "createdAt"
        FROM idempotency
        WHERE cache_key = $1
        LIMIT 1
      `,
      [cacheKey]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    const row = result.rows[0] as Record<string, unknown>;
    return {
      fingerprint: String(row.fingerprint ?? ""),
      result: parseIdempotencyResult(row.resultJson),
      createdAt: String(row.createdAt ?? nowIso())
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
    await this.ready();
    await this.pool.query(
      `
        INSERT INTO idempotency (cache_key, fingerprint, result_json, created_at)
        VALUES ($1,$2,$3::jsonb,$4)
        ON CONFLICT(cache_key) DO UPDATE SET
          fingerprint = EXCLUDED.fingerprint,
          result_json = EXCLUDED.result_json,
          created_at = EXCLUDED.created_at
      `,
      [cacheKey, value.fingerprint, JSON.stringify(value.result ?? { response: null, events: [] }), value.createdAt ?? nowIso()]
    );
  }
}

export class PostgresPolicyRepository extends PostgresRepoBase implements PolicyRepository {
  async get(scope?: { tenantId: string; workspaceId: string; scopeKey?: string } | string): Promise<PolicyRecord> {
    await this.ready();
    const resolved = resolvePolicyScope(scope);
    const result = await this.pool.query(
      `
        SELECT
          tenant_id AS "tenantId",
          workspace_id AS "workspaceId",
          scope_key AS "scopeKey",
          policy_json AS "policyJson",
          version,
          updated_at AS "updatedAt"
        FROM policy
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND scope_key = $3
        LIMIT 1
      `,
      [resolved.tenantId, resolved.workspaceId, resolved.scopeKey]
    );

    if (result.rows.length === 0) {
      const created = defaultPolicy(resolved.tenantId, resolved.workspaceId, resolved.scopeKey);
      await this.pool.query(
        `
          INSERT INTO policy (
            tenant_id,
            workspace_id,
            scope_key,
            policy_json,
            version,
            updated_at
          )
          VALUES ($1,$2,$3,$4::jsonb,$5,$6)
          ON CONFLICT(tenant_id, workspace_id, scope_key) DO NOTHING
        `,
        [
          created.tenantId,
          created.workspaceId,
          created.scopeKey,
          JSON.stringify({
            toolDefault: created.toolDefault,
            highRisk: created.highRisk,
            bashMode: created.bashMode,
            tools: created.tools
          }),
          created.version,
          created.updatedAt
        ]
      );
      const seeded = await this.pool.query(
        `
          SELECT
            tenant_id AS "tenantId",
            workspace_id AS "workspaceId",
            scope_key AS "scopeKey",
            policy_json AS "policyJson",
            version,
            updated_at AS "updatedAt"
          FROM policy
          WHERE tenant_id = $1
            AND workspace_id = $2
            AND scope_key = $3
          LIMIT 1
        `,
        [resolved.tenantId, resolved.workspaceId, resolved.scopeKey]
      );
      if (seeded.rows.length === 0) {
        return {
          ...created,
          storageBackend: "postgres"
        };
      }
      return normalizePolicyRow(seeded.rows[0]);
    }

    return normalizePolicyRow(result.rows[0]);
  }

  async update(
    patch: PolicyPatch,
    scope?:
      | {
        tenantId: string;
        workspaceId: string;
        scopeKey?: string;
      }
      | string
  ): Promise<PolicyRecord> {
    await this.ready();
    const resolved = resolvePolicyScope(scope);
    const current = await this.get(resolved);
    const merged: PolicyRecord = {
      tenantId: current.tenantId,
      workspaceId: current.workspaceId,
      scopeKey: current.scopeKey,
      toolDefault: patch.toolDefault ?? current.toolDefault,
      highRisk: patch.highRisk ?? current.highRisk,
      bashMode: patch.bashMode ?? current.bashMode,
      tools: {
        ...current.tools,
        ...(patch.tools ? sanitizePolicyMap(patch.tools) : {})
      },
      version: current.version + 1,
      updatedAt: nowIso()
    };

    await this.pool.query(
      `
        INSERT INTO policy (
          tenant_id,
          workspace_id,
          scope_key,
          policy_json,
          version,
          updated_at
        )
        VALUES ($1,$2,$3,$4::jsonb,$5,$6)
        ON CONFLICT(tenant_id, workspace_id, scope_key) DO UPDATE SET
          policy_json = EXCLUDED.policy_json,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at
      `,
      [
        merged.tenantId,
        merged.workspaceId,
        merged.scopeKey,
        JSON.stringify({
          toolDefault: merged.toolDefault,
          highRisk: merged.highRisk,
          bashMode: merged.bashMode,
          tools: merged.tools
        }),
        merged.version,
        merged.updatedAt
      ]
    );

    return await this.get(resolved);
  }
}

export class PostgresMetricsRepository extends PostgresRepoBase implements MetricsRepository {
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
    await this.ready();
    await this.pool.query(
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        entry.sessionId,
        entry.runId ?? null,
        entry.tenantId ?? null,
        entry.workspaceId ?? null,
        entry.agentId ?? null,
        entry.status,
        clampInt(parseSafeInt(entry.durationMs, 0), 0, 2_147_483_647),
        clampInt(parseSafeInt(entry.toolCalls, 0), 0, 2_147_483_647),
        clampInt(parseSafeInt(entry.toolFailures, 0), 0, 2_147_483_647),
        entry.createdAt ?? nowIso()
      ]
    );
  }

  async summary(scope: MetricsScopeFilter = {}): Promise<MetricsSummary> {
    await this.ready();
    if (!scope.tenantId) {
      throw new Error("metrics.summary requires tenantId scope in postgres mode");
    }
    const values: unknown[] = [scope.tenantId];
    let index = values.length + 1;
    let sql = `
      SELECT
        id,
        session_id AS "sessionId",
        run_id AS "runId",
        tenant_id AS "tenantId",
        workspace_id AS "workspaceId",
        agent_id AS "agentId",
        status,
        duration_ms AS "durationMs",
        tool_calls AS "toolCalls",
        tool_failures AS "toolFailures",
        created_at AS "createdAt"
      FROM run_metrics
      WHERE tenant_id = $1
    `;
    if (scope.workspaceId) {
      sql += ` AND workspace_id = $${index}`;
      values.push(scope.workspaceId);
      index += 1;
    }
    if (scope.agentId) {
      sql += ` AND agent_id = $${index}`;
      values.push(scope.agentId);
      index += 1;
    }
    sql += " ORDER BY id ASC";
    const rows = await this.pool.query(sql, values);
    return summarizeMetrics(
      rows.rows.map((row: any) => ({
        status: String(row.status ?? "completed"),
        durationMs: parseSafeInt(row.durationMs, 0),
        toolCalls: parseSafeInt(row.toolCalls, 0),
        toolFailures: parseSafeInt(row.toolFailures, 0)
      }))
    );
  }
}

async function ensurePostgresCoreSchema(url: string, pool: Pool): Promise<void> {
  await ensurePostgresSchemaOnce(url, CORE_SCHEMA_KEY, async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        visibility TEXT NOT NULL,
        title TEXT NOT NULL,
        preview TEXT NOT NULL,
        runtime_mode TEXT NOT NULL,
        sync_state TEXT NOT NULL,
        context_usage DOUBLE PRECISION NOT NULL,
        compaction_count INTEGER NOT NULL,
        memory_flush_state TEXT NOT NULL,
        memory_flush_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_scope_updated_at
      ON sessions(tenant_id, workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_owner_updated_at
      ON sessions(tenant_id, owner_user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_tenant_session_id
      ON sessions(tenant_id, id);

      CREATE TABLE IF NOT EXISTS transcript (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        run_id TEXT,
        event TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transcript_tenant_session_id
      ON transcript(tenant_id, session_id, id DESC);

      CREATE TABLE IF NOT EXISTS idempotency (
        cache_key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        result_json JSONB NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS policy (
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        policy_json JSONB NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, workspace_id, scope_key)
      );

      CREATE TABLE IF NOT EXISTS run_metrics (
        id BIGSERIAL PRIMARY KEY,
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
    `);

    const seedSession = defaultSession();
    await pool.query(
      `
        INSERT INTO sessions (
          id,
          session_key,
          tenant_id,
          workspace_id,
          owner_user_id,
          visibility,
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(id) DO NOTHING
      `,
      [
        seedSession.id,
        seedSession.sessionKey,
        seedSession.tenantId,
        seedSession.workspaceId,
        seedSession.ownerUserId,
        seedSession.visibility,
        seedSession.title,
        seedSession.preview,
        seedSession.runtimeMode,
        seedSession.syncState,
        seedSession.contextUsage,
        seedSession.compactionCount,
        seedSession.memoryFlushState,
        seedSession.memoryFlushAt ?? null,
        seedSession.updatedAt
      ]
    );

    const seedPolicy = defaultPolicy("t_default", "w_default", "default");
    await pool.query(
      `
        INSERT INTO policy (tenant_id, workspace_id, scope_key, policy_json, version, updated_at)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6)
        ON CONFLICT(tenant_id, workspace_id, scope_key) DO NOTHING
      `,
      [
        seedPolicy.tenantId,
        seedPolicy.workspaceId,
        seedPolicy.scopeKey,
        JSON.stringify({
          toolDefault: seedPolicy.toolDefault,
          highRisk: seedPolicy.highRisk,
          bashMode: seedPolicy.bashMode,
          tools: seedPolicy.tools
        }),
        seedPolicy.version,
        seedPolicy.updatedAt
      ]
    );
  });
}

function normalizeRequiredScope(scope?: SessionScope): SessionScope {
  if (!scope?.tenantId) {
    throw new Error("tenant scope is required in postgres mode");
  }
  return {
    tenantId: sanitizeScopeId(scope.tenantId, "t_default"),
    ...(scope.workspaceId ? { workspaceId: sanitizeScopeId(scope.workspaceId, "w_default") } : {}),
    ...(scope.ownerUserId ? { ownerUserId: sanitizeScopeId(scope.ownerUserId, "u_legacy") } : {})
  };
}

function resolveTranscriptArgs(
  scopeOrLimit?: SessionScope | number,
  limit?: number,
  beforeId?: number
): { scope: SessionScope; limit: number; beforeId?: number } {
  let scope: SessionScope | undefined;
  let resolvedLimit = limit;
  let resolvedBeforeId = beforeId;
  if (typeof scopeOrLimit === "number") {
    resolvedLimit = scopeOrLimit;
    resolvedBeforeId = typeof limit === "number" ? limit : undefined;
  } else {
    scope = scopeOrLimit;
  }
  const normalized = normalizeRequiredScope(scope);
  return {
    scope: normalized,
    limit: clampInt(parseSafeInt(resolvedLimit, 50), 1, 500),
    ...(typeof resolvedBeforeId === "number" && Number.isFinite(resolvedBeforeId)
      ? { beforeId: Math.max(1, Math.floor(resolvedBeforeId)) }
      : {})
  };
}

function normalizeSession(input: SessionRecord): SessionRecord {
  return {
    id: input.id,
    sessionKey: input.sessionKey,
    tenantId: sanitizeScopeId(input.tenantId, "t_default"),
    workspaceId: sanitizeScopeId(input.workspaceId, "w_default"),
    ownerUserId: sanitizeScopeId(input.ownerUserId, "u_legacy"),
    storageBackend: "postgres",
    visibility: normalizeVisibility(input.visibility),
    title: input.title,
    preview: input.preview,
    runtimeMode: input.runtimeMode === "cloud" ? "cloud" : "local",
    syncState: normalizeSyncState(input.syncState),
    contextUsage: normalizeUsage(input.contextUsage),
    compactionCount: normalizeCompactionCount(input.compactionCount),
    memoryFlushState: normalizeMemoryFlushState(input.memoryFlushState),
    ...(input.memoryFlushAt ? { memoryFlushAt: input.memoryFlushAt } : {}),
    updatedAt: input.updatedAt
  };
}

function normalizeSessionRow(row: Record<string, unknown>): SessionRecord {
  return normalizeSession({
    id: String(row.id ?? ""),
    sessionKey: String(row.sessionKey ?? ""),
    tenantId: String(row.tenantId ?? "t_default"),
    workspaceId: String(row.workspaceId ?? "w_default"),
    ownerUserId: String(row.ownerUserId ?? "u_legacy"),
    visibility: normalizeVisibility(row.visibility),
    title: String(row.title ?? "new-session"),
    preview: String(row.preview ?? ""),
    runtimeMode: row.runtimeMode === "cloud" ? "cloud" : "local",
    syncState: normalizeSyncState(row.syncState),
    contextUsage: parseSafeNumber(row.contextUsage, 0),
    compactionCount: parseSafeInt(row.compactionCount, 0),
    memoryFlushState: normalizeMemoryFlushState(row.memoryFlushState),
    ...(typeof row.memoryFlushAt === "string" && row.memoryFlushAt.length > 0 ? { memoryFlushAt: row.memoryFlushAt } : {}),
    updatedAt: String(row.updatedAt ?? nowIso())
  });
}

function normalizeMemoryFlushState(value: unknown): MemoryFlushState {
  if (value === "pending" || value === "flushed" || value === "skipped") {
    return value;
  }
  return "idle";
}

function normalizeVisibility(value: unknown): SessionVisibility {
  return value === "private" ? "private" : "workspace";
}

function normalizeSyncState(value: unknown): SyncState {
  if (value === "syncing" || value === "synced" || value === "conflict") {
    return value;
  }
  return "local_only";
}

function normalizeUsage(value: unknown): number {
  const parsed = parseSafeNumber(value, 0);
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 1) {
    return 1;
  }
  return round6(parsed);
}

function normalizeCompactionCount(value: unknown): number {
  return Math.max(0, parseSafeInt(value, 0));
}

function resolvePolicyScope(
  scope?: { tenantId: string; workspaceId: string; scopeKey?: string } | string
): { tenantId: string; workspaceId: string; scopeKey: string } {
  if (typeof scope === "string") {
    return {
      tenantId: "t_default",
      workspaceId: "w_default",
      scopeKey: sanitizeScopeId(scope, "default")
    };
  }
  if (!scope?.tenantId || !scope.workspaceId) {
    throw new Error("policy scope requires tenantId and workspaceId in postgres mode");
  }
  return {
    tenantId: sanitizeScopeId(scope.tenantId, "t_default"),
    workspaceId: sanitizeScopeId(scope.workspaceId, "w_default"),
    scopeKey: sanitizeScopeId(scope.scopeKey, "default")
  };
}

function normalizePolicyRow(row: Record<string, unknown>): PolicyRecord {
  const parsed = parseJsonObject(row.policyJson);
  return {
    tenantId: sanitizeScopeId(row.tenantId, "t_default"),
    workspaceId: sanitizeScopeId(row.workspaceId, "w_default"),
    scopeKey: sanitizeScopeId(row.scopeKey, "default"),
    storageBackend: "postgres",
    toolDefault: asPolicyDecision(parsed.toolDefault) ?? "deny",
    highRisk: asPolicyDecision(parsed.highRisk) ?? "allow",
    bashMode: parsed.bashMode === "host" ? "host" : "sandbox",
    tools: sanitizePolicyMap(parsed.tools),
    version: Math.max(1, parseSafeInt(row.version, 1)),
    updatedAt: String(row.updatedAt ?? nowIso())
  };
}

function asPolicyDecision(value: unknown): PolicyDecision | undefined {
  return value === "allow" || value === "deny" ? value : undefined;
}

function sanitizePolicyMap(value: unknown): Record<string, PolicyDecision> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, PolicyDecision> = {};
  for (const [key, decision] of Object.entries(value)) {
    const parsed = asPolicyDecision(decision);
    if (parsed) {
      out[key] = parsed;
    }
  }
  return out;
}

function defaultSession(): SessionRecord {
  return {
    id: "s_default",
    sessionKey: "workspace:w_default/agent:a_default/main",
    tenantId: "t_default",
    workspaceId: "w_default",
    ownerUserId: "u_legacy",
    visibility: "workspace",
    title: "new-session",
    preview: "",
    runtimeMode: "local",
    syncState: "local_only",
    contextUsage: 0,
    compactionCount: 0,
    memoryFlushState: "idle",
    updatedAt: nowIso()
  };
}

function defaultPolicy(tenantId: string, workspaceId: string, scopeKey: string): PolicyRecord {
  return {
    tenantId,
    workspaceId,
    scopeKey,
    toolDefault: "deny",
    highRisk: "allow",
    bashMode: "sandbox",
    tools: {
      "math.add": "allow",
      "text.upper": "allow",
      echo: "allow",
      "file.read": "allow",
      "file.list": "allow",
      "memory.get": "allow",
      "memory.search": "allow"
    },
    version: 1,
    updatedAt: nowIso()
  };
}

function parseIdempotencyResult(value: unknown): IdempotencyResult {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.events) && "response" in record) {
      return {
        response: record.response,
        events: record.events
      };
    }
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseIdempotencyResult(parsed);
    } catch {
      return {
        response: null,
        events: []
      };
    }
  }
  return {
    response: null,
    events: []
  };
}

function summarizeMetrics(rows: Array<{ status: string; durationMs: number; toolCalls: number; toolFailures: number }>): MetricsSummary {
  const runsTotal = rows.length;
  const runsFailed = rows.filter((row) => row.status === "failed").length;
  const toolCallsTotal = rows.reduce((sum, row) => sum + Math.max(0, parseSafeInt(row.toolCalls, 0)), 0);
  const toolFailures = rows.reduce((sum, row) => sum + Math.max(0, parseSafeInt(row.toolFailures, 0)), 0);
  const sortedDurations = rows.map((row) => Math.max(0, parseSafeInt(row.durationMs, 0))).sort((a, b) => a - b);
  const p95LatencyMs = sortedDurations.length === 0 ? 0 : sortedDurations[Math.max(0, Math.ceil(sortedDurations.length * 0.95) - 1)] ?? 0;
  return {
    runsTotal,
    runsFailed,
    toolCallsTotal,
    toolFailures,
    p95LatencyMs
  };
}
