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
  AgentDefinitionRecord,
  AgentRepository,
  AuditLogRecord,
  AuditQuery,
  AuditQueryResult,
  AuditRepository,
  BudgetPolicyPatch,
  BudgetPolicyRecord,
  BudgetRepository,
  BudgetUsageSummary,
  ExecutionTargetRecord,
  ExecutionTargetRepository,
  ModelSecretMetaRecord,
  ModelSecretRecord,
  ModelSecretRepository
} from "./p2.js";

const P2_SCHEMA_KEY = "openfoal-storage-p2-v1";

interface PostgresRepoOptions {
  connectionString?: string;
}

class PostgresP2RepoBase {
  protected readonly connectionString: string;
  protected readonly pool: Pool;

  constructor(options: PostgresRepoOptions = {}) {
    this.connectionString = resolvePostgresUrl(options.connectionString);
    this.pool = getPostgresPool(this.connectionString);
  }

  protected async ready(): Promise<void> {
    await ensurePostgresP2Schema(this.connectionString, this.pool);
  }
}

export class PostgresAgentRepository extends PostgresP2RepoBase implements AgentRepository {
  async list(filter: { tenantId?: string; workspaceId?: string } = {}): Promise<AgentDefinitionRecord[]> {
    await this.ready();
    if (!filter.tenantId) {
      throw new Error("agent.list requires tenantId in postgres mode");
    }
    const tenantId = sanitizeScopeId(filter.tenantId, "t_default");
    const values: unknown[] = [tenantId];
    let index = 2;
    let sql = `
      SELECT
        tenant_id AS "tenantId",
        workspace_id AS "workspaceId",
        agent_id AS "agentId",
        name,
        runtime_mode AS "runtimeMode",
        execution_target_id AS "executionTargetId",
        policy_scope_key AS "policyScopeKey",
        enabled,
        config_json AS config,
        version,
        updated_at AS "updatedAt"
      FROM agent_definitions
      WHERE tenant_id = $1
    `;
    if (filter.workspaceId) {
      sql += ` AND workspace_id = $${index}`;
      values.push(sanitizeScopeId(filter.workspaceId, "w_default"));
      index += 1;
    }
    sql += " ORDER BY updated_at DESC";
    const rows = await this.pool.query(sql, values);
    return rows.rows.map((row: any) => normalizeAgentRow(row));
  }

