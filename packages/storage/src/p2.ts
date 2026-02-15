// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { spawnSync } from "node:child_process";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { mkdirSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, resolve } from "node:path";

declare const process: any;

export type AgentRuntimeMode = "local" | "cloud";
export type ExecutionTargetKind = "local-host" | "docker-runner";

export interface AgentDefinitionRecord {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  name: string;
  runtimeMode: AgentRuntimeMode;
  executionTargetId?: string;
  policyScopeKey?: string;
  enabled: boolean;
  config: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface AgentRepository {
  list(filter?: { tenantId?: string; workspaceId?: string }): Promise<AgentDefinitionRecord[]>;
  get(tenantId: string, workspaceId: string, agentId: string): Promise<AgentDefinitionRecord | undefined>;
  upsert(
    input: Omit<AgentDefinitionRecord, "version" | "updatedAt"> & {
      version?: number;
      updatedAt?: string;
    }
  ): Promise<AgentDefinitionRecord>;
}

export interface ExecutionTargetRecord {
  targetId: string;
  tenantId: string;
  workspaceId?: string;
  kind: ExecutionTargetKind;
  endpoint?: string;
  authToken?: string;
  isDefault: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface ExecutionTargetRepository {
  list(filter?: { tenantId?: string; workspaceId?: string }): Promise<ExecutionTargetRecord[]>;
  get(targetId: string): Promise<ExecutionTargetRecord | undefined>;
  findDefault(tenantId: string, workspaceId?: string): Promise<ExecutionTargetRecord | undefined>;
  upsert(
    input: Omit<ExecutionTargetRecord, "version" | "updatedAt"> & {
      version?: number;
      updatedAt?: string;
    }
  ): Promise<ExecutionTargetRecord>;
}

export interface BudgetPolicyRecord {
  scopeKey: string;
  tokenDailyLimit: number | null;
  costMonthlyUsdLimit: number | null;
  hardLimit: boolean;
  version: number;
  updatedAt: string;
}

export interface BudgetPolicyPatch {
  tokenDailyLimit?: number | null;
  costMonthlyUsdLimit?: number | null;
  hardLimit?: boolean;
}

export interface BudgetUsageSummary {
  scopeKey: string;
  date: string;
  month: string;
  tokensUsedDaily: number;
  costUsdMonthly: number;
  runsRejectedDaily: number;
}

export interface BudgetRepository {
  get(scopeKey?: string): Promise<BudgetPolicyRecord>;
  update(patch: BudgetPolicyPatch, scopeKey?: string): Promise<BudgetPolicyRecord>;
  addUsage(entry: {
    scopeKey: string;
    date?: string;
    tokensUsed?: number;
    costUsd?: number;
    runsRejected?: number;
    updatedAt?: string;
  }): Promise<void>;
  summary(scopeKey: string, date?: string): Promise<BudgetUsageSummary>;
}

export interface AuditLogRecord {
  id: number;
  tenantId: string;
  workspaceId: string;
  action: string;
  actor: string;
  resourceType?: string;
  resourceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditQuery {
  tenantId?: string;
  workspaceId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: number;
}

export interface AuditQueryResult {
  items: AuditLogRecord[];
  nextCursor?: number;
}

export interface AuditRepository {
  append(entry: {
    tenantId: string;
    workspaceId: string;
    action: string;
    actor: string;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }): Promise<void>;
  query(params?: AuditQuery): Promise<AuditQueryResult>;
}

export interface ModelSecretRecord {
  tenantId: string;
  workspaceId?: string;
  provider: string;
  modelId?: string;
  baseUrl?: string;
  apiKey: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ModelSecretMetaRecord {
  tenantId: string;
  workspaceId?: string;
  provider: string;
  modelId?: string;
  baseUrl?: string;
  maskedKey: string;
  keyLast4: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ModelSecretRepository {
  upsert(input: {
    tenantId: string;
    workspaceId?: string;
    provider: string;
    modelId?: string;
    baseUrl?: string;
    apiKey: string;
    updatedBy?: string;
    updatedAt?: string;
  }): Promise<ModelSecretRecord>;
  getForRun(input: {
    tenantId: string;
    workspaceId?: string;
    provider?: string;
  }): Promise<ModelSecretRecord | undefined>;
  listMeta(filter: {
    tenantId: string;
    workspaceId?: string;
    provider?: string;
  }): Promise<ModelSecretMetaRecord[]>;
}

export class InMemoryAgentRepository implements AgentRepository {
  private readonly items = new Map<string, AgentDefinitionRecord>();

  async list(filter: { tenantId?: string; workspaceId?: string } = {}): Promise<AgentDefinitionRecord[]> {
    return Array.from(this.items.values())
      .filter((item) => (filter.tenantId ? item.tenantId === filter.tenantId : true))
      .filter((item) => (filter.workspaceId ? item.workspaceId === filter.workspaceId : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(cloneAgent);
  }

  async get(tenantId: string, workspaceId: string, agentId: string): Promise<AgentDefinitionRecord | undefined> {
    const value = this.items.get(agentKey(tenantId, workspaceId, agentId));
    return value ? cloneAgent(value) : undefined;
  }

  async upsert(
    input: Omit<AgentDefinitionRecord, "version" | "updatedAt"> & {
      version?: number;
      updatedAt?: string;
    }
  ): Promise<AgentDefinitionRecord> {
    const key = agentKey(input.tenantId, input.workspaceId, input.agentId);
    const current = this.items.get(key);
    const next = normalizeAgent({
      ...input,
      version: current ? current.version + 1 : Math.max(1, Math.floor(input.version ?? 1)),
      updatedAt: input.updatedAt ?? nowIso()
    });
    this.items.set(key, next);
    return cloneAgent(next);
  }
}

export class InMemoryExecutionTargetRepository implements ExecutionTargetRepository {
  private readonly items = new Map<string, ExecutionTargetRecord>();

  constructor(seed?: ExecutionTargetRecord[]) {
    const initial =
      seed ??
      [
        {
          targetId: "target_local_default",
          tenantId: "t_default",
          workspaceId: "w_default",
          kind: "local-host",
          isDefault: true,
          enabled: true,
          config: {},
          version: 1,
          updatedAt: nowIso()
        }
      ];
    for (const item of initial) {
      this.items.set(item.targetId, normalizeTarget(item));
    }
  }

  async list(filter: { tenantId?: string; workspaceId?: string } = {}): Promise<ExecutionTargetRecord[]> {
    return Array.from(this.items.values())
      .filter((item) => (filter.tenantId ? item.tenantId === filter.tenantId : true))
      .filter((item) => (filter.workspaceId !== undefined ? (item.workspaceId ?? "") === filter.workspaceId : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(cloneTarget);
  }

  async get(targetId: string): Promise<ExecutionTargetRecord | undefined> {
    const value = this.items.get(targetId);
    return value ? cloneTarget(value) : undefined;
  }

  async findDefault(tenantId: string, workspaceId?: string): Promise<ExecutionTargetRecord | undefined> {
    const all = await this.list({ tenantId });
    const workspaceDefault = all.find((item) => item.enabled && item.isDefault && item.workspaceId === workspaceId);
    if (workspaceDefault) {
      return workspaceDefault;
    }
    const tenantDefault = all.find((item) => item.enabled && item.isDefault && !item.workspaceId);
    return tenantDefault ?? undefined;
  }

  async upsert(
    input: Omit<ExecutionTargetRecord, "version" | "updatedAt"> & {
      version?: number;
      updatedAt?: string;
    }
  ): Promise<ExecutionTargetRecord> {
    const current = this.items.get(input.targetId);
    const next = normalizeTarget({
      ...input,
      version: current ? current.version + 1 : Math.max(1, Math.floor(input.version ?? 1)),
      updatedAt: input.updatedAt ?? nowIso()
    });

    if (next.isDefault) {
      for (const [id, candidate] of this.items) {
        if (id === next.targetId) {
          continue;
        }
        if (candidate.tenantId !== next.tenantId) {
          continue;
        }
        if ((candidate.workspaceId ?? "") !== (next.workspaceId ?? "")) {
          continue;
        }
        this.items.set(id, {
          ...candidate,
          isDefault: false,
          updatedAt: nowIso()
        });
      }
    }

    this.items.set(next.targetId, next);
    return cloneTarget(next);
  }
}

export class InMemoryBudgetRepository implements BudgetRepository {
  private readonly policies = new Map<string, BudgetPolicyRecord>();
  private readonly usage = new Map<string, { tokensUsed: number; costUsd: number; runsRejected: number; updatedAt: string }>();

  async get(scopeKey = defaultBudgetScopeKey()): Promise<BudgetPolicyRecord> {
    const existing = this.policies.get(scopeKey);
    if (existing) {
      return cloneBudgetPolicy(existing);
    }
    const created = normalizeBudgetPolicy({
      scopeKey,
      tokenDailyLimit: null,
      costMonthlyUsdLimit: null,
      hardLimit: true,
      version: 1,
      updatedAt: nowIso()
    });
    this.policies.set(scopeKey, created);
    return cloneBudgetPolicy(created);
  }

  async update(patch: BudgetPolicyPatch, scopeKey = defaultBudgetScopeKey()): Promise<BudgetPolicyRecord> {
    const current = await this.get(scopeKey);
    const next = normalizeBudgetPolicy({
      ...current,
      ...(patch.tokenDailyLimit !== undefined ? { tokenDailyLimit: patch.tokenDailyLimit } : {}),
      ...(patch.costMonthlyUsdLimit !== undefined ? { costMonthlyUsdLimit: patch.costMonthlyUsdLimit } : {}),
      ...(patch.hardLimit !== undefined ? { hardLimit: patch.hardLimit } : {}),
      version: current.version + 1,
      updatedAt: nowIso()
    });
    this.policies.set(scopeKey, next);
    return cloneBudgetPolicy(next);
  }

  async addUsage(entry: {
    scopeKey: string;
    date?: string;
    tokensUsed?: number;
    costUsd?: number;
    runsRejected?: number;
    updatedAt?: string;
  }): Promise<void> {
    const date = normalizeDate(entry.date) ?? todayYmd();
    const key = usageKey(entry.scopeKey, date);
    const current = this.usage.get(key) ?? {
      tokensUsed: 0,
      costUsd: 0,
      runsRejected: 0,
      updatedAt: nowIso()
    };
    this.usage.set(key, {
      tokensUsed: Math.max(0, current.tokensUsed + normalizeInt(entry.tokensUsed)),
      costUsd: round6(Math.max(0, current.costUsd + normalizeNumber(entry.costUsd))),
      runsRejected: Math.max(0, current.runsRejected + normalizeInt(entry.runsRejected)),
      updatedAt: entry.updatedAt ?? nowIso()
    });
  }

  async summary(scopeKey: string, date = todayYmd()): Promise<BudgetUsageSummary> {
    const normalizedDate = normalizeDate(date) ?? todayYmd();
    const month = normalizedDate.slice(0, 7);
    const daily = this.usage.get(usageKey(scopeKey, normalizedDate)) ?? {
      tokensUsed: 0,
      costUsd: 0,
      runsRejected: 0
    };

    let monthlyCost = 0;
    for (const [key, value] of this.usage.entries()) {
      const [currentScope, currentDate] = splitUsageKey(key);
      if (currentScope !== scopeKey) {
        continue;
      }
      if (!currentDate.startsWith(month)) {
        continue;
      }
      monthlyCost += value.costUsd;
    }

    return {
      scopeKey,
      date: normalizedDate,
      month,
      tokensUsedDaily: daily.tokensUsed,
      costUsdMonthly: round6(monthlyCost),
      runsRejectedDaily: daily.runsRejected
    };
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly items: AuditLogRecord[] = [];
  private nextId = 1;

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
    this.items.push({
      id: this.nextId++,
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId,
      action: entry.action,
      actor: entry.actor,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: isObjectRecord(entry.metadata) ? entry.metadata : {},
      createdAt: entry.createdAt ?? nowIso()
    });
  }

  async query(params: AuditQuery = {}): Promise<AuditQueryResult> {
    const limit = normalizeLimit(params.limit);
    const cursor = normalizeCursor(params.cursor);
    const from = params.from;
    const to = params.to;
    const filtered = [...this.items]
      .filter((item) => (params.tenantId ? item.tenantId === params.tenantId : true))
      .filter((item) => (params.workspaceId ? item.workspaceId === params.workspaceId : true))
      .filter((item) => (params.action ? item.action === params.action : true))
      .filter((item) => (from ? item.createdAt >= from : true))
      .filter((item) => (to ? item.createdAt <= to : true))
      .filter((item) => (cursor ? item.id < cursor : true))
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);

    return {
      items: filtered.map(cloneAudit),
      ...(filtered.length === limit ? { nextCursor: filtered[filtered.length - 1].id } : {})
    };
  }
}

export class SqliteAgentRepository implements AgentRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async list(filter: { tenantId?: string; workspaceId?: string } = {}): Promise<AgentDefinitionRecord[]> {
    ensureP2Schema(this.dbPath);
    const where: string[] = [];
    if (filter.tenantId) {
      where.push(`tenant_id = ${sqlString(filter.tenantId)}`);
    }
    if (filter.workspaceId) {
      where.push(`workspace_id = ${sqlString(filter.workspaceId)}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = queryJson<{
      tenantId: string;
      workspaceId: string;
      agentId: string;
      name: string;
      runtimeMode: AgentRuntimeMode;
      executionTargetId: string | null;
      policyScopeKey: string | null;
      enabled: number;
      configJson: string;
      version: number;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          tenant_id AS tenantId,
          workspace_id AS workspaceId,
          agent_id AS agentId,
          name AS name,
          runtime_mode AS runtimeMode,
          execution_target_id AS executionTargetId,
          policy_scope_key AS policyScopeKey,
          enabled AS enabled,
          config_json AS configJson,
          version AS version,
          updated_at AS updatedAt
        FROM agent_definitions
        ${whereSql}
        ORDER BY updated_at DESC;
      `
    );
    return rows.map((row) =>
      normalizeAgent({
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        name: row.name,
        runtimeMode: row.runtimeMode,
        executionTargetId: row.executionTargetId ?? undefined,
        policyScopeKey: row.policyScopeKey ?? undefined,
        enabled: row.enabled === 1,
        config: parseJsonObject(row.configJson),
        version: row.version,
        updatedAt: row.updatedAt
      })
    );
  }

  async get(tenantId: string, workspaceId: string, agentId: string): Promise<AgentDefinitionRecord | undefined> {
    const rows = await this.list({
      tenantId,
      workspaceId
    });
    return rows.find((item) => item.agentId === agentId);
  }

  async upsert(
    input: Omit<AgentDefinitionRecord, "version" | "updatedAt"> & {
      version?: number;
      updatedAt?: string;
    }
  ): Promise<AgentDefinitionRecord> {
    ensureP2Schema(this.dbPath);
    const current = await this.get(input.tenantId, input.workspaceId, input.agentId);
    const next = normalizeAgent({
      ...input,
      version: current ? current.version + 1 : Math.max(1, Math.floor(input.version ?? 1)),
      updatedAt: input.updatedAt ?? nowIso()
    });
    execSql(
      this.dbPath,
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
        VALUES (
          ${sqlString(next.tenantId)},
          ${sqlString(next.workspaceId)},
          ${sqlString(next.agentId)},
          ${sqlString(next.name)},
          ${sqlString(next.runtimeMode)},
          ${sqlMaybeString(next.executionTargetId)},
          ${sqlMaybeString(next.policyScopeKey)},
          ${sqlInt(next.enabled ? 1 : 0)},
          ${sqlString(JSON.stringify(next.config))},
          ${sqlInt(next.version)},
          ${sqlString(next.updatedAt)}
        )
        ON CONFLICT(tenant_id, workspace_id, agent_id) DO UPDATE SET
          name = excluded.name,
          runtime_mode = excluded.runtime_mode,
          execution_target_id = excluded.execution_target_id,
          policy_scope_key = excluded.policy_scope_key,
          enabled = excluded.enabled,
          config_json = excluded.config_json,
          version = excluded.version,
          updated_at = excluded.updated_at;
      `
    );
    return next;
  }
}

export class SqliteExecutionTargetRepository implements ExecutionTargetRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async list(filter: { tenantId?: string; workspaceId?: string } = {}): Promise<ExecutionTargetRecord[]> {
    ensureP2Schema(this.dbPath);
    const where: string[] = [];
    if (filter.tenantId) {
      where.push(`tenant_id = ${sqlString(filter.tenantId)}`);
    }
    if (filter.workspaceId !== undefined) {
      where.push(`COALESCE(workspace_id, '') = ${sqlString(filter.workspaceId)}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = queryJson<{
      targetId: string;
      tenantId: string;
      workspaceId: string | null;
      kind: ExecutionTargetKind;
      endpoint: string | null;
      authToken: string | null;
      isDefault: number;
      enabled: number;
      configJson: string;
      version: number;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          target_id AS targetId,
          tenant_id AS tenantId,
          workspace_id AS workspaceId,
          kind AS kind,
          endpoint AS endpoint,
          auth_token AS authToken,
          is_default AS isDefault,
          enabled AS enabled,
          config_json AS configJson,
          version AS version,
          updated_at AS updatedAt
        FROM execution_targets
        ${whereSql}
        ORDER BY updated_at DESC;
      `
    );
    return rows.map((row) =>
      normalizeTarget({
        targetId: row.targetId,
        tenantId: row.tenantId,
        workspaceId: row.workspaceId ?? undefined,
        kind: row.kind,
        endpoint: row.endpoint ?? undefined,
        authToken: row.authToken ?? undefined,
        isDefault: row.isDefault === 1,
        enabled: row.enabled === 1,
        config: parseJsonObject(row.configJson),
        version: row.version,
        updatedAt: row.updatedAt
      })
    );
  }

  async get(targetId: string): Promise<ExecutionTargetRecord | undefined> {
    const rows = await this.list();
    return rows.find((item) => item.targetId === targetId);
  }

  async findDefault(tenantId: string, workspaceId?: string): Promise<ExecutionTargetRecord | undefined> {
    ensureP2Schema(this.dbPath);
    const whereWorkspace = workspaceId ? `AND workspace_id = ${sqlString(workspaceId)}` : "AND workspace_id IS NULL";
    const workspaceRows = queryJson<{
      targetId: string;
    }>(
      this.dbPath,
      `
        SELECT target_id AS targetId
        FROM execution_targets
        WHERE tenant_id = ${sqlString(tenantId)}
          ${whereWorkspace}
          AND enabled = 1
          AND is_default = 1
        ORDER BY updated_at DESC
        LIMIT 1;
      `
    );
    if (workspaceRows.length > 0) {
      return await this.get(workspaceRows[0].targetId);
    }
    const tenantRows = queryJson<{
      targetId: string;
    }>(
      this.dbPath,
      `
        SELECT target_id AS targetId
        FROM execution_targets
        WHERE tenant_id = ${sqlString(tenantId)}
          AND workspace_id IS NULL
          AND enabled = 1
          AND is_default = 1
        ORDER BY updated_at DESC
        LIMIT 1;
      `
    );
    if (tenantRows.length === 0) {
      return undefined;
    }
    return await this.get(tenantRows[0].targetId);
  }

  async upsert(
    input: Omit<ExecutionTargetRecord, "version" | "updatedAt"> & {
      version?: number;
      updatedAt?: string;
    }
  ): Promise<ExecutionTargetRecord> {
    ensureP2Schema(this.dbPath);
    const current = await this.get(input.targetId);
    const next = normalizeTarget({
      ...input,
      version: current ? current.version + 1 : Math.max(1, Math.floor(input.version ?? 1)),
      updatedAt: input.updatedAt ?? nowIso()
    });
    execSql(
      this.dbPath,
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
        VALUES (
          ${sqlString(next.targetId)},
          ${sqlString(next.tenantId)},
          ${sqlMaybeString(next.workspaceId)},
          ${sqlString(next.kind)},
          ${sqlMaybeString(next.endpoint)},
          ${sqlMaybeString(next.authToken)},
          ${sqlInt(next.isDefault ? 1 : 0)},
          ${sqlInt(next.enabled ? 1 : 0)},
          ${sqlString(JSON.stringify(next.config))},
          ${sqlInt(next.version)},
          ${sqlString(next.updatedAt)}
        )
        ON CONFLICT(target_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          workspace_id = excluded.workspace_id,
          kind = excluded.kind,
          endpoint = excluded.endpoint,
          auth_token = excluded.auth_token,
          is_default = excluded.is_default,
          enabled = excluded.enabled,
          config_json = excluded.config_json,
          version = excluded.version,
          updated_at = excluded.updated_at;
      `
    );

    if (next.isDefault) {
      const scopeFilter = next.workspaceId
        ? `workspace_id = ${sqlString(next.workspaceId)}`
        : "workspace_id IS NULL";
      execSql(
        this.dbPath,
        `
          UPDATE execution_targets
          SET is_default = 0
          WHERE tenant_id = ${sqlString(next.tenantId)}
            AND ${scopeFilter}
            AND target_id <> ${sqlString(next.targetId)};
        `
      );
    }

    return next;
  }
}

export class SqliteBudgetRepository implements BudgetRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async get(scopeKey = defaultBudgetScopeKey()): Promise<BudgetPolicyRecord> {
    ensureP2Schema(this.dbPath);
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
        FROM budget_policies
        WHERE scope_key = ${sqlString(scopeKey)}
        LIMIT 1;
      `
    );
    if (rows.length === 0) {
      const created = normalizeBudgetPolicy({
        scopeKey,
        tokenDailyLimit: null,
        costMonthlyUsdLimit: null,
        hardLimit: true,
        version: 1,
        updatedAt: nowIso()
      });
      execSql(
        this.dbPath,
        `
          INSERT OR IGNORE INTO budget_policies (scope_key, policy_json, version, updated_at)
          VALUES (
            ${sqlString(scopeKey)},
            ${sqlString(
              JSON.stringify({
                tokenDailyLimit: created.tokenDailyLimit,
                costMonthlyUsdLimit: created.costMonthlyUsdLimit,
                hardLimit: created.hardLimit
              })
            )},
            ${sqlInt(created.version)},
            ${sqlString(created.updatedAt)}
          );
        `
      );
      return await this.get(scopeKey);
    }
    return parseBudgetRow(rows[0]);
  }

  async update(patch: BudgetPolicyPatch, scopeKey = defaultBudgetScopeKey()): Promise<BudgetPolicyRecord> {
    ensureP2Schema(this.dbPath);
    const current = await this.get(scopeKey);
    const next = normalizeBudgetPolicy({
      ...current,
      ...(patch.tokenDailyLimit !== undefined ? { tokenDailyLimit: patch.tokenDailyLimit } : {}),
      ...(patch.costMonthlyUsdLimit !== undefined ? { costMonthlyUsdLimit: patch.costMonthlyUsdLimit } : {}),
      ...(patch.hardLimit !== undefined ? { hardLimit: patch.hardLimit } : {}),
      version: current.version + 1,
      updatedAt: nowIso()
    });

    execSql(
      this.dbPath,
      `
        INSERT INTO budget_policies (scope_key, policy_json, version, updated_at)
        VALUES (
          ${sqlString(scopeKey)},
          ${sqlString(
            JSON.stringify({
              tokenDailyLimit: next.tokenDailyLimit,
              costMonthlyUsdLimit: next.costMonthlyUsdLimit,
              hardLimit: next.hardLimit
            })
          )},
          ${sqlInt(next.version)},
          ${sqlString(next.updatedAt)}
        )
        ON CONFLICT(scope_key) DO UPDATE SET
          policy_json = excluded.policy_json,
          version = excluded.version,
          updated_at = excluded.updated_at;
      `
    );

    return await this.get(scopeKey);
  }

  async addUsage(entry: {
    scopeKey: string;
    date?: string;
    tokensUsed?: number;
    costUsd?: number;
    runsRejected?: number;
    updatedAt?: string;
  }): Promise<void> {
    ensureP2Schema(this.dbPath);
    const date = normalizeDate(entry.date) ?? todayYmd();
    execSql(
      this.dbPath,
      `
        INSERT INTO budget_usage_daily (
          scope_key,
          date_ymd,
          tokens_used,
          cost_usd,
          runs_rejected,
          updated_at
        )
        VALUES (
          ${sqlString(entry.scopeKey)},
          ${sqlString(date)},
          ${sqlInt(normalizeInt(entry.tokensUsed))},
          ${sqlNumber(round6(normalizeNumber(entry.costUsd)))},
          ${sqlInt(normalizeInt(entry.runsRejected))},
          ${sqlString(entry.updatedAt ?? nowIso())}
        )
        ON CONFLICT(scope_key, date_ymd) DO UPDATE SET
          tokens_used = tokens_used + excluded.tokens_used,
          cost_usd = cost_usd + excluded.cost_usd,
          runs_rejected = runs_rejected + excluded.runs_rejected,
          updated_at = excluded.updated_at;
      `
    );
  }

  async summary(scopeKey: string, date = todayYmd()): Promise<BudgetUsageSummary> {
    ensureP2Schema(this.dbPath);
    const normalizedDate = normalizeDate(date) ?? todayYmd();
    const month = normalizedDate.slice(0, 7);
    const dailyRows = queryJson<{
      tokensUsed: number;
      runsRejected: number;
    }>(
      this.dbPath,
      `
        SELECT
          tokens_used AS tokensUsed,
          runs_rejected AS runsRejected
        FROM budget_usage_daily
        WHERE scope_key = ${sqlString(scopeKey)}
          AND date_ymd = ${sqlString(normalizedDate)}
        LIMIT 1;
      `
    );

    const monthlyRows = queryJson<{
      costUsdMonthly: number;
    }>(
      this.dbPath,
      `
        SELECT
          COALESCE(SUM(cost_usd), 0) AS costUsdMonthly
        FROM budget_usage_daily
        WHERE scope_key = ${sqlString(scopeKey)}
          AND substr(date_ymd, 1, 7) = ${sqlString(month)};
      `
    );

    return {
      scopeKey,
      date: normalizedDate,
      month,
      tokensUsedDaily: dailyRows[0] ? normalizeInt(dailyRows[0].tokensUsed) : 0,
      costUsdMonthly: round6(monthlyRows[0] ? normalizeNumber(monthlyRows[0].costUsdMonthly) : 0),
      runsRejectedDaily: dailyRows[0] ? normalizeInt(dailyRows[0].runsRejected) : 0
    };
  }
}

export class SqliteAuditRepository implements AuditRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

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
    ensureP2Schema(this.dbPath);
    execSql(
      this.dbPath,
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
        VALUES (
          ${sqlString(entry.tenantId)},
          ${sqlString(entry.workspaceId)},
          ${sqlString(entry.action)},
          ${sqlString(entry.actor)},
          ${sqlMaybeString(entry.resourceType)},
          ${sqlMaybeString(entry.resourceId)},
          ${sqlString(JSON.stringify(isObjectRecord(entry.metadata) ? entry.metadata : {}))},
          ${sqlString(entry.createdAt ?? nowIso())}
        );
      `
    );
  }

  async query(params: AuditQuery = {}): Promise<AuditQueryResult> {
    ensureP2Schema(this.dbPath);
    const where: string[] = [];
    if (params.tenantId) {
      where.push(`tenant_id = ${sqlString(params.tenantId)}`);
    }
    if (params.workspaceId) {
      where.push(`workspace_id = ${sqlString(params.workspaceId)}`);
    }
    if (params.action) {
      where.push(`action = ${sqlString(params.action)}`);
    }
    if (params.from) {
      where.push(`created_at >= ${sqlString(params.from)}`);
    }
    if (params.to) {
      where.push(`created_at <= ${sqlString(params.to)}`);
    }
    if (params.cursor && Number.isFinite(params.cursor)) {
      where.push(`id < ${Math.floor(params.cursor)}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limit = normalizeLimit(params.limit);
    const rows = queryJson<{
      id: number;
      tenantId: string;
      workspaceId: string;
      action: string;
      actor: string;
      resourceType: string | null;
      resourceId: string | null;
      metadataJson: string;
      createdAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          id AS id,
          tenant_id AS tenantId,
          workspace_id AS workspaceId,
          action AS action,
          actor AS actor,
          resource_type AS resourceType,
          resource_id AS resourceId,
          metadata_json AS metadataJson,
          created_at AS createdAt
        FROM audit_logs
        ${whereSql}
        ORDER BY id DESC
        LIMIT ${limit};
      `
    );

    const items = rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      action: row.action,
      actor: row.actor,
      resourceType: row.resourceType ?? undefined,
      resourceId: row.resourceId ?? undefined,
      metadata: parseJsonObject(row.metadataJson),
      createdAt: row.createdAt
    }));

    return {
      items,
      ...(items.length === limit ? { nextCursor: items[items.length - 1].id } : {})
    };
  }
}

export class InMemoryModelSecretRepository implements ModelSecretRepository {
  private readonly items = new Map<string, ModelSecretRecord>();

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
    const next = normalizeModelSecret({
      tenantId: input.tenantId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      provider: input.provider,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      apiKey: input.apiKey,
      updatedBy: sanitizeId(input.updatedBy, "system"),
      updatedAt: input.updatedAt ?? nowIso()
    });
    this.items.set(modelSecretKey(next.tenantId, next.workspaceId, next.provider), next);
    return cloneModelSecret(next);
  }

  async getForRun(input: {
    tenantId: string;
    workspaceId?: string;
    provider?: string;
  }): Promise<ModelSecretRecord | undefined> {
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const workspaceId = input.workspaceId ? sanitizeId(input.workspaceId, "w_default") : undefined;
    const provider = sanitizeProvider(input.provider);

    if (provider && workspaceId) {
      const exactWorkspace = this.items.get(modelSecretKey(tenantId, workspaceId, provider));
      if (exactWorkspace) {
        return cloneModelSecret(exactWorkspace);
      }
    }
    if (provider) {
      const tenantDefault = this.items.get(modelSecretKey(tenantId, undefined, provider));
      if (tenantDefault) {
        return cloneModelSecret(tenantDefault);
      }
      return undefined;
    }

    const all = Array.from(this.items.values())
      .filter((item) => item.tenantId === tenantId)
      .sort((a, b) => {
        const aScore = workspaceId && a.workspaceId === workspaceId ? 0 : a.workspaceId ? 1 : 2;
        const bScore = workspaceId && b.workspaceId === workspaceId ? 0 : b.workspaceId ? 1 : 2;
        if (aScore !== bScore) {
          return aScore - bScore;
        }
        return a.provider.localeCompare(b.provider);
      });
    return all[0] ? cloneModelSecret(all[0]) : undefined;
  }

  async listMeta(filter: {
    tenantId: string;
    workspaceId?: string;
    provider?: string;
  }): Promise<ModelSecretMetaRecord[]> {
    const tenantId = sanitizeId(filter.tenantId, "t_default");
    const workspaceId = filter.workspaceId ? sanitizeId(filter.workspaceId, "w_default") : undefined;
    const provider = sanitizeProvider(filter.provider);
    return Array.from(this.items.values())
      .filter((item) => item.tenantId === tenantId)
      .filter((item) => (workspaceId !== undefined ? (item.workspaceId ?? "") === workspaceId : true))
      .filter((item) => (provider ? item.provider === provider : true))
      .sort((a, b) => a.provider.localeCompare(b.provider))
      .map((item) => toModelSecretMeta(item));
  }
}

export class SqliteModelSecretRepository implements ModelSecretRepository {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

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
    ensureP2Schema(this.dbPath);
    const next = normalizeModelSecret({
      tenantId: input.tenantId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      provider: input.provider,
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      apiKey: input.apiKey,
      updatedBy: sanitizeId(input.updatedBy, "system"),
      updatedAt: input.updatedAt ?? nowIso()
    });
    execSql(
      this.dbPath,
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
        VALUES (
          ${sqlString(next.tenantId)},
          ${sqlMaybeString(next.workspaceId)},
          ${sqlString(next.provider)},
          ${sqlMaybeString(next.modelId)},
          ${sqlMaybeString(next.baseUrl)},
          ${sqlString(next.apiKey)},
          ${sqlString(next.updatedBy)},
          ${sqlString(next.updatedAt)}
        )
        ON CONFLICT(tenant_id, workspace_id, provider) DO UPDATE SET
          model_id = excluded.model_id,
          base_url = excluded.base_url,
          api_key = excluded.api_key,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
      `
    );
    return (
      await this.getForRun({
        tenantId: next.tenantId,
        ...(next.workspaceId ? { workspaceId: next.workspaceId } : {}),
        provider: next.provider
      })
    )!;
  }

  async getForRun(input: {
    tenantId: string;
    workspaceId?: string;
    provider?: string;
  }): Promise<ModelSecretRecord | undefined> {
    ensureP2Schema(this.dbPath);
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const workspaceId = input.workspaceId ? sanitizeId(input.workspaceId, "w_default") : undefined;
    const provider = sanitizeProvider(input.provider);

    if (provider && workspaceId) {
      const workspaceRows = queryJson<{
        tenantId: string;
        workspaceId: string | null;
        provider: string;
        modelId: string | null;
        baseUrl: string | null;
        apiKey: string;
        updatedBy: string;
        updatedAt: string;
      }>(
        this.dbPath,
        `
          SELECT
            tenant_id AS tenantId,
            workspace_id AS workspaceId,
            provider AS provider,
            model_id AS modelId,
            base_url AS baseUrl,
            api_key AS apiKey,
            updated_by AS updatedBy,
            updated_at AS updatedAt
          FROM model_secrets
          WHERE tenant_id = ${sqlString(tenantId)}
            AND workspace_id = ${sqlString(workspaceId)}
            AND provider = ${sqlString(provider)}
          LIMIT 1;
        `
      );
      if (workspaceRows[0]) {
        return normalizeModelSecret({
          tenantId: workspaceRows[0].tenantId,
          workspaceId: workspaceRows[0].workspaceId ?? undefined,
          provider: workspaceRows[0].provider,
          modelId: workspaceRows[0].modelId ?? undefined,
          baseUrl: workspaceRows[0].baseUrl ?? undefined,
          apiKey: workspaceRows[0].apiKey,
          updatedBy: workspaceRows[0].updatedBy,
          updatedAt: workspaceRows[0].updatedAt
        });
      }
    }

    if (provider) {
      const tenantRows = queryJson<{
        tenantId: string;
        workspaceId: string | null;
        provider: string;
        modelId: string | null;
        baseUrl: string | null;
        apiKey: string;
        updatedBy: string;
        updatedAt: string;
      }>(
        this.dbPath,
        `
          SELECT
            tenant_id AS tenantId,
            workspace_id AS workspaceId,
            provider AS provider,
            model_id AS modelId,
            base_url AS baseUrl,
            api_key AS apiKey,
            updated_by AS updatedBy,
            updated_at AS updatedAt
          FROM model_secrets
          WHERE tenant_id = ${sqlString(tenantId)}
            AND workspace_id IS NULL
            AND provider = ${sqlString(provider)}
          LIMIT 1;
        `
      );
      if (tenantRows[0]) {
        return normalizeModelSecret({
          tenantId: tenantRows[0].tenantId,
          workspaceId: tenantRows[0].workspaceId ?? undefined,
          provider: tenantRows[0].provider,
          modelId: tenantRows[0].modelId ?? undefined,
          baseUrl: tenantRows[0].baseUrl ?? undefined,
          apiKey: tenantRows[0].apiKey,
          updatedBy: tenantRows[0].updatedBy,
          updatedAt: tenantRows[0].updatedAt
        });
      }
      return undefined;
    }

    const allRows = queryJson<{
      tenantId: string;
      workspaceId: string | null;
      provider: string;
      modelId: string | null;
      baseUrl: string | null;
      apiKey: string;
      updatedBy: string;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          tenant_id AS tenantId,
          workspace_id AS workspaceId,
          provider AS provider,
          model_id AS modelId,
          base_url AS baseUrl,
          api_key AS apiKey,
          updated_by AS updatedBy,
          updated_at AS updatedAt
        FROM model_secrets
        WHERE tenant_id = ${sqlString(tenantId)}
        ORDER BY provider ASC;
      `
    );
    const ranked = allRows
      .map((row) =>
        normalizeModelSecret({
          tenantId: row.tenantId,
          workspaceId: row.workspaceId ?? undefined,
          provider: row.provider,
          modelId: row.modelId ?? undefined,
          baseUrl: row.baseUrl ?? undefined,
          apiKey: row.apiKey,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt
        })
      )
      .sort((a, b) => {
        const aScore = workspaceId && a.workspaceId === workspaceId ? 0 : a.workspaceId ? 1 : 2;
        const bScore = workspaceId && b.workspaceId === workspaceId ? 0 : b.workspaceId ? 1 : 2;
        if (aScore !== bScore) {
          return aScore - bScore;
        }
        return a.provider.localeCompare(b.provider);
      });
    return ranked[0];
  }

