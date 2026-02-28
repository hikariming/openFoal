import type { Pool } from "pg";
import {
  ensurePostgresSchemaOnce,
  getPostgresPool,
  nowIso,
  resolvePostgresUrl,
  sanitizeScopeId
} from "./postgres-shared.js";
import type {
  AuthStore,
  MembershipRole,
  RefreshTokenRecord,
  TenantRecord,
  TenantUserRecord,
  UserRecord,
  UserTenantRecord,
  WorkspaceMembershipRecord
} from "./auth.js";

const AUTH_SCHEMA_KEY = "openfoal-storage-auth-v1";

interface PostgresAuthOptions {
  connectionString?: string;
}

export class PostgresAuthStore implements AuthStore {
  private readonly connectionString: string;
  private readonly pool: Pool;

  constructor(options: PostgresAuthOptions = {}) {
    this.connectionString = resolvePostgresUrl(options.connectionString);
    this.pool = getPostgresPool(this.connectionString);
  }

  async ensureTenant(input: { code: string; name?: string }): Promise<TenantRecord> {
    await this.ready();
    const code = sanitizeScopeId(input.code, "default");
    const existing = await this.findTenantByCode(code);
    if (existing) {
      return existing;
    }
    const createdAt = nowIso();
    const tenantId = code === "default" ? "t_default" : randomId("t");
    await this.pool.query(
      `
        INSERT INTO tenants (id, code, name, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(code) DO NOTHING
      `,
      [tenantId, code, sanitizeName(input.name, code), "active", createdAt, createdAt]
    );
    return (await this.findTenantByCode(code))!;
  }