  async get(tenantId: string, workspaceId: string, agentId: string): Promise<AgentDefinitionRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          tenant_id AS "tenantId",
          workspace_id AS "workspaceId",
          agent_id AS "agentId",
          name,
          runtime_mode AS "runtimeMode",
          execution_target_id AS "executionTargetId",
          policy_scope_key AS "policyScopeKey",
          enabled,
          config_json AS config,
          version,
          updated_at AS "updatedAt"
        FROM agent_definitions
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND agent_id = $3
        LIMIT 1
      `,
      [sanitizeScopeId(tenantId, "t_default"), sanitizeScopeId(workspaceId, "w_default"), sanitizeScopeId(agentId, "a_default")]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeAgentRow(result.rows[0]);
  }

  async upsert(
    input: Omit<AgentDefinitionRecord, "version" | "updatedAt"> & {
      version?: number;
      updatedAt?: string;
    }
  ): Promise<AgentDefinitionRecord> {
    await this.ready();
    const existing = await this.get(input.tenantId, input.workspaceId, input.agentId);
    const next = normalizeAgentRow({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      name: input.name,
      runtimeMode: input.runtimeMode,
      executionTargetId: input.executionTargetId,
      policyScopeKey: input.policyScopeKey,
      enabled: input.enabled,
      config: input.config,
      version: existing ? existing.version + 1 : Math.max(1, Math.floor(input.version ?? 1)),
      updatedAt: input.updatedAt ?? nowIso()
    });

    await this.pool.query(
      `
        INSERT INTO agent_definitions (
          tenant_id,
          workspace_id,
          agent_id,
          name,
          runtime_mode,
          execution_target_id,
          policy_scope_key,
          enabled,
          config_json,
          version,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
        ON CONFLICT(tenant_id, workspace_id, agent_id) DO UPDATE SET
          name = EXCLUDED.name,
          runtime_mode = EXCLUDED.runtime_mode,
          execution_target_id = EXCLUDED.execution_target_id,
          policy_scope_key = EXCLUDED.policy_scope_key,
          enabled = EXCLUDED.enabled,
          config_json = EXCLUDED.config_json,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at
      `,
      [
        next.tenantId,
        next.workspaceId,
        next.agentId,
        next.name,
        next.runtimeMode,
        next.executionTargetId ?? null,
        next.policyScopeKey ?? null,
        next.enabled,
        JSON.stringify(next.config),
        next.version,
        next.updatedAt
      ]
    );
    return next;
  }
}

export class PostgresExecutionTargetRepository extends PostgresP2RepoBase implements ExecutionTargetRepository {
  async list(filter: { tenantId?: string; workspaceId?: string } = {}): Promise<ExecutionTargetRecord[]> {
    await this.ready();
    if (!filter.tenantId) {
      throw new Error("executionTargets.list requires tenantId in postgres mode");
    }
    const tenantId = sanitizeScopeId(filter.tenantId, "t_default");
    const values: unknown[] = [tenantId];
    let index = 2;
    let sql = `
      SELECT
        target_id AS "targetId",
        tenant_id AS "tenantId",
        workspace_id AS "workspaceId",
        kind,
        endpoint,
        auth_token AS "authToken",
        is_default AS "isDefault",
        enabled,
        config_json AS config,
        version,
        updated_at AS "updatedAt"
      FROM execution_targets
      WHERE tenant_id = $1
    `;
    if (filter.workspaceId !== undefined) {
      sql += ` AND COALESCE(workspace_id, '') = $${index}`;
      values.push(sanitizeScopeId(filter.workspaceId, "w_default"));
      index += 1;
    }
    sql += " ORDER BY updated_at DESC";
    const rows = await this.pool.query(sql, values);
    return rows.rows.map((row: any) => normalizeTargetRow(row));
  }

  async get(targetId: string): Promise<ExecutionTargetRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          target_id AS "targetId",
          tenant_id AS "tenantId",
          workspace_id AS "workspaceId",
          kind,
          endpoint,
          auth_token AS "authToken",
          is_default AS "isDefault",
          enabled,
          config_json AS config,
          version,
          updated_at AS "updatedAt"
        FROM execution_targets
        WHERE target_id = $1
        LIMIT 1
      `,
      [sanitizeScopeId(targetId, "")]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeTargetRow(result.rows[0]);
  }

