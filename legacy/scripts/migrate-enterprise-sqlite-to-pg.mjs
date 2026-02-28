import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  PostgresAgentRepository,
  PostgresAuthStore,
  PostgresSessionRepository
} from "../packages/storage/dist/index.js";

const sqlitePath = resolveSqlitePath(process.env.OPENFOAL_GATEWAY_SQLITE_PATH ?? process.env.OPENFOAL_SQLITE_PATH);
const pgUrl = process.env.OPENFOAL_POSTGRES_URL ?? "postgres://openfoal:openfoal@127.0.0.1:5432/openfoal";

if (sqlitePath !== ":memory:" && !existsSync(sqlitePath)) {
  throw new Error(`sqlite file not found: ${sqlitePath}`);
}

await ensurePostgresSchemas(pgUrl);
const pool = new Pool({
  connectionString: pgUrl
});

const report = {
  sqlitePath,
  pgUrl,
  startedAt: new Date().toISOString(),
  tables: {}
};

const migrations = [
  {
    table: "sessions",
    sql: "SELECT * FROM sessions",
    insert: `
      INSERT INTO sessions (
        id, session_key, tenant_id, workspace_id, owner_user_id, visibility, title, preview,
        runtime_mode, sync_state, context_usage, compaction_count, memory_flush_state, memory_flush_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(id) DO UPDATE SET
        session_key=EXCLUDED.session_key,
        tenant_id=EXCLUDED.tenant_id,
        workspace_id=EXCLUDED.workspace_id,
        owner_user_id=EXCLUDED.owner_user_id,
        visibility=EXCLUDED.visibility,
        title=EXCLUDED.title,
        preview=EXCLUDED.preview,
        runtime_mode=EXCLUDED.runtime_mode,
        sync_state=EXCLUDED.sync_state,
        context_usage=EXCLUDED.context_usage,
        compaction_count=EXCLUDED.compaction_count,
        memory_flush_state=EXCLUDED.memory_flush_state,
        memory_flush_at=EXCLUDED.memory_flush_at,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [
      row.id,
      row.session_key,
      row.tenant_id ?? "t_default",
      row.workspace_id ?? "w_default",
      row.owner_user_id ?? "u_legacy",
      row.visibility ?? "workspace",
      row.title ?? "new-session",
      row.preview ?? "",
      row.runtime_mode ?? "local",
      row.sync_state ?? "local_only",
      Number(row.context_usage ?? 0),
      Number(row.compaction_count ?? 0),
      row.memory_flush_state ?? "idle",
      row.memory_flush_at ?? null,
      row.updated_at ?? new Date().toISOString()
    ]
  },
  {
    table: "transcript",
    sql: "SELECT * FROM transcript",
    insert: `
      INSERT INTO transcript (
        id, session_id, tenant_id, workspace_id, owner_user_id, run_id, event, payload_json, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
      ON CONFLICT(id) DO UPDATE SET
        session_id=EXCLUDED.session_id,
        tenant_id=EXCLUDED.tenant_id,
        workspace_id=EXCLUDED.workspace_id,
        owner_user_id=EXCLUDED.owner_user_id,
        run_id=EXCLUDED.run_id,
        event=EXCLUDED.event,
        payload_json=EXCLUDED.payload_json,
        created_at=EXCLUDED.created_at
    `,
    map: (row) => [
      Number(row.id),
      row.session_id,
      row.tenant_id ?? "t_default",
      row.workspace_id ?? "w_default",
      row.owner_user_id ?? "u_legacy",
      row.run_id ?? null,
      row.event,
      row.payload_json ?? "{}",
      row.created_at ?? new Date().toISOString()
    ]
  },
  {
    table: "idempotency",
    sql: "SELECT * FROM idempotency",
    insert: `
      INSERT INTO idempotency (cache_key, fingerprint, result_json, created_at)
      VALUES ($1,$2,$3::jsonb,$4)
      ON CONFLICT(cache_key) DO UPDATE SET
        fingerprint=EXCLUDED.fingerprint,
        result_json=EXCLUDED.result_json,
        created_at=EXCLUDED.created_at
    `,
    map: (row) => [row.cache_key, row.fingerprint, row.result_json ?? '{"response":null,"events":[]}', row.created_at ?? new Date().toISOString()]
  },
  {
    table: "policy",
    sql: "SELECT * FROM policy",
    insert: `
      INSERT INTO policy (tenant_id, workspace_id, scope_key, policy_json, version, updated_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6)
      ON CONFLICT(tenant_id, workspace_id, scope_key) DO UPDATE SET
        policy_json=EXCLUDED.policy_json,
        version=EXCLUDED.version,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [
      row.tenant_id ?? "t_default",
      row.workspace_id ?? "w_default",
      row.scope_key,
      row.policy_json ?? "{}",
      Number(row.version ?? 1),
      row.updated_at ?? new Date().toISOString()
    ]
  },
  {
    table: "run_metrics",
    sql: "SELECT * FROM run_metrics",
    insert: `
      INSERT INTO run_metrics (
        id, session_id, run_id, tenant_id, workspace_id, agent_id, status, duration_ms, tool_calls, tool_failures, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(id) DO UPDATE SET
        session_id=EXCLUDED.session_id,
        run_id=EXCLUDED.run_id,
        tenant_id=EXCLUDED.tenant_id,
        workspace_id=EXCLUDED.workspace_id,
        agent_id=EXCLUDED.agent_id,
        status=EXCLUDED.status,
        duration_ms=EXCLUDED.duration_ms,
        tool_calls=EXCLUDED.tool_calls,
        tool_failures=EXCLUDED.tool_failures,
        created_at=EXCLUDED.created_at
    `,
    map: (row) => [
      Number(row.id),
      row.session_id,
      row.run_id ?? null,
      row.tenant_id ?? null,
      row.workspace_id ?? null,
      row.agent_id ?? null,
      row.status ?? "completed",
      Number(row.duration_ms ?? 0),
      Number(row.tool_calls ?? 0),
      Number(row.tool_failures ?? 0),
      row.created_at ?? new Date().toISOString()
    ]
  },
  {
    table: "agent_definitions",
    sql: "SELECT * FROM agent_definitions",
    insert: `
      INSERT INTO agent_definitions (
        tenant_id, workspace_id, agent_id, name, runtime_mode, execution_target_id, policy_scope_key, enabled, config_json, version, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
      ON CONFLICT(tenant_id, workspace_id, agent_id) DO UPDATE SET
        name=EXCLUDED.name,
        runtime_mode=EXCLUDED.runtime_mode,
        execution_target_id=EXCLUDED.execution_target_id,
        policy_scope_key=EXCLUDED.policy_scope_key,
        enabled=EXCLUDED.enabled,
        config_json=EXCLUDED.config_json,
        version=EXCLUDED.version,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [
      row.tenant_id,
      row.workspace_id,
      row.agent_id,
      row.name,
      row.runtime_mode ?? "local",
      row.execution_target_id ?? null,
      row.policy_scope_key ?? null,
      Number(row.enabled ?? 1) === 1,
      row.config_json ?? "{}",
      Number(row.version ?? 1),
      row.updated_at ?? new Date().toISOString()
    ]
  },
  {
    table: "execution_targets",
    sql: "SELECT * FROM execution_targets",
    insert: `
      INSERT INTO execution_targets (
        target_id, tenant_id, workspace_id, kind, endpoint, auth_token, is_default, enabled, config_json, version, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
      ON CONFLICT(target_id) DO UPDATE SET
        tenant_id=EXCLUDED.tenant_id,
        workspace_id=EXCLUDED.workspace_id,
        kind=EXCLUDED.kind,
        endpoint=EXCLUDED.endpoint,
        auth_token=EXCLUDED.auth_token,
        is_default=EXCLUDED.is_default,
        enabled=EXCLUDED.enabled,
        config_json=EXCLUDED.config_json,
        version=EXCLUDED.version,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [
      row.target_id,
      row.tenant_id,
      row.workspace_id ?? null,
      row.kind,
      row.endpoint ?? null,
      row.auth_token ?? null,
      Number(row.is_default ?? 0) === 1,
      Number(row.enabled ?? 1) === 1,
      row.config_json ?? "{}",
      Number(row.version ?? 1),
      row.updated_at ?? new Date().toISOString()
    ]
  },
  {
    table: "budget_policies",
    sql: "SELECT * FROM budget_policies",
    insert: `
      INSERT INTO budget_policies (scope_key, policy_json, version, updated_at)
      VALUES ($1,$2::jsonb,$3,$4)
      ON CONFLICT(scope_key) DO UPDATE SET
        policy_json=EXCLUDED.policy_json,
        version=EXCLUDED.version,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [row.scope_key, row.policy_json ?? "{}", Number(row.version ?? 1), row.updated_at ?? new Date().toISOString()]
  },
  {
    table: "budget_usage_daily",
    sql: "SELECT * FROM budget_usage_daily",
    insert: `
      INSERT INTO budget_usage_daily (scope_key, date_ymd, tokens_used, cost_usd, runs_rejected, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(scope_key, date_ymd) DO UPDATE SET
        tokens_used=EXCLUDED.tokens_used,
        cost_usd=EXCLUDED.cost_usd,
        runs_rejected=EXCLUDED.runs_rejected,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [
      row.scope_key,
      row.date_ymd,
      Number(row.tokens_used ?? 0),
      Number(row.cost_usd ?? 0),
      Number(row.runs_rejected ?? 0),
      row.updated_at ?? new Date().toISOString()
    ]
  },
  {
    table: "audit_logs",
    sql: "SELECT * FROM audit_logs",
    insert: `
      INSERT INTO audit_logs (
        id, tenant_id, workspace_id, action, actor, resource_type, resource_id, metadata_json, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
      ON CONFLICT(id) DO UPDATE SET
        tenant_id=EXCLUDED.tenant_id,
        workspace_id=EXCLUDED.workspace_id,
        action=EXCLUDED.action,
        actor=EXCLUDED.actor,
        resource_type=EXCLUDED.resource_type,
        resource_id=EXCLUDED.resource_id,
        metadata_json=EXCLUDED.metadata_json,
        created_at=EXCLUDED.created_at
    `,
    map: (row) => [
      Number(row.id),
      row.tenant_id,
      row.workspace_id,
      row.action,
      row.actor,
      row.resource_type ?? null,
      row.resource_id ?? null,
      row.metadata_json ?? "{}",
      row.created_at ?? new Date().toISOString()
    ]
  },
  {
    table: "model_secrets",
    sql: "SELECT * FROM model_secrets",
    insert: `
      INSERT INTO model_secrets (
        tenant_id, workspace_id, provider, model_id, base_url, api_key, updated_by, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(tenant_id, workspace_id, provider) DO UPDATE SET
        model_id=EXCLUDED.model_id,
        base_url=EXCLUDED.base_url,
        api_key=EXCLUDED.api_key,
        updated_by=EXCLUDED.updated_by,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [
      row.tenant_id,
      row.workspace_id ?? null,
      row.provider,
      row.model_id ?? null,
      row.base_url ?? null,
      row.api_key,
      row.updated_by,
      row.updated_at ?? new Date().toISOString()
    ]
  },
  {
    table: "tenants",
    sql: "SELECT * FROM tenants",
    insert: `
      INSERT INTO tenants (id, code, name, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(id) DO UPDATE SET
        code=EXCLUDED.code,
        name=EXCLUDED.name,
        status=EXCLUDED.status,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [row.id, row.code, row.name, row.status ?? "active", row.created_at ?? new Date().toISOString(), row.updated_at ?? new Date().toISOString()]
  },
  {
    table: "users",
    sql: "SELECT * FROM users",
    insert: `
      INSERT INTO users (
        id, username, display_name, email, status, source, external_subject, password_hash, created_at, updated_at, last_login_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(id) DO UPDATE SET
        username=EXCLUDED.username,
        display_name=EXCLUDED.display_name,
        email=EXCLUDED.email,
        status=EXCLUDED.status,
        source=EXCLUDED.source,
        external_subject=EXCLUDED.external_subject,
        password_hash=EXCLUDED.password_hash,
        updated_at=EXCLUDED.updated_at,
        last_login_at=EXCLUDED.last_login_at
    `,
    map: (row) => [
      row.id,
      row.username,
      row.display_name ?? null,
      row.email ?? null,
      row.status ?? "active",
      row.source ?? "local",
      row.external_subject ?? null,
      row.password_hash ?? null,
      row.created_at ?? new Date().toISOString(),
      row.updated_at ?? new Date().toISOString(),
      row.last_login_at ?? null
    ]
  },
  {
    table: "user_tenants",
    sql: "SELECT * FROM user_tenants",
    insert: `
      INSERT INTO user_tenants (tenant_id, user_id, default_workspace_id, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(tenant_id, user_id) DO UPDATE SET
        default_workspace_id=EXCLUDED.default_workspace_id,
        status=EXCLUDED.status,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [
      row.tenant_id,
      row.user_id,
      row.default_workspace_id,
      row.status ?? "active",
      row.created_at ?? new Date().toISOString(),
      row.updated_at ?? new Date().toISOString()
    ]
  },
  {
    table: "workspace_memberships",
    sql: "SELECT * FROM workspace_memberships",
    insert: `
      INSERT INTO workspace_memberships (tenant_id, workspace_id, user_id, role, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(tenant_id, workspace_id, user_id) DO UPDATE SET
        role=EXCLUDED.role,
        updated_at=EXCLUDED.updated_at
    `,
    map: (row) => [
      row.tenant_id,
      row.workspace_id,
      row.user_id,
      row.role ?? "member",
      row.created_at ?? new Date().toISOString(),
      row.updated_at ?? new Date().toISOString()
    ]
  },
  {
    table: "auth_identities",
    sql: "SELECT * FROM auth_identities",
    insert: `
      INSERT INTO auth_identities (provider, subject, tenant_id, user_id, claims_json, last_seen_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT(provider, subject, tenant_id) DO UPDATE SET
        user_id=EXCLUDED.user_id,
        claims_json=EXCLUDED.claims_json,
        last_seen_at=EXCLUDED.last_seen_at
    `,
    map: (row) => [row.provider, row.subject, row.tenant_id, row.user_id, row.claims_json ?? "{}", row.last_seen_at ?? new Date().toISOString()]
  },
  {
    table: "refresh_tokens",
    sql: "SELECT * FROM refresh_tokens",
    insert: `
      INSERT INTO refresh_tokens (token_id, user_id, tenant_id, expires_at, revoked_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(token_id) DO UPDATE SET
        user_id=EXCLUDED.user_id,
        tenant_id=EXCLUDED.tenant_id,
        expires_at=EXCLUDED.expires_at,
        revoked_at=EXCLUDED.revoked_at,
        created_at=EXCLUDED.created_at
    `,
    map: (row) => [row.token_id, row.user_id, row.tenant_id, row.expires_at, row.revoked_at ?? null, row.created_at ?? new Date().toISOString()]
  }
];

for (const item of migrations) {
  const rows = readSqliteRows(sqlitePath, item.sql);
  if (!rows) {
    report.tables[item.table] = {
      skipped: true,
      reason: "missing_table"
    };
    continue;
  }

  let migrated = 0;
  for (const row of rows) {
    await pool.query(item.insert, item.map(row));
    migrated += 1;
  }
  report.tables[item.table] = {
    rows: rows.length,
    migrated
  };
}

await pool.query(`SELECT setval(pg_get_serial_sequence('transcript', 'id'), COALESCE((SELECT MAX(id) FROM transcript), 1), true)`);
await pool.query(`SELECT setval(pg_get_serial_sequence('run_metrics', 'id'), COALESCE((SELECT MAX(id) FROM run_metrics), 1), true)`);
await pool.query(`SELECT setval(pg_get_serial_sequence('audit_logs', 'id'), COALESCE((SELECT MAX(id) FROM audit_logs), 1), true)`);

await pool.query(
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
    "t_default",
    "w_default",
    "migration.sqlite_to_pg",
    "migration-script",
    "migration",
    "sqlite_to_pg",
    JSON.stringify({
      sqlitePath,
      report: report.tables
    }),
    new Date().toISOString()
  ]
);

await pool.end();

report.finishedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));

function resolveSqlitePath(value) {
  const input = typeof value === "string" && value.trim().length > 0 ? value.trim() : ".openfoal/gateway.sqlite";
  if (input === ":memory:") {
    return input;
  }
  return resolve(input);
}

async function ensurePostgresSchemas(connectionString) {
  const sessionRepo = new PostgresSessionRepository({ connectionString });
  const agentRepo = new PostgresAgentRepository({ connectionString });
  const authStore = new PostgresAuthStore({ connectionString });
  await sessionRepo.list({ tenantId: "t_default", workspaceId: "w_default" });
  await agentRepo.list({ tenantId: "t_default" });
  await authStore.ensureTenant({ code: "default", name: "Default Tenant" });
}

function readSqliteRows(path, sql) {
  const result = spawnSync("sqlite3", ["-json", path, sql], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    if (stderr.includes("no such table")) {
      return undefined;
    }
    throw new Error(`sqlite query failed: ${stderr}`);
  }
  const text = String(result.stdout ?? "").trim();
  if (!text) {
    return [];
  }
  return JSON.parse(text);
}