  async findTenantByCode(code: string): Promise<TenantRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          id,
          code,
          name,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM tenants
        WHERE code = $1
        LIMIT 1
      `,
      [sanitizeScopeId(code, "")]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeTenant(result.rows[0]);
  }

  async findTenantById(id: string): Promise<TenantRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          id,
          code,
          name,
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM tenants
        WHERE id = $1
        LIMIT 1
      `,
      [sanitizeScopeId(id, "")]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeTenant(result.rows[0]);
  }

  async upsertLocalUser(input: {
    tenantId: string;
    username: string;
    passwordHash: string;
    displayName?: string;
    email?: string;
    defaultWorkspaceId?: string;
    role?: MembershipRole;
  }): Promise<UserRecord> {
    await this.ready();
    const tenantId = sanitizeScopeId(input.tenantId, "t_default");
    const username = sanitizeScopeId(input.username, "admin");
    const now = nowIso();
    const existing = await this.findLocalUser(tenantId, username);
    const userId = existing?.id ?? randomId("u");
    await this.pool.query(
      `
        INSERT INTO users (
          id,
          username,
          display_name,
          email,
          status,
          source,
          external_subject,
          password_hash,
          created_at,
          updated_at,
          last_login_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(id) DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          status = EXCLUDED.status,
          source = EXCLUDED.source,
          external_subject = EXCLUDED.external_subject,
          password_hash = EXCLUDED.password_hash,
          updated_at = EXCLUDED.updated_at
      `,
      [
        userId,
        username,
        input.displayName ?? null,
        input.email ?? null,
        "active",
        "local",
        null,
        input.passwordHash,
        existing?.createdAt ?? now,
        now,
        existing?.lastLoginAt ?? null
      ]
    );

    await this.linkUserTenant({
      tenantId,
      userId,
      defaultWorkspaceId: input.defaultWorkspaceId ?? "w_default",
      status: "active"
    });

    await this.upsertWorkspaceMembership({
      tenantId,
      workspaceId: input.defaultWorkspaceId ?? "w_default",
      userId,
      role: input.role ?? "tenant_admin"
    });

    return (await this.findUserById(userId))!;
  }

  async findLocalUser(tenantId: string, username: string): Promise<UserRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          u.id,
          u.username,
          u.display_name AS "displayName",
          u.email,
          u.status,
          u.source,
          u.external_subject AS "externalSubject",
          u.password_hash AS "passwordHash",
          u.created_at AS "createdAt",
          u.updated_at AS "updatedAt",
          u.last_login_at AS "lastLoginAt"
        FROM users u
        INNER JOIN user_tenants ut
          ON ut.user_id = u.id
        WHERE ut.tenant_id = $1
          AND u.username = $2
          AND u.source = 'local'
        LIMIT 1
      `,
      [sanitizeScopeId(tenantId, ""), sanitizeScopeId(username, "")]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeUser(result.rows[0]);
  }

  async findUserById(userId: string): Promise<UserRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          id,
          username,
          display_name AS "displayName",
          email,
          status,
          source,
          external_subject AS "externalSubject",
          password_hash AS "passwordHash",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_login_at AS "lastLoginAt"
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [sanitizeScopeId(userId, "")]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeUser(result.rows[0]);
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.ready();
    const now = nowIso();
    await this.pool.query(
      `
        UPDATE users
        SET last_login_at = $1,
            updated_at = $2
        WHERE id = $3
      `,
      [now, now, sanitizeScopeId(userId, "")]
    );
  }

  async upsertExternalIdentity(input: {
    provider: string;
    subject: string;
    tenantId: string;
    username: string;
    displayName?: string;
    email?: string;
    claims: Record<string, unknown>;
    defaultWorkspaceId?: string;
    role?: MembershipRole;
  }): Promise<UserRecord> {
    await this.ready();
    const provider = sanitizeScopeId(input.provider, "external");
    const subject = sanitizeScopeId(input.subject, "");
    const tenantId = sanitizeScopeId(input.tenantId, "t_default");
    const now = nowIso();

    const existingIdentity = await this.pool.query(
      `
        SELECT user_id AS "userId"
        FROM auth_identities
        WHERE provider = $1
          AND subject = $2
          AND tenant_id = $3
        LIMIT 1
      `,
      [provider, subject, tenantId]
    );
    const userId = existingIdentity.rows[0]?.userId ? String(existingIdentity.rows[0].userId) : randomId("u");
    const existingUser = await this.findUserById(userId);

    await this.pool.query(
      `
        INSERT INTO users (
          id,
          username,
          display_name,
          email,
          status,
          source,
          external_subject,
          password_hash,
          created_at,
          updated_at,
          last_login_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(id) DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          status = EXCLUDED.status,
          source = EXCLUDED.source,
          external_subject = EXCLUDED.external_subject,
          updated_at = EXCLUDED.updated_at
      `,
      [
        userId,
        sanitizeScopeId(input.username, `ext_${subject}`),
        input.displayName ?? null,
        input.email ?? null,
        "active",
        "external",
        subject,
        null,
        existingUser?.createdAt ?? now,
        now,
        existingUser?.lastLoginAt ?? null
      ]
    );

    await this.pool.query(
      `
        INSERT INTO auth_identities (
          provider,
          subject,
          tenant_id,
          user_id,
          claims_json,
          last_seen_at
        )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6)
        ON CONFLICT(provider, subject, tenant_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          claims_json = EXCLUDED.claims_json,
          last_seen_at = EXCLUDED.last_seen_at
      `,
      [provider, subject, tenantId, userId, JSON.stringify(input.claims ?? {}), now]
    );

    await this.linkUserTenant({
      tenantId,
      userId,
      defaultWorkspaceId: input.defaultWorkspaceId ?? "w_default",
      status: "active"
    });

    await this.upsertWorkspaceMembership({
      tenantId,
      workspaceId: input.defaultWorkspaceId ?? "w_default",
      userId,
      role: input.role ?? "member"
    });

    return (await this.findUserById(userId))!;
  }

  async linkUserTenant(input: {
    tenantId: string;
    userId: string;
    defaultWorkspaceId?: string;
    status?: "active" | "disabled";
  }): Promise<UserTenantRecord> {
    await this.ready();
    const tenantId = sanitizeScopeId(input.tenantId, "t_default");
    const userId = sanitizeScopeId(input.userId, "");
    const existing = await this.getUserTenant(tenantId, userId);
    const now = nowIso();
    await this.pool.query(
      `
        INSERT INTO user_tenants (
          tenant_id,
          user_id,
          default_workspace_id,
          status,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(tenant_id, user_id) DO UPDATE SET
          default_workspace_id = EXCLUDED.default_workspace_id,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `,
      [
        tenantId,
        userId,
        sanitizeScopeId(input.defaultWorkspaceId ?? existing?.defaultWorkspaceId, "w_default"),
        input.status ?? existing?.status ?? "active",
        existing?.createdAt ?? now,
        now
      ]
    );
    return (await this.getUserTenant(tenantId, userId))!;
  }

  async getUserTenant(tenantId: string, userId: string): Promise<UserTenantRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          tenant_id AS "tenantId",
          user_id AS "userId",
          default_workspace_id AS "defaultWorkspaceId",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM user_tenants
        WHERE tenant_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [sanitizeScopeId(tenantId, ""), sanitizeScopeId(userId, "")]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeUserTenant(result.rows[0]);
  }

  async upsertWorkspaceMembership(input: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<WorkspaceMembershipRecord> {
    await this.ready();
    const tenantId = sanitizeScopeId(input.tenantId, "t_default");
    const workspaceId = sanitizeScopeId(input.workspaceId, "w_default");
    const userId = sanitizeScopeId(input.userId, "");
    const existing = await this.pool.query(
      `
        SELECT created_at AS "createdAt"
        FROM workspace_memberships
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND user_id = $3
        LIMIT 1
      `,
      [tenantId, workspaceId, userId]
    );
    const now = nowIso();
    await this.pool.query(
      `
        INSERT INTO workspace_memberships (
          tenant_id,
          workspace_id,
          user_id,
          role,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(tenant_id, workspace_id, user_id) DO UPDATE SET
          role = EXCLUDED.role,
          updated_at = EXCLUDED.updated_at
      `,
      [tenantId, workspaceId, userId, normalizeRole(input.role), existing.rows[0]?.createdAt ?? now, now]
    );

    const all = await this.listWorkspaceMemberships(tenantId, userId);
    return all.find((item) => item.workspaceId === workspaceId)!;
  }

  async listWorkspaceMemberships(tenantId: string, userId: string): Promise<WorkspaceMembershipRecord[]> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          tenant_id AS "tenantId",
          workspace_id AS "workspaceId",
          user_id AS "userId",
          role,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workspace_memberships
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY workspace_id ASC
      `,
      [sanitizeScopeId(tenantId, ""), sanitizeScopeId(userId, "")]
    );
    return result.rows.map((row: any) => normalizeMembership(row));
  }

  async replaceWorkspaceMemberships(input: {
    tenantId: string;
    userId: string;
    memberships: Array<{
      workspaceId: string;
      role: MembershipRole;
    }>;
  }): Promise<WorkspaceMembershipRecord[]> {
    await this.ready();
    const tenantId = sanitizeScopeId(input.tenantId, "t_default");
    const userId = sanitizeScopeId(input.userId, "");
    const normalized = normalizeMembershipInputs(input.memberships);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM workspace_memberships
          WHERE tenant_id = $1
            AND user_id = $2
        `,
        [tenantId, userId]
      );

      for (const membership of normalized) {
        await client.query(
          `
            INSERT INTO workspace_memberships (
              tenant_id,
              workspace_id,
              user_id,
              role,
              created_at,
              updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT(tenant_id, workspace_id, user_id) DO UPDATE SET
              role = EXCLUDED.role,
              updated_at = EXCLUDED.updated_at
          `,
          [tenantId, membership.workspaceId, userId, membership.role, nowIso(), nowIso()]
        );
      }

      await client.query(
        `
          INSERT INTO user_tenants (
            tenant_id,
            user_id,
            default_workspace_id,
            status,
            created_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT(tenant_id, user_id) DO UPDATE SET
            default_workspace_id = EXCLUDED.default_workspace_id,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        `,
        [tenantId, userId, normalized[0].workspaceId, "active", nowIso(), nowIso()]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return await this.listWorkspaceMemberships(tenantId, userId);
  }

  async listTenantUsers(tenantId: string): Promise<TenantUserRecord[]> {
    await this.ready();
    const normalizedTenantId = sanitizeScopeId(tenantId, "t_default");
    const result = await this.pool.query(
      `
        SELECT
          ut.tenant_id AS "tenantId",
          ut.user_id AS "userId",
          ut.default_workspace_id AS "defaultWorkspaceId",
          ut.status AS "tenantStatus",
          ut.created_at AS "tenantCreatedAt",
          ut.updated_at AS "tenantUpdatedAt",
          u.id,
          u.username,
          u.display_name AS "displayName",
          u.email,
          u.status AS "userStatus",
          u.source,
          u.external_subject AS "externalSubject",
          u.password_hash AS "passwordHash",
          u.created_at AS "userCreatedAt",
          u.updated_at AS "userUpdatedAt",
          u.last_login_at AS "lastLoginAt"
        FROM user_tenants ut
        INNER JOIN users u
          ON u.id = ut.user_id
        WHERE ut.tenant_id = $1
        ORDER BY u.username ASC
      `,
      [normalizedTenantId]
    );

    const out: TenantUserRecord[] = [];
    for (const row of result.rows) {
      out.push({
        user: normalizeUser({
          id: row.id,
          username: row.username,
          displayName: row.displayName,
          email: row.email,
          status: row.userStatus,
          source: row.source,
          externalSubject: row.externalSubject,
          passwordHash: row.passwordHash,
          createdAt: row.userCreatedAt,
          updatedAt: row.userUpdatedAt,
          lastLoginAt: row.lastLoginAt
        }),
        tenant: normalizeUserTenant({
          tenantId: row.tenantId,
          userId: row.userId,
          defaultWorkspaceId: row.defaultWorkspaceId,
          status: row.tenantStatus,
          createdAt: row.tenantCreatedAt,
          updatedAt: row.tenantUpdatedAt
        }),
        memberships: await this.listWorkspaceMemberships(String(row.tenantId), String(row.userId))
      });
    }
    return out;
  }

  async updateUserStatus(input: {
    tenantId: string;
    userId: string;
    status: "active" | "disabled";
  }): Promise<UserRecord | undefined> {
    await this.ready();
    const tenantId = sanitizeScopeId(input.tenantId, "t_default");
    const userId = sanitizeScopeId(input.userId, "");
    const existing = await this.getUserTenant(tenantId, userId);
    if (!existing) {
      return undefined;
    }
    const now = nowIso();
    await this.pool.query(
      `
        UPDATE user_tenants
        SET status = $1,
            updated_at = $2
        WHERE tenant_id = $3
          AND user_id = $4
      `,
      [input.status, now, tenantId, userId]
    );
    await this.pool.query(
      `
        UPDATE users
        SET status = $1,
            updated_at = $2
        WHERE id = $3
      `,
      [input.status, now, userId]
    );
    return await this.findUserById(userId);
  }

  async setLocalUserPassword(input: {
    tenantId: string;
    userId: string;
    passwordHash: string;
  }): Promise<UserRecord | undefined> {
    await this.ready();
    const tenantId = sanitizeScopeId(input.tenantId, "t_default");
    const userId = sanitizeScopeId(input.userId, "");
    const existing = await this.getUserTenant(tenantId, userId);
    if (!existing) {
      return undefined;
    }

    await this.pool.query(
      `
        UPDATE users
        SET password_hash = $1,
            updated_at = $2
        WHERE id = $3
          AND source = 'local'
      `,
      [input.passwordHash, nowIso(), userId]
    );

    const updated = await this.findUserById(userId);
    if (!updated || updated.source !== "local") {
      return undefined;
    }
    return updated;
  }

  async createRefreshToken(input: {
    tokenId: string;
    userId: string;
    tenantId: string;
    expiresAt: string;
  }): Promise<RefreshTokenRecord> {
    await this.ready();
    const now = nowIso();
    await this.pool.query(
      `
        INSERT INTO refresh_tokens (
          token_id,
          user_id,
          tenant_id,
          expires_at,
          revoked_at,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(token_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          tenant_id = EXCLUDED.tenant_id,
          expires_at = EXCLUDED.expires_at,
          revoked_at = EXCLUDED.revoked_at,
          created_at = EXCLUDED.created_at
      `,
      [
        sanitizeScopeId(input.tokenId, ""),
        sanitizeScopeId(input.userId, ""),
        sanitizeScopeId(input.tenantId, "t_default"),
        input.expiresAt,
        null,
        now
      ]
    );
    return (await this.getRefreshToken(input.tokenId))!;
  }

  async getRefreshToken(tokenId: string): Promise<RefreshTokenRecord | undefined> {
    await this.ready();
    const result = await this.pool.query(
      `
        SELECT
          token_id AS "tokenId",
          user_id AS "userId",
          tenant_id AS "tenantId",
          expires_at AS "expiresAt",
          revoked_at AS "revokedAt",
          created_at AS "createdAt"
        FROM refresh_tokens
        WHERE token_id = $1
        LIMIT 1
      `,
      [sanitizeScopeId(tokenId, "")]
    );
    if (result.rows.length === 0) {
      return undefined;
    }
    return normalizeRefreshToken(result.rows[0]);
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    await this.ready();
    await this.pool.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = $1
        WHERE token_id = $2
      `,
      [nowIso(), sanitizeScopeId(tokenId, "")]
    );
  }

  private async ready(): Promise<void> {
    await ensurePostgresAuthSchema(this.connectionString, this.pool);
  }
}

async function ensurePostgresAuthSchema(url: string, pool: Pool): Promise<void> {
  await ensurePostgresSchemaOnce(url, AUTH_SCHEMA_KEY, async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL,
        external_subject TEXT,
        password_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS user_tenants (
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        default_workspace_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS workspace_memberships (
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS auth_identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        claims_json JSONB NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (provider, subject, tenant_id)
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_source_subject
      ON users(source, external_subject);
      CREATE INDEX IF NOT EXISTS idx_user_tenants_user
      ON user_tenants(user_id, tenant_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user
      ON workspace_memberships(user_id, tenant_id, workspace_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
      ON refresh_tokens(user_id, tenant_id, expires_at);
    `);

    const now = nowIso();
    await pool.query(
      `
        INSERT INTO tenants (id, code, name, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(id) DO NOTHING
      `,
      ["t_default", "default", "Default Tenant", "active", now, now]
    );
  });
}

function normalizeTenant(value: Record<string, unknown>): TenantRecord {
  return {
    id: String(value.id ?? ""),
    code: String(value.code ?? ""),
    name: String(value.name ?? ""),
    status: value.status === "disabled" ? "disabled" : "active",
    createdAt: String(value.createdAt ?? nowIso()),
    updatedAt: String(value.updatedAt ?? nowIso())
  };
}

function normalizeUser(value: Record<string, unknown>): UserRecord {
  return {
    id: String(value.id ?? ""),
    username: String(value.username ?? ""),
    ...(typeof value.displayName === "string" && value.displayName.length > 0 ? { displayName: value.displayName } : {}),
    ...(typeof value.email === "string" && value.email.length > 0 ? { email: value.email } : {}),
    status: value.status === "disabled" ? "disabled" : "active",
    source: value.source === "external" ? "external" : "local",
    ...(typeof value.externalSubject === "string" && value.externalSubject.length > 0
      ? { externalSubject: value.externalSubject }
      : {}),
    ...(typeof value.passwordHash === "string" && value.passwordHash.length > 0 ? { passwordHash: value.passwordHash } : {}),
    createdAt: String(value.createdAt ?? nowIso()),
    updatedAt: String(value.updatedAt ?? nowIso()),
    ...(typeof value.lastLoginAt === "string" && value.lastLoginAt.length > 0 ? { lastLoginAt: value.lastLoginAt } : {})
  };
}

function normalizeUserTenant(value: Record<string, unknown>): UserTenantRecord {
  return {
    tenantId: sanitizeScopeId(value.tenantId, "t_default"),
    userId: sanitizeScopeId(value.userId, ""),
    defaultWorkspaceId: sanitizeScopeId(value.defaultWorkspaceId, "w_default"),
    status: value.status === "disabled" ? "disabled" : "active",
    createdAt: String(value.createdAt ?? nowIso()),
    updatedAt: String(value.updatedAt ?? nowIso())
  };
}

function normalizeMembership(value: Record<string, unknown>): WorkspaceMembershipRecord {
  return {
    tenantId: sanitizeScopeId(value.tenantId, "t_default"),
    workspaceId: sanitizeScopeId(value.workspaceId, "w_default"),
    userId: sanitizeScopeId(value.userId, ""),
    role: normalizeRole(value.role),
    createdAt: String(value.createdAt ?? nowIso()),
    updatedAt: String(value.updatedAt ?? nowIso())
  };
}

function normalizeRefreshToken(value: Record<string, unknown>): RefreshTokenRecord {
  return {
    tokenId: String(value.tokenId ?? ""),
    userId: sanitizeScopeId(value.userId, ""),
    tenantId: sanitizeScopeId(value.tenantId, "t_default"),
    expiresAt: String(value.expiresAt ?? nowIso()),
    ...(typeof value.revokedAt === "string" && value.revokedAt.length > 0 ? { revokedAt: value.revokedAt } : {}),
    createdAt: String(value.createdAt ?? nowIso())
  };
}

function normalizeRole(value: unknown): MembershipRole {
  if (value === "tenant_admin" || value === "workspace_admin") {
    return value;
  }
  return "member";
}

function normalizeMembershipInputs(
  memberships: Array<{
    workspaceId: string;
    role: MembershipRole;
  }>
): Array<{
  workspaceId: string;
  role: MembershipRole;
}> {
  const out: Array<{
    workspaceId: string;
    role: MembershipRole;
  }> = [];
  const seen = new Set<string>();
  for (const entry of memberships) {
    const workspaceId = sanitizeScopeId(entry.workspaceId, "");
    if (!workspaceId || seen.has(workspaceId)) {
      continue;
    }
    seen.add(workspaceId);
    out.push({
      workspaceId,
      role: normalizeRole(entry.role)
    });
  }
  if (out.length === 0) {
    out.push({
      workspaceId: "w_default",
      role: "member"
    });
  }
  return out;
}

function sanitizeName(value: unknown, fallback: string): string {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return fallback;
  }
  return compact.slice(0, 80);
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}