  async findDefault(tenantId: string, workspaceId?: string): Promise<ExecutionTargetRecord | undefined> {
    await this.ready();
    const normalizedTenant = sanitizeScopeId(tenantId, "t_default");
    if (workspaceId) {
      const workspace = sanitizeScopeId(workspaceId, "w_default");
      const workspaceResult = await this.pool.query(
        `
          SELECT target_id AS "targetId"
          FROM execution_targets
          WHERE tenant_id = $1
            AND workspace_id = $2
            AND enabled = true
            AND is_default = true
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [normalizedTenant, workspace]
      );
      if (workspaceResult.rows.length > 0) {
        return await this.get(String(workspaceResult.rows[0].targetId));
      }
    }

    const tenantResult = await this.pool.query(
      `
        SELECT target_id AS "targetId"
        FROM execution_targets
        WHERE tenant_id = $1
          AND workspace_id IS NULL
          AND enabled = true
          AND is_default = true
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [normalizedTenant]
    );
    if (tenantResult.rows.length === 0) {
      return undefined;
    }
    return await this.get(String(tenantResult.rows[0].targetId));
  }

  async upsert(
    input: Omit<ExecutionTargetRecord, "version" | "updatedAt"> & {
      version?: number;
      updatedAt?: string;
    }
  ): Promise<ExecutionTargetRecord> {
    await this.ready();
    const current = await this.get(input.targetId);
    const next = normalizeTargetRow({
      targetId: input.targetId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      endpoint: input.endpoint,
      authToken: input.authToken,
      isDefault: input.isDefault,
      enabled: input.enabled,
      config: input.config,
      version: current ? current.version + 1 : Math.max(1, Math.floor(input.version ?? 1)),
      updatedAt: input.updatedAt ?? nowIso()
    });

    await this.pool.query(
      `
        INSERT INTO execution_targets (
          target_id,
          tenant_id,
          workspace_id,
          kind,
          endpoint,
          auth_token,
          is_default,
          enabled,
          config_json,
          version,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
        ON CONFLICT(target_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          workspace_id = EXCLUDED.workspace_id,
          kind = EXCLUDED.kind,
          endpoint = EXCLUDED.endpoint,
          auth_token = EXCLUDED.auth_token,
          is_default = EXCLUDED.is_default,
          enabled = EXCLUDED.enabled,
          config_json = EXCLUDED.config_json,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at
      `,
      [
        next.targetId,
        next.tenantId,
        next.workspaceId ?? null,
        next.kind,
        next.endpoint ?? null,
        next.authToken ?? null,
        next.isDefault,
        next.enabled,
        JSON.stringify(next.config),
        next.version,
        next.updatedAt
      ]
    );

    if (next.isDefault) {
      await this.pool.query(
        `
          UPDATE execution_targets
          SET is_default = false,
              updated_at = $1
          WHERE tenant_id = $2
            AND COALESCE(workspace_id, '') = COALESCE($3, '')
            AND target_id <> $4
        `,
        [nowIso(), next.tenantId, next.workspaceId ?? null, next.targetId]
      );
    }

    return next;
  }
}

export class PostgresBudgetRepository extends PostgresP2RepoBase implements BudgetRepository {
  async get(scopeKey = defaultBudgetScopeKey()): Promise<BudgetPolicyRecord> {
    await this.ready();
    const normalizedScopeKey = sanitizeScopeId(scopeKey, defaultBudgetScopeKey());
    const result = await this.pool.query(
      `
        SELECT scope_key AS "scopeKey", policy_json AS "policyJson", version, updated_at AS "updatedAt"
        FROM budget_policies
        WHERE scope_key = $1
        LIMIT 1
      `,
      [normalizedScopeKey]
    );
    if (result.rows.length === 0) {
      const created: BudgetPolicyRecord = {
        scopeKey: normalizedScopeKey,
        tokenDailyLimit: null,
        costMonthlyUsdLimit: null,
        hardLimit: true,
        version: 1,
        updatedAt: nowIso()
      };
      await this.pool.query(
        `
          INSERT INTO budget_policies (scope_key, policy_json, version, updated_at)
          VALUES ($1,$2::jsonb,$3,$4)
          ON CONFLICT(scope_key) DO NOTHING
        `,
        [
          created.scopeKey,
          JSON.stringify({
            tokenDailyLimit: created.tokenDailyLimit,
            costMonthlyUsdLimit: created.costMonthlyUsdLimit,
            hardLimit: created.hardLimit
          }),
          created.version,
          created.updatedAt
        ]
      );
      return await this.get(normalizedScopeKey);
    }
    return normalizeBudgetPolicyRow(result.rows[0]);
  }

