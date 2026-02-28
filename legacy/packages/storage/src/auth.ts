// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { spawnSync } from "node:child_process";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { mkdirSync } from "node:fs";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { dirname, resolve } from "node:path";

declare const process: any;

export type AuthSource = "local" | "external";
export type MembershipRole = "tenant_admin" | "workspace_admin" | "member";

export interface TenantRecord {
  id: string;
  code: string;
  name: string;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  status: "active" | "disabled";
  source: AuthSource;
  externalSubject?: string;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface UserTenantRecord {
  tenantId: string;
  userId: string;
  defaultWorkspaceId: string;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembershipRecord {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role: MembershipRole;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUserRecord {
  user: UserRecord;
  tenant: UserTenantRecord;
  memberships: WorkspaceMembershipRecord[];
}

export interface AuthIdentityRecord {
  provider: string;
  subject: string;
  tenantId: string;
  userId: string;
  claims: Record<string, unknown>;
  lastSeenAt: string;
}

export interface RefreshTokenRecord {
  tokenId: string;
  userId: string;
  tenantId: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
}

export interface AuthStore {
  ensureTenant(input: { code: string; name?: string }): Promise<TenantRecord>;
  findTenantByCode(code: string): Promise<TenantRecord | undefined>;
  findTenantById(id: string): Promise<TenantRecord | undefined>;

  upsertLocalUser(input: {
    tenantId: string;
    username: string;
    passwordHash: string;
    displayName?: string;
    email?: string;
    defaultWorkspaceId?: string;
    role?: MembershipRole;
  }): Promise<UserRecord>;
  findLocalUser(tenantId: string, username: string): Promise<UserRecord | undefined>;
  findUserById(userId: string): Promise<UserRecord | undefined>;
  touchLastLogin(userId: string): Promise<void>;

  upsertExternalIdentity(input: {
    provider: string;
    subject: string;
    tenantId: string;
    username: string;
    displayName?: string;
    email?: string;
    claims: Record<string, unknown>;
    defaultWorkspaceId?: string;
    role?: MembershipRole;
  }): Promise<UserRecord>;

  linkUserTenant(input: {
    tenantId: string;
    userId: string;
    defaultWorkspaceId?: string;
    status?: "active" | "disabled";
  }): Promise<UserTenantRecord>;
  getUserTenant(tenantId: string, userId: string): Promise<UserTenantRecord | undefined>;

  upsertWorkspaceMembership(input: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<WorkspaceMembershipRecord>;
  listWorkspaceMemberships(tenantId: string, userId: string): Promise<WorkspaceMembershipRecord[]>;
  replaceWorkspaceMemberships(input: {
    tenantId: string;
    userId: string;
    memberships: Array<{
      workspaceId: string;
      role: MembershipRole;
    }>;
  }): Promise<WorkspaceMembershipRecord[]>;
  listTenantUsers(tenantId: string): Promise<TenantUserRecord[]>;
  updateUserStatus(input: {
    tenantId: string;
    userId: string;
    status: "active" | "disabled";
  }): Promise<UserRecord | undefined>;
  setLocalUserPassword(input: {
    tenantId: string;
    userId: string;
    passwordHash: string;
  }): Promise<UserRecord | undefined>;

  createRefreshToken(input: {
    tokenId: string;
    userId: string;
    tenantId: string;
    expiresAt: string;
  }): Promise<RefreshTokenRecord>;
  getRefreshToken(tokenId: string): Promise<RefreshTokenRecord | undefined>;
  revokeRefreshToken(tokenId: string): Promise<void>;
}

export class InMemoryAuthStore implements AuthStore {
  private readonly tenantsByCode = new Map<string, TenantRecord>();
  private readonly tenantsById = new Map<string, TenantRecord>();
  private readonly usersById = new Map<string, UserRecord>();
  private readonly localUserIndex = new Map<string, string>();
  private readonly userTenants = new Map<string, UserTenantRecord>();
  private readonly memberships = new Map<string, WorkspaceMembershipRecord>();
  private readonly identities = new Map<string, AuthIdentityRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  constructor() {
    const now = nowIso();
    const tenant: TenantRecord = {
      id: "t_default",
      code: "default",
      name: "Default Tenant",
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    this.tenantsByCode.set(tenant.code, tenant);
    this.tenantsById.set(tenant.id, tenant);
  }

  async ensureTenant(input: { code: string; name?: string }): Promise<TenantRecord> {
    const code = sanitizeId(input.code, "default");
    const existing = this.tenantsByCode.get(code);
    if (existing) {
      return cloneTenant(existing);
    }
    const now = nowIso();
    const created: TenantRecord = {
      id: code === "default" ? "t_default" : `t_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
      code,
      name: sanitizeName(input.name, code),
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    this.tenantsByCode.set(created.code, created);
    this.tenantsById.set(created.id, created);
    return cloneTenant(created);
  }

  async findTenantByCode(code: string): Promise<TenantRecord | undefined> {
    const found = this.tenantsByCode.get(sanitizeId(code, ""));
    return found ? cloneTenant(found) : undefined;
  }

  async findTenantById(id: string): Promise<TenantRecord | undefined> {
    const found = this.tenantsById.get(sanitizeId(id, ""));
    return found ? cloneTenant(found) : undefined;
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
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const username = sanitizeId(input.username, "admin");
    const now = nowIso();
    const key = localUserKey(tenantId, username);
    const userId = this.localUserIndex.get(key);
    let user: UserRecord;

    if (userId) {
      const current = this.usersById.get(userId)!;
      user = {
        ...current,
        passwordHash: input.passwordHash,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.email ? { email: input.email } : {}),
        updatedAt: now
      };
    } else {
      user = {
        id: `u_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
        username,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.email ? { email: input.email } : {}),
        status: "active",
        source: "local",
        passwordHash: input.passwordHash,
        createdAt: now,
        updatedAt: now
      };
      this.localUserIndex.set(key, user.id);
    }

    this.usersById.set(user.id, user);
    await this.linkUserTenant({
      tenantId,
      userId: user.id,
      defaultWorkspaceId: input.defaultWorkspaceId ?? "w_default",
      status: "active"
    });
    await this.upsertWorkspaceMembership({
      tenantId,
      workspaceId: input.defaultWorkspaceId ?? "w_default",
      userId: user.id,
      role: input.role ?? "tenant_admin"
    });
    return cloneUser(user);
  }

  async findLocalUser(tenantId: string, username: string): Promise<UserRecord | undefined> {
    const key = localUserKey(tenantId, username);
    const userId = this.localUserIndex.get(key);
    if (!userId) {
      return undefined;
    }
    const user = this.usersById.get(userId);
    if (!user || user.source !== "local") {
      return undefined;
    }
    return cloneUser(user);
  }

  async findUserById(userId: string): Promise<UserRecord | undefined> {
    const found = this.usersById.get(sanitizeId(userId, ""));
    return found ? cloneUser(found) : undefined;
  }

  async touchLastLogin(userId: string): Promise<void> {
    const key = sanitizeId(userId, "");
    const user = this.usersById.get(key);
    if (!user) {
      return;
    }
    this.usersById.set(key, {
      ...user,
      lastLoginAt: nowIso(),
      updatedAt: nowIso()
    });
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
    const provider = sanitizeId(input.provider, "external");
    const subject = sanitizeId(input.subject, "");
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const identityKey = externalIdentityKey(provider, subject, tenantId);
    const existingIdentity = this.identities.get(identityKey);
    const now = nowIso();
    let user: UserRecord | undefined = existingIdentity ? this.usersById.get(existingIdentity.userId) : undefined;

    if (!user) {
      user = {
        id: `u_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
        username: sanitizeId(input.username, `ext_${subject}`),
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.email ? { email: input.email } : {}),
        status: "active",
        source: "external",
        externalSubject: subject,
        createdAt: now,
        updatedAt: now
      };
    } else {
      user = {
        ...user,
        username: sanitizeId(input.username, user.username),
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.email ? { email: input.email } : {}),
        externalSubject: subject,
        updatedAt: now
      };
    }

    this.usersById.set(user.id, user);
    this.identities.set(identityKey, {
      provider,
      subject,
      tenantId,
      userId: user.id,
      claims: { ...input.claims },
      lastSeenAt: now
    });

    await this.linkUserTenant({
      tenantId,
      userId: user.id,
      defaultWorkspaceId: input.defaultWorkspaceId ?? "w_default",
      status: "active"
    });
    await this.upsertWorkspaceMembership({
      tenantId,
      workspaceId: input.defaultWorkspaceId ?? "w_default",
      userId: user.id,
      role: input.role ?? "member"
    });
    return cloneUser(user);
  }

  async linkUserTenant(input: {
    tenantId: string;
    userId: string;
    defaultWorkspaceId?: string;
    status?: "active" | "disabled";
  }): Promise<UserTenantRecord> {
    const key = userTenantKey(input.tenantId, input.userId);
    const now = nowIso();
    const existing = this.userTenants.get(key);
    const next: UserTenantRecord = {
      tenantId: sanitizeId(input.tenantId, "t_default"),
      userId: sanitizeId(input.userId, ""),
      defaultWorkspaceId: sanitizeId(input.defaultWorkspaceId ?? existing?.defaultWorkspaceId, "w_default"),
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.userTenants.set(key, next);
    return cloneUserTenant(next);
  }

  async getUserTenant(tenantId: string, userId: string): Promise<UserTenantRecord | undefined> {
    const found = this.userTenants.get(userTenantKey(tenantId, userId));
    return found ? cloneUserTenant(found) : undefined;
  }

  async upsertWorkspaceMembership(input: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<WorkspaceMembershipRecord> {
    const key = workspaceMembershipKey(input.tenantId, input.workspaceId, input.userId);
    const now = nowIso();
    const existing = this.memberships.get(key);
    const next: WorkspaceMembershipRecord = {
      tenantId: sanitizeId(input.tenantId, "t_default"),
      workspaceId: sanitizeId(input.workspaceId, "w_default"),
      userId: sanitizeId(input.userId, ""),
      role: normalizeRole(input.role),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.memberships.set(key, next);
    return cloneMembership(next);
  }

  async listWorkspaceMemberships(tenantId: string, userId: string): Promise<WorkspaceMembershipRecord[]> {
    return Array.from(this.memberships.values())
      .filter((item) => item.tenantId === tenantId && item.userId === userId)
      .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))
      .map(cloneMembership);
  }

  async replaceWorkspaceMemberships(input: {
    tenantId: string;
    userId: string;
    memberships: Array<{
      workspaceId: string;
      role: MembershipRole;
    }>;
  }): Promise<WorkspaceMembershipRecord[]> {
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const userId = sanitizeId(input.userId, "");
    const nextMemberships = normalizeMembershipInputs(input.memberships);
    for (const key of Array.from(this.memberships.keys())) {
      if (key.startsWith(`${tenantId}:`) && key.endsWith(`:${userId}`)) {
        this.memberships.delete(key);
      }
    }
    for (const item of nextMemberships) {
      await this.upsertWorkspaceMembership({
        tenantId,
        userId,
        workspaceId: item.workspaceId,
        role: item.role
      });
    }
    await this.linkUserTenant({
      tenantId,
      userId,
      defaultWorkspaceId: nextMemberships[0].workspaceId,
      status: "active"
    });
    return await this.listWorkspaceMemberships(tenantId, userId);
  }

  async listTenantUsers(tenantId: string): Promise<TenantUserRecord[]> {
    const keyTenantId = sanitizeId(tenantId, "t_default");
    const rows: TenantUserRecord[] = [];
    for (const tenant of this.userTenants.values()) {
      if (tenant.tenantId !== keyTenantId) {
        continue;
      }
      const user = this.usersById.get(tenant.userId);
      if (!user) {
        continue;
      }
      rows.push({
        user: cloneUser(user),
        tenant: cloneUserTenant(tenant),
        memberships: await this.listWorkspaceMemberships(keyTenantId, tenant.userId)
      });
    }
    rows.sort((a, b) => a.user.username.localeCompare(b.user.username));
    return rows;
  }

  async updateUserStatus(input: {
    tenantId: string;
    userId: string;
    status: "active" | "disabled";
  }): Promise<UserRecord | undefined> {
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const userId = sanitizeId(input.userId, "");
    const tenantKey = userTenantKey(tenantId, userId);
    const tenant = this.userTenants.get(tenantKey);
    if (!tenant) {
      return undefined;
    }
    const user = this.usersById.get(userId);
    if (!user) {
      return undefined;
    }
    const now = nowIso();
    this.userTenants.set(tenantKey, {
      ...tenant,
      status: input.status,
      updatedAt: now
    });
    const nextUser: UserRecord = {
      ...user,
      status: input.status,
      updatedAt: now
    };
    this.usersById.set(userId, nextUser);
    return cloneUser(nextUser);
  }

  async setLocalUserPassword(input: {
    tenantId: string;
    userId: string;
    passwordHash: string;
  }): Promise<UserRecord | undefined> {
    const tenant = await this.getUserTenant(input.tenantId, input.userId);
    if (!tenant) {
      return undefined;
    }
    const user = this.usersById.get(sanitizeId(input.userId, ""));
    if (!user || user.source !== "local") {
      return undefined;
    }
    const next: UserRecord = {
      ...user,
      passwordHash: input.passwordHash,
      updatedAt: nowIso()
    };
    this.usersById.set(next.id, next);
    return cloneUser(next);
  }

  async createRefreshToken(input: {
    tokenId: string;
    userId: string;
    tenantId: string;
    expiresAt: string;
  }): Promise<RefreshTokenRecord> {
    const now = nowIso();
    const next: RefreshTokenRecord = {
      tokenId: sanitizeId(input.tokenId, ""),
      userId: sanitizeId(input.userId, ""),
      tenantId: sanitizeId(input.tenantId, "t_default"),
      expiresAt: input.expiresAt,
      createdAt: now
    };
    this.refreshTokens.set(next.tokenId, next);
    return cloneRefreshToken(next);
  }

  async getRefreshToken(tokenId: string): Promise<RefreshTokenRecord | undefined> {
    const found = this.refreshTokens.get(sanitizeId(tokenId, ""));
    return found ? cloneRefreshToken(found) : undefined;
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    const key = sanitizeId(tokenId, "");
    const found = this.refreshTokens.get(key);
    if (!found) {
      return;
    }
    this.refreshTokens.set(key, {
      ...found,
      revokedAt: nowIso()
    });
  }
}

export class SqliteAuthStore implements AuthStore {
  private readonly dbPath: string;

  constructor(dbPath = defaultSqlitePath()) {
    this.dbPath = normalizeDbPath(dbPath);
  }

  async ensureTenant(input: { code: string; name?: string }): Promise<TenantRecord> {
    ensureAuthSchema(this.dbPath);
    const code = sanitizeId(input.code, "default");
    const existing = await this.findTenantByCode(code);
    if (existing) {
      return existing;
    }
    const now = nowIso();
    const tenantId = code === "default" ? "t_default" : `t_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    execSql(
      this.dbPath,
      `
        INSERT INTO tenants (id, code, name, status, created_at, updated_at)
        VALUES (
          ${sqlString(tenantId)},
          ${sqlString(code)},
          ${sqlString(sanitizeName(input.name, code))},
          'active',
          ${sqlString(now)},
          ${sqlString(now)}
        );
      `
    );
    return (await this.findTenantByCode(code))!;
  }

  async findTenantByCode(code: string): Promise<TenantRecord | undefined> {
    ensureAuthSchema(this.dbPath);
    const rows = queryJson<{
      id: string;
      code: string;
      name: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          id AS id,
          code AS code,
          name AS name,
          status AS status,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM tenants
        WHERE code = ${sqlString(sanitizeId(code, ""))}
        LIMIT 1;
      `
    );
    return rows[0] ? normalizeTenant(rows[0]) : undefined;
  }

  async findTenantById(id: string): Promise<TenantRecord | undefined> {
    ensureAuthSchema(this.dbPath);
    const rows = queryJson<{
      id: string;
      code: string;
      name: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          id AS id,
          code AS code,
          name AS name,
          status AS status,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM tenants
        WHERE id = ${sqlString(sanitizeId(id, ""))}
        LIMIT 1;
      `
    );
    return rows[0] ? normalizeTenant(rows[0]) : undefined;
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
    ensureAuthSchema(this.dbPath);
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const username = sanitizeId(input.username, "admin");
    const now = nowIso();
    const existing = await this.findLocalUser(tenantId, username);
    const userId = existing?.id ?? `u_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    execSql(
      this.dbPath,
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
        VALUES (
          ${sqlString(userId)},
          ${sqlString(username)},
          ${sqlMaybeString(input.displayName)},
          ${sqlMaybeString(input.email)},
          'active',
          'local',
          NULL,
          ${sqlString(input.passwordHash)},
          ${sqlString(existing?.createdAt ?? now)},
          ${sqlString(now)},
          ${sqlMaybeString(existing?.lastLoginAt)}
        )
        ON CONFLICT(id) DO UPDATE SET
          username = excluded.username,
          display_name = excluded.display_name,
          email = excluded.email,
          status = excluded.status,
          source = excluded.source,
          password_hash = excluded.password_hash,
          updated_at = excluded.updated_at;
      `
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
    ensureAuthSchema(this.dbPath);
    const rows = queryJson<{
      id: string;
      username: string;
      displayName: string | null;
      email: string | null;
      status: string;
      source: string;
      externalSubject: string | null;
      passwordHash: string | null;
      createdAt: string;
      updatedAt: string;
      lastLoginAt: string | null;
    }>(
      this.dbPath,
      `
        SELECT
          u.id AS id,
          u.username AS username,
          u.display_name AS displayName,
          u.email AS email,
          u.status AS status,
          u.source AS source,
          u.external_subject AS externalSubject,
          u.password_hash AS passwordHash,
          u.created_at AS createdAt,
          u.updated_at AS updatedAt,
          u.last_login_at AS lastLoginAt
        FROM users u
        INNER JOIN user_tenants ut
          ON ut.user_id = u.id
        WHERE ut.tenant_id = ${sqlString(sanitizeId(tenantId, ""))}
          AND u.username = ${sqlString(sanitizeId(username, ""))}
          AND u.source = 'local'
        LIMIT 1;
      `
    );
    return rows[0] ? normalizeUser(rows[0]) : undefined;
  }

  async findUserById(userId: string): Promise<UserRecord | undefined> {
    ensureAuthSchema(this.dbPath);
    const rows = queryJson<{
      id: string;
      username: string;
      displayName: string | null;
      email: string | null;
      status: string;
      source: string;
      externalSubject: string | null;
      passwordHash: string | null;
      createdAt: string;
      updatedAt: string;
      lastLoginAt: string | null;
    }>(
      this.dbPath,
      `
        SELECT
          id AS id,
          username AS username,
          display_name AS displayName,
          email AS email,
          status AS status,
          source AS source,
          external_subject AS externalSubject,
          password_hash AS passwordHash,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_login_at AS lastLoginAt
        FROM users
        WHERE id = ${sqlString(sanitizeId(userId, ""))}
        LIMIT 1;
      `
    );
    return rows[0] ? normalizeUser(rows[0]) : undefined;
  }

  async touchLastLogin(userId: string): Promise<void> {
    ensureAuthSchema(this.dbPath);
    execSql(
      this.dbPath,
      `
        UPDATE users
        SET
          last_login_at = ${sqlString(nowIso())},
          updated_at = ${sqlString(nowIso())}
        WHERE id = ${sqlString(sanitizeId(userId, ""))};
      `
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
    ensureAuthSchema(this.dbPath);
    const provider = sanitizeId(input.provider, "external");
    const subject = sanitizeId(input.subject, "");
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const now = nowIso();
    const identityRows = queryJson<{ userId: string }>(
      this.dbPath,
      `
        SELECT user_id AS userId
        FROM auth_identities
        WHERE provider = ${sqlString(provider)}
          AND subject = ${sqlString(subject)}
          AND tenant_id = ${sqlString(tenantId)}
        LIMIT 1;
      `
    );
    const userId = identityRows[0]?.userId ?? `u_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    const existing = await this.findUserById(userId);
    execSql(
      this.dbPath,
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
        VALUES (
          ${sqlString(userId)},
          ${sqlString(sanitizeId(input.username, `ext_${subject}`))},
          ${sqlMaybeString(input.displayName)},
          ${sqlMaybeString(input.email)},
          'active',
          'external',
          ${sqlString(subject)},
          NULL,
          ${sqlString(existing?.createdAt ?? now)},
          ${sqlString(now)},
          ${sqlMaybeString(existing?.lastLoginAt)}
        )
        ON CONFLICT(id) DO UPDATE SET
          username = excluded.username,
          display_name = excluded.display_name,
          email = excluded.email,
          status = excluded.status,
          source = excluded.source,
          external_subject = excluded.external_subject,
          updated_at = excluded.updated_at;
      `
    );
    execSql(
      this.dbPath,
      `
        INSERT INTO auth_identities (
          provider,
          subject,
          tenant_id,
          user_id,
          claims_json,
          last_seen_at
        )
        VALUES (
          ${sqlString(provider)},
          ${sqlString(subject)},
          ${sqlString(tenantId)},
          ${sqlString(userId)},
          ${sqlString(JSON.stringify(input.claims ?? {}))},
          ${sqlString(now)}
        )
        ON CONFLICT(provider, subject, tenant_id) DO UPDATE SET
          user_id = excluded.user_id,
          claims_json = excluded.claims_json,
          last_seen_at = excluded.last_seen_at;
      `
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
    ensureAuthSchema(this.dbPath);
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const userId = sanitizeId(input.userId, "");
    const existing = await this.getUserTenant(tenantId, userId);
    const now = nowIso();
    execSql(
      this.dbPath,
      `
        INSERT INTO user_tenants (
          tenant_id,
          user_id,
          default_workspace_id,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ${sqlString(tenantId)},
          ${sqlString(userId)},
          ${sqlString(sanitizeId(input.defaultWorkspaceId ?? existing?.defaultWorkspaceId, "w_default"))},
          ${sqlString(input.status ?? existing?.status ?? "active")},
          ${sqlString(existing?.createdAt ?? now)},
          ${sqlString(now)}
        )
        ON CONFLICT(tenant_id, user_id) DO UPDATE SET
          default_workspace_id = excluded.default_workspace_id,
          status = excluded.status,
          updated_at = excluded.updated_at;
      `
    );
    return (await this.getUserTenant(tenantId, userId))!;
  }

  async getUserTenant(tenantId: string, userId: string): Promise<UserTenantRecord | undefined> {
    ensureAuthSchema(this.dbPath);
    const rows = queryJson<{
      tenantId: string;
      userId: string;
      defaultWorkspaceId: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          tenant_id AS tenantId,
          user_id AS userId,
          default_workspace_id AS defaultWorkspaceId,
          status AS status,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM user_tenants
        WHERE tenant_id = ${sqlString(sanitizeId(tenantId, ""))}
          AND user_id = ${sqlString(sanitizeId(userId, ""))}
        LIMIT 1;
      `
    );
    return rows[0] ? normalizeUserTenant(rows[0]) : undefined;
  }

  async upsertWorkspaceMembership(input: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<WorkspaceMembershipRecord> {
    ensureAuthSchema(this.dbPath);
    const existing = queryJson<{ createdAt: string }>(
      this.dbPath,
      `
        SELECT created_at AS createdAt
        FROM workspace_memberships
        WHERE tenant_id = ${sqlString(sanitizeId(input.tenantId, "t_default"))}
          AND workspace_id = ${sqlString(sanitizeId(input.workspaceId, "w_default"))}
          AND user_id = ${sqlString(sanitizeId(input.userId, ""))}
        LIMIT 1;
      `
    )[0];
    const now = nowIso();
    execSql(
      this.dbPath,
      `
        INSERT INTO workspace_memberships (
          tenant_id,
          workspace_id,
          user_id,
          role,
          created_at,
          updated_at
        )
        VALUES (
          ${sqlString(sanitizeId(input.tenantId, "t_default"))},
          ${sqlString(sanitizeId(input.workspaceId, "w_default"))},
          ${sqlString(sanitizeId(input.userId, ""))},
          ${sqlString(normalizeRole(input.role))},
          ${sqlString(existing?.createdAt ?? now)},
          ${sqlString(now)}
        )
        ON CONFLICT(tenant_id, workspace_id, user_id) DO UPDATE SET
          role = excluded.role,
          updated_at = excluded.updated_at;
      `
    );
    const rows = await this.listWorkspaceMemberships(input.tenantId, input.userId);
    return rows.find((item) => item.workspaceId === sanitizeId(input.workspaceId, "w_default"))!;
  }

  async listWorkspaceMemberships(tenantId: string, userId: string): Promise<WorkspaceMembershipRecord[]> {
    ensureAuthSchema(this.dbPath);
    const rows = queryJson<{
      tenantId: string;
      workspaceId: string;
      userId: string;
      role: string;
      createdAt: string;
      updatedAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          tenant_id AS tenantId,
          workspace_id AS workspaceId,
          user_id AS userId,
          role AS role,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM workspace_memberships
        WHERE tenant_id = ${sqlString(sanitizeId(tenantId, ""))}
          AND user_id = ${sqlString(sanitizeId(userId, ""))}
        ORDER BY workspace_id ASC;
      `
    );
    return rows.map(normalizeMembership);
  }

  async replaceWorkspaceMemberships(input: {
    tenantId: string;
    userId: string;
    memberships: Array<{
      workspaceId: string;
      role: MembershipRole;
    }>;
  }): Promise<WorkspaceMembershipRecord[]> {
    ensureAuthSchema(this.dbPath);
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const userId = sanitizeId(input.userId, "");
    const nextMemberships = normalizeMembershipInputs(input.memberships);
    execSql(
      this.dbPath,
      `
        DELETE FROM workspace_memberships
        WHERE tenant_id = ${sqlString(tenantId)}
          AND user_id = ${sqlString(userId)};
      `
    );
    for (const item of nextMemberships) {
      await this.upsertWorkspaceMembership({
        tenantId,
        userId,
        workspaceId: item.workspaceId,
        role: item.role
      });
    }
    await this.linkUserTenant({
      tenantId,
      userId,
      defaultWorkspaceId: nextMemberships[0].workspaceId,
      status: "active"
    });
    return await this.listWorkspaceMemberships(tenantId, userId);
  }

  async listTenantUsers(tenantId: string): Promise<TenantUserRecord[]> {
    ensureAuthSchema(this.dbPath);
    const keyTenantId = sanitizeId(tenantId, "t_default");
    const rows = queryJson<{
      tenantId: string;
      userId: string;
      defaultWorkspaceId: string;
      tenantStatus: string;
      tenantCreatedAt: string;
      tenantUpdatedAt: string;
      id: string;
      username: string;
      displayName: string | null;
      email: string | null;
      userStatus: string;
      source: string;
      externalSubject: string | null;
      passwordHash: string | null;
      userCreatedAt: string;
      userUpdatedAt: string;
      lastLoginAt: string | null;
    }>(
      this.dbPath,
      `
        SELECT
          ut.tenant_id AS tenantId,
          ut.user_id AS userId,
          ut.default_workspace_id AS defaultWorkspaceId,
          ut.status AS tenantStatus,
          ut.created_at AS tenantCreatedAt,
          ut.updated_at AS tenantUpdatedAt,
          u.id AS id,
          u.username AS username,
          u.display_name AS displayName,
          u.email AS email,
          u.status AS userStatus,
          u.source AS source,
          u.external_subject AS externalSubject,
          u.password_hash AS passwordHash,
          u.created_at AS userCreatedAt,
          u.updated_at AS userUpdatedAt,
          u.last_login_at AS lastLoginAt
        FROM user_tenants ut
        INNER JOIN users u
          ON u.id = ut.user_id
        WHERE ut.tenant_id = ${sqlString(keyTenantId)}
        ORDER BY u.username ASC;
      `
    );

    const out: TenantUserRecord[] = [];
    for (const row of rows) {
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
        memberships: await this.listWorkspaceMemberships(row.tenantId, row.userId)
      });
    }
    return out;
  }

  async updateUserStatus(input: {
    tenantId: string;
    userId: string;
    status: "active" | "disabled";
  }): Promise<UserRecord | undefined> {
    ensureAuthSchema(this.dbPath);
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const userId = sanitizeId(input.userId, "");
    const exists = await this.getUserTenant(tenantId, userId);
    if (!exists) {
      return undefined;
    }
    const now = nowIso();
    execSql(
      this.dbPath,
      `
        UPDATE user_tenants
        SET
          status = ${sqlString(input.status)},
          updated_at = ${sqlString(now)}
        WHERE tenant_id = ${sqlString(tenantId)}
          AND user_id = ${sqlString(userId)};

        UPDATE users
        SET
          status = ${sqlString(input.status)},
          updated_at = ${sqlString(now)}
        WHERE id = ${sqlString(userId)};
      `
    );
    return await this.findUserById(userId);
  }

  async setLocalUserPassword(input: {
    tenantId: string;
    userId: string;
    passwordHash: string;
  }): Promise<UserRecord | undefined> {
    ensureAuthSchema(this.dbPath);
    const tenantId = sanitizeId(input.tenantId, "t_default");
    const userId = sanitizeId(input.userId, "");
    const exists = await this.getUserTenant(tenantId, userId);
    if (!exists) {
      return undefined;
    }
    execSql(
      this.dbPath,
      `
        UPDATE users
        SET
          password_hash = ${sqlString(input.passwordHash)},
          updated_at = ${sqlString(nowIso())}
        WHERE id = ${sqlString(userId)}
          AND source = 'local';
      `
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
    ensureAuthSchema(this.dbPath);
    const now = nowIso();
    execSql(
      this.dbPath,
      `
        INSERT INTO refresh_tokens (
          token_id,
          user_id,
          tenant_id,
          expires_at,
          revoked_at,
          created_at
        )
        VALUES (
          ${sqlString(sanitizeId(input.tokenId, ""))},
          ${sqlString(sanitizeId(input.userId, ""))},
          ${sqlString(sanitizeId(input.tenantId, "t_default"))},
          ${sqlString(input.expiresAt)},
          NULL,
          ${sqlString(now)}
        )
        ON CONFLICT(token_id) DO UPDATE SET
          user_id = excluded.user_id,
          tenant_id = excluded.tenant_id,
          expires_at = excluded.expires_at,
          revoked_at = excluded.revoked_at,
          created_at = excluded.created_at;
      `
    );
    return (await this.getRefreshToken(input.tokenId))!;
  }

  async getRefreshToken(tokenId: string): Promise<RefreshTokenRecord | undefined> {
    ensureAuthSchema(this.dbPath);
    const rows = queryJson<{
      tokenId: string;
      userId: string;
      tenantId: string;
      expiresAt: string;
      revokedAt: string | null;
      createdAt: string;
    }>(
      this.dbPath,
      `
        SELECT
          token_id AS tokenId,
          user_id AS userId,
          tenant_id AS tenantId,
          expires_at AS expiresAt,
          revoked_at AS revokedAt,
          created_at AS createdAt
        FROM refresh_tokens
        WHERE token_id = ${sqlString(sanitizeId(tokenId, ""))}
        LIMIT 1;
      `
    );
    return rows[0] ? normalizeRefreshToken(rows[0]) : undefined;
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    ensureAuthSchema(this.dbPath);
    execSql(
      this.dbPath,
      `
        UPDATE refresh_tokens
        SET revoked_at = ${sqlString(nowIso())}
        WHERE token_id = ${sqlString(sanitizeId(tokenId, ""))};
      `
    );
  }
}

const initializedDbPaths = new Set<string>();

function ensureAuthSchema(dbPath: string): void {
  if (initializedDbPaths.has(dbPath)) {
    return;
  }
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  execSql(
    dbPath,
    `
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
        claims_json TEXT NOT NULL,
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
    `
  );

  const now = nowIso();
  execSql(
    dbPath,
    `
      INSERT OR IGNORE INTO tenants (id, code, name, status, created_at, updated_at)
      VALUES (
        't_default',
        'default',
        'Default Tenant',
        'active',
        ${sqlString(now)},
        ${sqlString(now)}
      );
    `
  );

  initializedDbPaths.add(dbPath);
}

function normalizeTenant(input: {
  id: string;
  code: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}): TenantRecord {
  return {
    id: input.id,
    code: input.code,
    name: input.name,
    status: input.status === "disabled" ? "disabled" : "active",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function normalizeUser(input: {
  id: string;
  username: string;
  displayName?: string | null;
  email?: string | null;
  status: string;
  source: string;
  externalSubject?: string | null;
  passwordHash?: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
}): UserRecord {
  return {
    id: input.id,
    username: input.username,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.email ? { email: input.email } : {}),
    status: input.status === "disabled" ? "disabled" : "active",
    source: input.source === "external" ? "external" : "local",
    ...(input.externalSubject ? { externalSubject: input.externalSubject } : {}),
    ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    ...(input.lastLoginAt ? { lastLoginAt: input.lastLoginAt } : {})
  };
}

function normalizeUserTenant(input: {
  tenantId: string;
  userId: string;
  defaultWorkspaceId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}): UserTenantRecord {
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    defaultWorkspaceId: input.defaultWorkspaceId,
    status: input.status === "disabled" ? "disabled" : "active",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function normalizeMembership(input: {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}): WorkspaceMembershipRecord {
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: normalizeRole(input.role),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function normalizeRefreshToken(input: {
  tokenId: string;
  userId: string;
  tenantId: string;
  expiresAt: string;
  revokedAt?: string | null;
  createdAt: string;
}): RefreshTokenRecord {
  return {
    tokenId: input.tokenId,
    userId: input.userId,
    tenantId: input.tenantId,
    expiresAt: input.expiresAt,
    ...(input.revokedAt ? { revokedAt: input.revokedAt } : {}),
    createdAt: input.createdAt
  };
}

function cloneTenant(input: TenantRecord): TenantRecord {
  return { ...input };
}

function cloneUser(input: UserRecord): UserRecord {
  return { ...input };
}

function cloneUserTenant(input: UserTenantRecord): UserTenantRecord {
  return { ...input };
}

function cloneMembership(input: WorkspaceMembershipRecord): WorkspaceMembershipRecord {
  return { ...input };
}

function cloneRefreshToken(input: RefreshTokenRecord): RefreshTokenRecord {
  return { ...input };
}

function localUserKey(tenantId: string, username: string): string {
  return `${sanitizeId(tenantId, "t_default")}:${sanitizeId(username, "")}`;
}

function userTenantKey(tenantId: string, userId: string): string {
  return `${sanitizeId(tenantId, "t_default")}:${sanitizeId(userId, "")}`;
}

function workspaceMembershipKey(tenantId: string, workspaceId: string, userId: string): string {
  return `${sanitizeId(tenantId, "t_default")}:${sanitizeId(workspaceId, "w_default")}:${sanitizeId(userId, "")}`;
}

function externalIdentityKey(provider: string, subject: string, tenantId: string): string {
  return `${sanitizeId(provider, "external")}:${sanitizeId(subject, "")}:${sanitizeId(tenantId, "t_default")}`;
}

function normalizeRole(value: unknown): MembershipRole {
  if (value === "tenant_admin" || value === "workspace_admin") {
    return value;
  }
  return "member";
}

function normalizeMembershipInputs(
  inputs: Array<{
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
  for (const item of Array.isArray(inputs) ? inputs : []) {
    const workspaceId = sanitizeId(item.workspaceId, "");
    if (!workspaceId || seen.has(workspaceId)) {
      continue;
    }
    seen.add(workspaceId);
    out.push({
      workspaceId,
      role: normalizeRole(item.role)
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

function nowIso(): string {
  return new Date().toISOString();
}

export * from "./auth-postgres.js";