  async listMeta(filter: {
    tenantId: string;
    workspaceId?: string;
    provider?: string;
  }): Promise<ModelSecretMetaRecord[]> {
    ensureP2Schema(this.dbPath);
    const where: string[] = [`tenant_id = ${sqlString(sanitizeId(filter.tenantId, "t_default"))}`];
    if (filter.workspaceId !== undefined) {
      where.push(`COALESCE(workspace_id, '') = ${sqlString(sanitizeId(filter.workspaceId, "w_default"))}`);
    }
    if (filter.provider) {
      where.push(`provider = ${sqlString(sanitizeProvider(filter.provider))}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = queryJson<{
      tenantId: string;
      workspaceId: string | null;
      provider: string;
      modelId: string | null;
      baseUrl: string | null;
      apiKey: string;
      updatedBy: string;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          tenant_id AS tenantId,
          workspace_id AS workspaceId,
          provider AS provider,
          model_id AS modelId,
          base_url AS baseUrl,
          api_key AS apiKey,
          updated_by AS updatedBy,
          updated_at AS updatedAt
        FROM model_secrets
        ${whereSql}
        ORDER BY provider ASC;
      `
    );
    return rows.map((row) =>
      toModelSecretMeta(
        normalizeModelSecret({
          tenantId: row.tenantId,
          workspaceId: row.workspaceId ?? undefined,
          provider: row.provider,
          modelId: row.modelId ?? undefined,
          baseUrl: row.baseUrl ?? undefined,
          apiKey: row.apiKey,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt
        })
      )
    );
  }
}

const initializedDbPaths = new Set<string>();

function ensureP2Schema(dbPath: string): void {
  if (initializedDbPaths.has(dbPath)) {
    return;
  }
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  execSql(
    dbPath,
    `
      CREATE TABLE IF NOT EXISTS agent_definitions (
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        runtime_mode TEXT NOT NULL DEFAULT 'local',
        execution_target_id TEXT,
        policy_scope_key TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}',
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
        is_default INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_execution_targets_scope
      ON execution_targets(tenant_id, workspace_id, is_default, enabled);

      CREATE TABLE IF NOT EXISTS budget_policies (
        scope_key TEXT PRIMARY KEY,
        policy_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS budget_usage_daily (
        scope_key TEXT NOT NULL,
        date_ymd TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        runs_rejected INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_key, date_ymd)
      );

      CREATE INDEX IF NOT EXISTS idx_budget_usage_scope_date
      ON budget_usage_daily(scope_key, date_ymd);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        metadata_json TEXT NOT NULL,
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
    `
  );

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
  execSql(
    dbPath,
    `
      INSERT OR IGNORE INTO execution_targets (
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
      VALUES (
        ${sqlString(defaultTarget.targetId)},
        ${sqlString(defaultTarget.tenantId)},
        ${sqlString(defaultTarget.workspaceId ?? "w_default")},
        ${sqlString(defaultTarget.kind)},
        ${sqlMaybeString(defaultTarget.endpoint)},
        ${sqlMaybeString(defaultTarget.authToken)},
        ${sqlInt(defaultTarget.isDefault ? 1 : 0)},
        ${sqlInt(defaultTarget.enabled ? 1 : 0)},
        ${sqlString(JSON.stringify(defaultTarget.config))},
        ${sqlInt(defaultTarget.version)},
        ${sqlString(defaultTarget.updatedAt)}
      );
    `
  );

  initializedDbPaths.add(dbPath);
}

function parseBudgetRow(row: { scopeKey: string; policyJson: string; version: number; updatedAt: string }): BudgetPolicyRecord {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(row.policyJson);
    if (isObjectRecord(value)) {
      parsed = value;
    }
  } catch {
    parsed = {};
  }
  return normalizeBudgetPolicy({
    scopeKey: row.scopeKey,
    tokenDailyLimit: asNullableNumber(parsed.tokenDailyLimit),
    costMonthlyUsdLimit: asNullableNumber(parsed.costMonthlyUsdLimit),
    hardLimit: parsed.hardLimit !== false,
    version: row.version,
    updatedAt: row.updatedAt
  });
}

function normalizeAgent(input: AgentDefinitionRecord): AgentDefinitionRecord {
  return {
    tenantId: sanitizeId(input.tenantId, "t_default"),
    workspaceId: sanitizeId(input.workspaceId, "w_default"),
    agentId: sanitizeId(input.agentId, "a_default"),
    name: sanitizeName(input.name, "default-agent"),
    runtimeMode: input.runtimeMode === "cloud" ? "cloud" : "local",
    ...(input.executionTargetId ? { executionTargetId: input.executionTargetId } : {}),
    ...(input.policyScopeKey ? { policyScopeKey: input.policyScopeKey } : {}),
    enabled: input.enabled !== false,
    config: isObjectRecord(input.config) ? { ...input.config } : {},
    version: Math.max(1, Math.floor(input.version)),
    updatedAt: input.updatedAt
  };
}

function normalizeTarget(input: ExecutionTargetRecord): ExecutionTargetRecord {
  return {
    targetId: sanitizeId(input.targetId, `target_${Date.now().toString(36)}`),
    tenantId: sanitizeId(input.tenantId, "t_default"),
    ...(input.workspaceId ? { workspaceId: sanitizeId(input.workspaceId, "w_default") } : {}),
    kind: input.kind === "docker-runner" ? "docker-runner" : "local-host",
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    ...(input.authToken ? { authToken: input.authToken } : {}),
    isDefault: input.isDefault === true,
    enabled: input.enabled !== false,
    config: isObjectRecord(input.config) ? { ...input.config } : {},
    version: Math.max(1, Math.floor(input.version)),
    updatedAt: input.updatedAt
  };
}

function normalizeBudgetPolicy(input: BudgetPolicyRecord): BudgetPolicyRecord {
  return {
    scopeKey: sanitizeId(input.scopeKey, defaultBudgetScopeKey()),
    tokenDailyLimit: normalizeNullableLimit(input.tokenDailyLimit),
    costMonthlyUsdLimit: normalizeNullableLimit(input.costMonthlyUsdLimit),
    hardLimit: input.hardLimit !== false,
    version: Math.max(1, Math.floor(input.version)),
    updatedAt: input.updatedAt
  };
}

function cloneAgent(item: AgentDefinitionRecord): AgentDefinitionRecord {
  return {
    ...item,
    config: { ...item.config }
  };
}

function cloneTarget(item: ExecutionTargetRecord): ExecutionTargetRecord {
  return {
    ...item,
    ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
    ...(item.endpoint ? { endpoint: item.endpoint } : {}),
    ...(item.authToken ? { authToken: item.authToken } : {}),
    config: { ...item.config }
  };
}

function cloneModelSecret(item: ModelSecretRecord): ModelSecretRecord {
  return {
    ...item,
    ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
    ...(item.modelId ? { modelId: item.modelId } : {}),
    ...(item.baseUrl ? { baseUrl: item.baseUrl } : {})
  };
}

function normalizeModelSecret(input: ModelSecretRecord): ModelSecretRecord {
  return {
    tenantId: sanitizeId(input.tenantId, "t_default"),
    ...(input.workspaceId ? { workspaceId: sanitizeId(input.workspaceId, "w_default") } : {}),
    provider: sanitizeProvider(input.provider),
    ...(input.modelId ? { modelId: sanitizeId(input.modelId, input.modelId) } : {}),
    ...(input.baseUrl ? { baseUrl: input.baseUrl.trim() } : {}),
    apiKey: String(input.apiKey ?? "").trim(),
    updatedBy: sanitizeId(input.updatedBy, "system"),
    updatedAt: input.updatedAt
  };
}

function toModelSecretMeta(input: ModelSecretRecord): ModelSecretMetaRecord {
  return {
    tenantId: input.tenantId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    provider: input.provider,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    maskedKey: maskSecret(input.apiKey),
    keyLast4: input.apiKey.slice(-4),
    updatedBy: input.updatedBy,
    updatedAt: input.updatedAt
  };
}

function modelSecretKey(tenantId: string, workspaceId: string | undefined, provider: string): string {
  return `${sanitizeId(tenantId, "t_default")}::${workspaceId ? sanitizeId(workspaceId, "w_default") : "*"}::${sanitizeProvider(provider)}`;
}

function sanitizeProvider(value: unknown): string {
  return sanitizeId(value, "openai").toLowerCase();
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

function cloneBudgetPolicy(item: BudgetPolicyRecord): BudgetPolicyRecord {
  return { ...item };
}

function cloneAudit(item: AuditLogRecord): AuditLogRecord {
  return {
    ...item,
    ...(item.resourceType ? { resourceType: item.resourceType } : {}),
    ...(item.resourceId ? { resourceId: item.resourceId } : {}),
    metadata: { ...item.metadata }
  };
}

function normalizeNullableLimit(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value <= 0) {
    return 0;
  }
  return round6(value);
}

function sanitizeId(value: unknown, fallback: string): string {
  const compact = String(value ?? "").trim();
  return compact.length > 0 ? compact : fallback;
}

function sanitizeName(value: unknown, fallback: string): string {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return fallback;
  }
  return compact.slice(0, 80);
}

function agentKey(tenantId: string, workspaceId: string, agentId: string): string {
  return `${tenantId}:${workspaceId}:${agentId}`;
}

function usageKey(scopeKey: string, date: string): string {
  return `${scopeKey}|${date}`;
}

function splitUsageKey(key: string): [string, string] {
  const idx = key.lastIndexOf("|");
  if (idx === -1) {
    return [key, ""];
  }
  return [key.slice(0, idx), key.slice(idx + 1)];
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

function normalizeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const out = Math.floor(value);
  return out < 0 ? 0 : out;
}

function normalizeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 50;
  }
  const parsed = Math.floor(value);
  if (parsed <= 0) {
    return 50;
  }
  return Math.min(parsed, 500);
}

function normalizeCursor(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const parsed = Math.floor(value);
  if (parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input);
    if (isObjectRecord(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function defaultSqlitePath(): string {
  const fromEnv = process.env.OPENFOAL_SQLITE_PATH;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return normalizeDbPath(fromEnv.trim());
  }
  return normalizeDbPath(resolve(process.cwd(), ".openfoal", "gateway.sqlite"));
}

function normalizeDbPath(dbPath: string): string {
  if (dbPath === ":memory:") {
    return dbPath;
  }
  return resolve(dbPath);
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
  if (!text) {
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

function sqlInt(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(Math.floor(value));
}

function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(value);
}

function nowIso(): string {
  return new Date().toISOString();
}