  async update(patch: BudgetPolicyPatch, scopeKey = defaultBudgetScopeKey()): Promise<BudgetPolicyRecord> {
    await this.ready();
    const current = await this.get(scopeKey);
    const next: BudgetPolicyRecord = {
      scopeKey: current.scopeKey,
      tokenDailyLimit: patch.tokenDailyLimit !== undefined ? normalizeNullableLimit(patch.tokenDailyLimit) : current.tokenDailyLimit,
      costMonthlyUsdLimit:
        patch.costMonthlyUsdLimit !== undefined ? normalizeNullableLimit(patch.costMonthlyUsdLimit) : current.costMonthlyUsdLimit,
      hardLimit: patch.hardLimit !== undefined ? patch.hardLimit : current.hardLimit,
      version: current.version + 1,
      updatedAt: nowIso()
    };

    await this.pool.query(
      `
        INSERT INTO budget_policies (scope_key, policy_json, version, updated_at)
        VALUES ($1,$2::jsonb,$3,$4)
        ON CONFLICT(scope_key) DO UPDATE SET
          policy_json = EXCLUDED.policy_json,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at
      `,
      [
        next.scopeKey,
        JSON.stringify({
          tokenDailyLimit: next.tokenDailyLimit,
          costMonthlyUsdLimit: next.costMonthlyUsdLimit,
          hardLimit: next.hardLimit
        }),
        next.version,
        next.updatedAt
      ]
    );

    return await this.get(next.scopeKey);
  }

  async addUsage(entry: {
    scopeKey: string;
    date?: string;
    tokensUsed?: number;
    costUsd?: number;
    runsRejected?: number;
    updatedAt?: string;
  }): Promise<void> {
    await this.ready();
    const normalizedDate = normalizeDate(entry.date) ?? todayYmd();
    await this.pool.query(
      `
        INSERT INTO budget_usage_daily (
          scope_key,
          date_ymd,
          tokens_used,
          cost_usd,
          runs_rejected,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(scope_key, date_ymd) DO UPDATE SET
          tokens_used = budget_usage_daily.tokens_used + EXCLUDED.tokens_used,
          cost_usd = budget_usage_daily.cost_usd + EXCLUDED.cost_usd,
          runs_rejected = budget_usage_daily.runs_rejected + EXCLUDED.runs_rejected,
          updated_at = EXCLUDED.updated_at
      `,
      [
        sanitizeScopeId(entry.scopeKey, defaultBudgetScopeKey()),
        normalizedDate,
        Math.max(0, parseSafeInt(entry.tokensUsed, 0)),
        Math.max(0, round6(parseSafeNumber(entry.costUsd, 0))),
        Math.max(0, parseSafeInt(entry.runsRejected, 0)),
        entry.updatedAt ?? nowIso()
      ]
    );
  }

  async summary(scopeKey: string, date = todayYmd()): Promise<BudgetUsageSummary> {
    await this.ready();
    const normalizedScopeKey = sanitizeScopeId(scopeKey, defaultBudgetScopeKey());
    const normalizedDate = normalizeDate(date) ?? todayYmd();
    const month = normalizedDate.slice(0, 7);
    const dailyResult = await this.pool.query(
      `
        SELECT
          tokens_used AS "tokensUsed",
          runs_rejected AS "runsRejected"
        FROM budget_usage_daily
        WHERE scope_key = $1
          AND date_ymd = $2
        LIMIT 1
      `,
      [normalizedScopeKey, normalizedDate]
    );
    const monthlyResult = await this.pool.query(
      `
        SELECT COALESCE(SUM(cost_usd), 0) AS "costUsdMonthly"
        FROM budget_usage_daily
        WHERE scope_key = $1
          AND date_ymd LIKE $2
      `,
      [normalizedScopeKey, `${month}%`]
    );
    const daily = dailyResult.rows[0] as Record<string, unknown> | undefined;
    const monthly = monthlyResult.rows[0] as Record<string, unknown> | undefined;
    return {
      scopeKey: normalizedScopeKey,
      date: normalizedDate,
      month,
      tokensUsedDaily: daily ? Math.max(0, parseSafeInt(daily.tokensUsed, 0)) : 0,
      costUsdMonthly: monthly ? Math.max(0, round6(parseSafeNumber(monthly.costUsdMonthly, 0))) : 0,
      runsRejectedDaily: daily ? Math.max(0, parseSafeInt(daily.runsRejected, 0)) : 0
    };
  }
}

export class PostgresAuditRepository extends PostgresP2RepoBase implements AuditRepository {
  async append(entry: {
    tenantId: string;
    workspaceId: string;
    action: string;
    actor: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void> {
    await this.ready();
    await this.pool.query(
      `
        INSERT INTO audit_logs (
          tenant_id,
          workspace_id,
          action,
          actor,
          resource_type,
          resource_id,
          metadata_json,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      `,
      [
        sanitizeScopeId(entry.tenantId, "t_default"),
        sanitizeScopeId(entry.workspaceId, "w_default"),
        entry.action,
        entry.actor,
        entry.resourceType ?? null,
        entry.resourceId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.createdAt ?? nowIso()
      ]
    );
  }

  async query(params: AuditQuery = {}): Promise<AuditQueryResult> {
    await this.ready();
    if (!params.tenantId) {
      throw new Error("audit.query requires tenantId in postgres mode");
    }
    const tenantId = sanitizeScopeId(params.tenantId, "t_default");
    const values: unknown[] = [tenantId];
    let index = 2;
    let sql = `
      SELECT
        id,
        tenant_id AS "tenantId",
        workspace_id AS "workspaceId",
        action,
        actor,
        resource_type AS "resourceType",
        resource_id AS "resourceId",
        metadata_json AS metadata,
        created_at AS "createdAt"
      FROM audit_logs
      WHERE tenant_id = $1
    `;
    if (params.workspaceId) {
      sql += ` AND workspace_id = $${index}`;
      values.push(sanitizeScopeId(params.workspaceId, "w_default"));
      index += 1;
    }
    if (params.action) {
      sql += ` AND action = $${index}`;
      values.push(params.action);
      index += 1;
    }
    if (params.from) {
      sql += ` AND created_at >= $${index}`;
      values.push(params.from);
      index += 1;
    }
    if (params.to) {
      sql += ` AND created_at <= $${index}`;
      values.push(params.to);
      index += 1;
    }
    if (params.cursor && Number.isFinite(params.cursor)) {
      sql += ` AND id < $${index}`;
      values.push(Math.max(1, Math.floor(params.cursor)));
      index += 1;
    }
    const limit = Math.min(500, Math.max(1, Math.floor(params.limit ?? 50)));
    sql += ` ORDER BY id DESC LIMIT $${index}`;
    values.push(limit);

    const result = await this.pool.query(sql, values);
    const items = result.rows.map((row: any) => normalizeAuditRow(row));
    return {
      items,
      ...(items.length === limit ? { nextCursor: items[items.length - 1].id } : {})
    };
  }
}

export class PostgresModelSecretRepository extends PostgresP2RepoBase implements ModelSecretRepository {
  async upsert(input: {
    tenantId: string;
    workspaceId?: string;
    provider: string;
    modelId?: string;
    baseUrl?: string;
    apiKey: string;
    updatedBy?: string;
    updatedAt?: string;
  }): Promise<ModelSecretRecord> {
    await this.ready();
    const normalized = normalizeModelSecretRow({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      modelId: input.modelId,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt ?? nowIso()
    });

    await this.pool.query(
      `
        INSERT INTO model_secrets (
          tenant_id,
          workspace_id,
          provider,
          model_id,
          base_url,
          api_key,
          updated_by,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(tenant_id, workspace_id, provider) DO UPDATE SET
          model_id = EXCLUDED.model_id,
          base_url = EXCLUDED.base_url,
          api_key = EXCLUDED.api_key,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.tenantId,
        normalized.workspaceId ?? null,
        normalized.provider,
        normalized.modelId ?? null,
        normalized.baseUrl ?? null,
        normalized.apiKey,
        normalized.updatedBy,
        normalized.updatedAt
      ]
    );

    return (
      await this.getForRun({
        tenantId: normalized.tenantId,
        workspaceId: normalized.workspaceId,
        provider: normalized.provider
      })
    )!;
  }

  async getForRun(input: {
    tenantId: string;
    workspaceId?: string;
    provider?: string;
  }): Promise<ModelSecretRecord | undefined> {
    await this.ready();
    const tenantId = sanitizeScopeId(input.tenantId, "t_default");
    const workspaceId = input.workspaceId ? sanitizeScopeId(input.workspaceId, "w_default") : undefined;
    const provider = input.provider ? sanitizeProvider(input.provider) : undefined;

    if (provider && workspaceId) {
      const exact = await this.pool.query(
        `
          SELECT
            tenant_id AS "tenantId",
            workspace_id AS "workspaceId",
            provider,
            model_id AS "modelId",
            base_url AS "baseUrl",
            api_key AS "apiKey",
            updated_by AS "updatedBy",
            updated_at AS "updatedAt"
          FROM model_secrets
          WHERE tenant_id = $1
            AND workspace_id = $2
            AND provider = $3
          LIMIT 1
        `,
        [tenantId, workspaceId, provider]
      );
      if (exact.rows.length > 0) {
        return normalizeModelSecretRow(exact.rows[0]);
      }
    }

    if (provider) {
      const tenantDefault = await this.pool.query(
        `
          SELECT
            tenant_id AS "tenantId",
            workspace_id AS "workspaceId",
            provider,
            model_id AS "modelId",
            base_url AS "baseUrl",
            api_key AS "apiKey",
            updated_by AS "updatedBy",
            updated_at AS "updatedAt"
          FROM model_secrets
          WHERE tenant_id = $1
            AND workspace_id IS NULL
            AND provider = $2
          LIMIT 1
        `,
        [tenantId, provider]
      );
      if (tenantDefault.rows.length > 0) {
        return normalizeModelSecretRow(tenantDefault.rows[0]);
      }
      return undefined;
    }

    const ranked = await this.pool.query(
      `
        SELECT
          tenant_id AS "tenantId",
          workspace_id AS "workspaceId",
          provider,
          model_id AS "modelId",
          base_url AS "baseUrl",
          api_key AS "apiKey",
          updated_by AS "updatedBy",
          updated_at AS "updatedAt"
        FROM model_secrets
        WHERE tenant_id = $1
        ORDER BY
          CASE
            WHEN $2::text IS NOT NULL AND workspace_id = $2 THEN 0
            WHEN workspace_id IS NULL THEN 1
            ELSE 2
          END,
          provider ASC,
          updated_at DESC
        LIMIT 1
      `,
      [tenantId, workspaceId ?? null]
    );
    if (ranked.rows.length === 0) {
      return undefined;
    }
    return normalizeModelSecretRow(ranked.rows[0]);
  }

  async listMeta(filter: {
    tenantId: string;
    workspaceId?: string;
    provider?: string;
  }): Promise<ModelSecretMetaRecord[]> {
    await this.ready();
    const values: unknown[] = [sanitizeScopeId(filter.tenantId, "t_default")];
    let index = 2;
    let sql = `
      SELECT
        tenant_id AS "tenantId",
        workspace_id AS "workspaceId",
        provider,
        model_id AS "modelId",
        base_url AS "baseUrl",
        api_key AS "apiKey",
        updated_by AS "updatedBy",
        updated_at AS "updatedAt"
      FROM model_secrets
      WHERE tenant_id = $1
    `;
    if (filter.workspaceId !== undefined) {
      sql += ` AND COALESCE(workspace_id, '') = $${index}`;
      values.push(sanitizeScopeId(filter.workspaceId, "w_default"));
      index += 1;
    }
    if (filter.provider) {
      sql += ` AND provider = $${index}`;
      values.push(sanitizeProvider(filter.provider));
      index += 1;
    }
    sql += " ORDER BY provider ASC";

    const result = await this.pool.query(sql, values);
    return result.rows.map((row: any) => toModelSecretMeta(normalizeModelSecretRow(row)));
  }
}

async function ensurePostgresP2Schema(url: string, pool: Pool): Promise<void> {
  await ensurePostgresSchemaOnce(url, P2_SCHEMA_KEY, async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_definitions (
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        runtime_mode TEXT NOT NULL DEFAULT 'local',
        execution_target_id TEXT,
        policy_scope_key TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, workspace_id, agent_id)
      );

      CREATE TABLE IF NOT EXISTS execution_targets (
        target_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT,
        kind TEXT NOT NULL,
        endpoint TEXT,
        auth_token TEXT,
        is_default BOOLEAN NOT NULL DEFAULT false,
        enabled BOOLEAN NOT NULL DEFAULT true,
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_execution_targets_scope
      ON execution_targets(tenant_id, workspace_id, is_default, enabled);

      CREATE TABLE IF NOT EXISTS budget_policies (
        scope_key TEXT PRIMARY KEY,
        policy_json JSONB NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS budget_usage_daily (
        scope_key TEXT NOT NULL,
        date_ymd TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        runs_rejected INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_key, date_ymd)
      );
      CREATE INDEX IF NOT EXISTS idx_budget_usage_scope_date
      ON budget_usage_daily(scope_key, date_ymd);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        metadata_json JSONB NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_lookup
      ON audit_logs(tenant_id, workspace_id, action, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS model_secrets (
        tenant_id TEXT NOT NULL,
        workspace_id TEXT,
        provider TEXT NOT NULL,
        model_id TEXT,
        base_url TEXT,
        api_key TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, workspace_id, provider)
      );
      CREATE INDEX IF NOT EXISTS idx_model_secrets_lookup
      ON model_secrets(tenant_id, workspace_id, provider, updated_at DESC);
    `);

    const defaultTarget: ExecutionTargetRecord = {
      targetId: "target_local_default",
      tenantId: "t_default",
      workspaceId: "w_default",
      kind: "local-host",
      isDefault: true,
      enabled: true,
      config: {},
      version: 1,
      updatedAt: nowIso()
    };
    await pool.query(
      `
        INSERT INTO execution_targets (
          target_id,
          tenant_id,
          workspace_id,
          kind,
          endpoint,
          auth_token,
          is_default,
          enabled,
          config_json,
          version,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
        ON CONFLICT(target_id) DO NOTHING
      `,
      [
        defaultTarget.targetId,
        defaultTarget.tenantId,
        defaultTarget.workspaceId,
        defaultTarget.kind,
        defaultTarget.endpoint ?? null,
        defaultTarget.authToken ?? null,
        defaultTarget.isDefault,
        defaultTarget.enabled,
        JSON.stringify(defaultTarget.config),
        defaultTarget.version,
        defaultTarget.updatedAt
      ]
    );
  });
}

function normalizeAgentRow(row: Record<string, unknown>): AgentDefinitionRecord {
  return {
    tenantId: sanitizeScopeId(row.tenantId, "t_default"),
    workspaceId: sanitizeScopeId(row.workspaceId, "w_default"),
    agentId: sanitizeScopeId(row.agentId, "a_default"),
    name: sanitizeName(row.name, "default-agent"),
    runtimeMode: row.runtimeMode === "cloud" ? "cloud" : "local",
    ...(typeof row.executionTargetId === "string" && row.executionTargetId.length > 0
      ? { executionTargetId: row.executionTargetId }
      : {}),
    ...(typeof row.policyScopeKey === "string" && row.policyScopeKey.length > 0
      ? { policyScopeKey: row.policyScopeKey }
      : {}),
    enabled: row.enabled !== false,
    config: parseJsonObject(row.config),
    version: Math.max(1, parseSafeInt(row.version, 1)),
    updatedAt: String(row.updatedAt ?? nowIso())
  };
}

function normalizeTargetRow(row: Record<string, unknown>): ExecutionTargetRecord {
  return {
    targetId: sanitizeScopeId(row.targetId, "target_default"),
    tenantId: sanitizeScopeId(row.tenantId, "t_default"),
    ...(typeof row.workspaceId === "string" && row.workspaceId.length > 0 ? { workspaceId: row.workspaceId } : {}),
    kind: row.kind === "docker-runner" ? "docker-runner" : "local-host",
    ...(typeof row.endpoint === "string" && row.endpoint.length > 0 ? { endpoint: row.endpoint } : {}),
    ...(typeof row.authToken === "string" && row.authToken.length > 0 ? { authToken: row.authToken } : {}),
    isDefault: row.isDefault === true || row.isDefault === 1,
    enabled: row.enabled !== false && row.enabled !== 0,
    config: parseJsonObject(row.config),
    version: Math.max(1, parseSafeInt(row.version, 1)),
    updatedAt: String(row.updatedAt ?? nowIso())
  };
}

function normalizeBudgetPolicyRow(row: Record<string, unknown>): BudgetPolicyRecord {
  const parsed = parseJsonObject(row.policyJson);
  return {
    scopeKey: sanitizeScopeId(row.scopeKey, defaultBudgetScopeKey()),
    tokenDailyLimit: normalizeNullableLimit(parsed.tokenDailyLimit),
    costMonthlyUsdLimit: normalizeNullableLimit(parsed.costMonthlyUsdLimit),
    hardLimit: parsed.hardLimit !== false,
    version: Math.max(1, parseSafeInt(row.version, 1)),
    updatedAt: String(row.updatedAt ?? nowIso())
  };
}

function normalizeAuditRow(row: Record<string, unknown>): AuditLogRecord {
  return {
    id: Math.max(1, parseSafeInt(row.id, 1)),
    tenantId: sanitizeScopeId(row.tenantId, "t_default"),
    workspaceId: sanitizeScopeId(row.workspaceId, "w_default"),
    action: String(row.action ?? ""),
    actor: String(row.actor ?? ""),
    ...(typeof row.resourceType === "string" && row.resourceType.length > 0 ? { resourceType: row.resourceType } : {}),
    ...(typeof row.resourceId === "string" && row.resourceId.length > 0 ? { resourceId: row.resourceId } : {}),
    metadata: parseJsonObject(row.metadata),
    createdAt: String(row.createdAt ?? nowIso())
  };
}

function normalizeModelSecretRow(row: Record<string, unknown>): ModelSecretRecord {
  return {
    tenantId: sanitizeScopeId(row.tenantId, "t_default"),
    ...(typeof row.workspaceId === "string" && row.workspaceId.length > 0 ? { workspaceId: sanitizeScopeId(row.workspaceId, "w_default") } : {}),
    provider: sanitizeProvider(row.provider),
    ...(typeof row.modelId === "string" && row.modelId.length > 0 ? { modelId: row.modelId } : {}),
    ...(typeof row.baseUrl === "string" && row.baseUrl.length > 0 ? { baseUrl: row.baseUrl } : {}),
    apiKey: String(row.apiKey ?? ""),
    updatedBy: sanitizeScopeId(row.updatedBy, "system"),
    updatedAt: String(row.updatedAt ?? nowIso())
  };
}

function toModelSecretMeta(record: ModelSecretRecord): ModelSecretMetaRecord {
  return {
    tenantId: record.tenantId,
    ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
    provider: record.provider,
    ...(record.modelId ? { modelId: record.modelId } : {}),
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
    maskedKey: maskSecret(record.apiKey),
    keyLast4: record.apiKey.slice(-4),
    updatedBy: record.updatedBy,
    updatedAt: record.updatedAt
  };
}

function normalizeNullableLimit(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  const parsed = parseSafeNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed <= 0) {
    return 0;
  }
  return round6(parsed);
}

function sanitizeName(value: unknown, fallback: string): string {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return fallback;
  }
  return compact.slice(0, 80);
}

function sanitizeProvider(value: unknown): string {
  return sanitizeScopeId(value, "openai").toLowerCase();
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

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultBudgetScopeKey(): string {
  return "workspace:t_default:w_default";
}
