import {
  InMemoryAuthStore,
  type AuthStore,
  type MembershipRole,
  type UserRecord,
  type WorkspaceMembershipRecord
} from "../../../packages/storage/dist/index.js";
import type { MethodName } from "../../../packages/protocol/dist/index.js";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createHmac, createPublicKey, createVerify, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpRequest } from "node:http";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { request as httpsRequest } from "node:https";

declare const process: any;
declare const Buffer: any;

export type AuthMode = "none" | "local" | "external" | "hybrid";
export type PrincipalRole = MembershipRole;

export interface Principal {
  subject: string;
  tenantId: string;
  workspaceIds: string[];
  roles: PrincipalRole[];
  authSource: "local" | "external";
  displayName?: string;
  claims: Record<string, unknown>;
}

export interface AuthRuntimeConfig {
  mode: AuthMode;
  enterpriseRequireAuth: boolean;
  localJwtSecret: string;
  localJwtExpiresSec: number;
  localIssuer: string;
  localAudience: string;
  defaultTenantCode: string;
  defaultWorkspaceId: string;
  defaultAdminUsername: string;
  defaultAdminPassword: string;
  jwksUrl?: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  externalRoleMap: Record<string, PrincipalRole>;
}

export interface AuthConnectResult {
  ok: true;
  principal?: Principal;
}

export interface AuthConnectError {
  ok: false;
  code:
    | "UNAUTHORIZED"
    | "AUTH_REQUIRED"
    | "FORBIDDEN"
    | "TENANT_SCOPE_MISMATCH"
    | "WORKSPACE_SCOPE_MISMATCH"
    | "INVALID_REQUEST";
  message: string;
}

export interface AuthRpcResult {
  ok: true;
  params: Record<string, unknown>;
}

export interface AuthRpcError {
  ok: false;
  code:
    | "UNAUTHORIZED"
    | "AUTH_REQUIRED"
    | "FORBIDDEN"
    | "TENANT_SCOPE_MISMATCH"
    | "WORKSPACE_SCOPE_MISMATCH";
  message: string;
}

export class AuthHttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AuthHttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface GatewayAuthRuntime {
  readonly config: AuthRuntimeConfig;
  isAuthRequired(): boolean;
  authenticateConnect(params: Record<string, unknown>): Promise<AuthConnectResult | AuthConnectError>;
  authorizeRpc(
    method: MethodName,
    params: Record<string, unknown>,
    principal?: Principal
  ): AuthRpcResult | AuthRpcError;
  login(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  refresh(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  me(authorizationHeader: string | undefined): Promise<Record<string, unknown>>;
  logout(body: Record<string, unknown>): Promise<Record<string, unknown>>;
}

type DecodedJwt = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: any;
};

type VerifiedToken = {
  source: "local" | "external";
  principal: Principal;
};

type JwkSetCache = {
  expiresAtMs: number;
  keysByKid: Map<string, Record<string, unknown>>;
};

const WORKSPACE_SCOPE_METHODS = new Set<MethodName>([
  "agents.list",
  "agents.upsert",
  "executionTargets.list",
  "executionTargets.upsert",
  "budget.get",
  "budget.update",
  "policy.get",
  "policy.update",
  "audit.query",
  "metrics.summary",
  "agent.run"
]);

const TENANT_SCOPE_METHODS = new Set<MethodName>([
  "users.list",
  "users.create",
  "users.updateStatus",
  "users.resetPassword",
  "users.updateMemberships",
  "secrets.upsertModelKey",
  "secrets.getModelKeyMeta"
]);

const ENTERPRISE_WRITE_METHODS = new Set<MethodName>([
  "agents.upsert",
  "users.create",
  "users.updateStatus",
  "users.resetPassword",
  "users.updateMemberships",
  "secrets.upsertModelKey",
  "executionTargets.upsert",
  "budget.update",
  "policy.update"
]);

const WORKSPACE_ADMIN_ALLOWED_WRITES = new Set<MethodName>([
  "agents.upsert",
  "users.updateMemberships",
  "executionTargets.upsert",
  "budget.update",
  "policy.update"
]);

const WORKSPACE_ADMIN_RESTRICTED_METHODS = new Set<MethodName>([
  "secrets.upsertModelKey",
  "secrets.getModelKeyMeta",
  "users.create",
  "users.updateStatus",
  "users.resetPassword"
]);

const MEMBER_RESTRICTED_METHODS = new Set<MethodName>([
  "users.list",
  "users.create",
  "users.updateStatus",
  "users.resetPassword",
  "users.updateMemberships",
  "secrets.upsertModelKey",
  "secrets.getModelKeyMeta"
]);

export function resolveAuthRuntimeConfig(): AuthRuntimeConfig {
  const rawMode = String(process.env.OPENFOAL_AUTH_MODE ?? "none").trim().toLowerCase();
  const mode: AuthMode =
    rawMode === "local" || rawMode === "external" || rawMode === "hybrid" ? (rawMode as AuthMode) : "none";
  return {
    mode,
    enterpriseRequireAuth: toBoolean(process.env.OPENFOAL_ENTERPRISE_REQUIRE_AUTH, false),
    localJwtSecret: String(process.env.OPENFOAL_LOCAL_JWT_SECRET ?? "openfoal-local-dev-secret"),
    localJwtExpiresSec: parseDurationSeconds(process.env.OPENFOAL_LOCAL_JWT_EXPIRES_IN, 3600),
    localIssuer: String(process.env.OPENFOAL_LOCAL_JWT_ISSUER ?? "openfoal-local"),
    localAudience: String(process.env.OPENFOAL_LOCAL_JWT_AUDIENCE ?? "openfoal"),
    defaultTenantCode: String(process.env.OPENFOAL_LOCAL_DEFAULT_TENANT_CODE ?? "default"),
    defaultWorkspaceId: String(process.env.OPENFOAL_LOCAL_DEFAULT_WORKSPACE_ID ?? "w_default"),
    defaultAdminUsername: String(process.env.OPENFOAL_LOCAL_ADMIN_USERNAME ?? "admin"),
    defaultAdminPassword: String(process.env.OPENFOAL_LOCAL_ADMIN_PASSWORD ?? "admin123!"),
    jwksUrl: sanitizeOptionalString(process.env.OPENFOAL_JWKS_URL),
    jwtIssuer: sanitizeOptionalString(process.env.OPENFOAL_JWT_ISSUER),
    jwtAudience: sanitizeOptionalString(process.env.OPENFOAL_JWT_AUDIENCE),
    externalRoleMap: parseExternalRoleMap(process.env.OPENFOAL_EXTERNAL_ROLE_MAP)
  };
}

export function createGatewayAuthRuntime(input: {
  config?: AuthRuntimeConfig;
  store?: AuthStore;
  now?: () => Date;
}): GatewayAuthRuntime {
  const config = input.config ?? resolveAuthRuntimeConfig();
  const store = input.store ?? new InMemoryAuthStore();
  const now = input.now ?? (() => new Date());
  let jwksCache: JwkSetCache | undefined;

  const ensureLocalBootstrap = async (): Promise<void> => {
    if (config.mode !== "local" && config.mode !== "hybrid") {
      return;
    }
    const tenant = await store.ensureTenant({
      code: config.defaultTenantCode,
      name: "Default Tenant"
    });
    const passwordHash = hashPassword(config.defaultAdminPassword);
    await store.upsertLocalUser({
      tenantId: tenant.id,
      username: config.defaultAdminUsername,
      passwordHash,
      displayName: "Administrator",
      defaultWorkspaceId: config.defaultWorkspaceId,
      role: "tenant_admin"
    });
  };

  const tryVerifyToken = async (token: string): Promise<VerifiedToken> => {
    if (config.mode === "local") {
      const principal = await verifyLocalToken(token, config, store, now);
      return {
        source: "local",
        principal
      };
    }
    if (config.mode === "external") {
      const principal = await verifyExternalToken(token, config, store, now, async () => {
        jwksCache = await getJwksCache(config, jwksCache, now);
        return jwksCache;
      });
      return {
        source: "external",
        principal
      };
    }
    if (config.mode === "hybrid") {
      try {
        const principal = await verifyLocalToken(token, config, store, now);
        return {
          source: "local",
          principal
        };
      } catch {
        const principal = await verifyExternalToken(token, config, store, now, async () => {
          jwksCache = await getJwksCache(config, jwksCache, now);
          return jwksCache;
        });
        return {
          source: "external",
          principal
        };
      }
    }
    throw new AuthHttpError(401, "UNAUTHORIZED", "Auth mode disabled");
  };

  const authRequired = (): boolean => config.mode !== "none" || config.enterpriseRequireAuth;

  const extractBearerToken = (authorizationHeader: string | undefined): string | undefined => {
    if (!authorizationHeader) {
      return undefined;
    }
    const raw = String(authorizationHeader).trim();
    if (!raw.toLowerCase().startsWith("bearer ")) {
      return undefined;
    }
    const token = raw.slice(7).trim();
    return token.length > 0 ? token : undefined;
  };

  const authenticateConnect = async (params: Record<string, unknown>): Promise<AuthConnectResult | AuthConnectError> => {
    await ensureLocalBootstrap();
    const token = readAuthTokenFromConnectParams(params);
    if (!authRequired()) {
      return { ok: true };
    }
    if (!token) {
      return {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "connect 需要 auth.token"
      };
    }

    try {
      const verified = await tryVerifyToken(token);
      return {
        ok: true,
        principal: verified.principal
      };
    } catch (error) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: toErrorMessage(error)
      };
    }
  };

  const authorizeRpc = (
    method: MethodName,
    params: Record<string, unknown>,
    principal?: Principal
  ): AuthRpcResult | AuthRpcError => {
    if (!authRequired()) {
      return {
        ok: true,
        params
      };
    }
    if (!principal) {
      return {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "未登录或凭证无效"
      };
    }

    const effective = { ...params };
    if (WORKSPACE_SCOPE_METHODS.has(method)) {
      const tenantIdParam = readString(effective, "tenantId");
      if (tenantIdParam && tenantIdParam !== principal.tenantId) {
        return {
          ok: false,
          code: "TENANT_SCOPE_MISMATCH",
          message: "tenantId 与登录租户不一致"
        };
      }

      const requestedWorkspaceId = readString(effective, "workspaceId");
      const targetWorkspaceId = requestedWorkspaceId ?? principal.workspaceIds[0] ?? "w_default";
      if (!canAccessWorkspace(principal, targetWorkspaceId)) {
        return {
          ok: false,
          code: "WORKSPACE_SCOPE_MISMATCH",
          message: "workspaceId 超出当前账号可访问范围"
        };
      }

      effective.tenantId = principal.tenantId;
      effective.workspaceId = targetWorkspaceId;
    }

    if (TENANT_SCOPE_METHODS.has(method)) {
      const tenantIdParam = readString(effective, "tenantId");
      if (tenantIdParam && tenantIdParam !== principal.tenantId) {
        return {
          ok: false,
          code: "TENANT_SCOPE_MISMATCH",
          message: "tenantId 与登录租户不一致"
        };
      }
      effective.tenantId = principal.tenantId;
      const requestedWorkspaceId = readString(effective, "workspaceId");
      if (requestedWorkspaceId && !canAccessWorkspace(principal, requestedWorkspaceId)) {
        return {
          ok: false,
          code: "WORKSPACE_SCOPE_MISMATCH",
          message: "workspaceId 超出当前账号可访问范围"
        };
      }
      if (method === "users.list" && hasRole(principal, "workspace_admin") && !hasRole(principal, "tenant_admin")) {
        effective.workspaceId = requestedWorkspaceId ?? principal.workspaceIds[0] ?? "w_default";
      }
      if (method === "users.updateMemberships" && hasRole(principal, "workspace_admin") && !hasRole(principal, "tenant_admin")) {
        const memberships = readMembershipWorkspaces(effective.memberships);
        if (memberships.some((workspaceId) => !canAccessWorkspace(principal, workspaceId))) {
          return {
            ok: false,
            code: "WORKSPACE_SCOPE_MISMATCH",
            message: "workspace_admin 只能维护已授权 workspace 成员关系"
          };
        }
      }
    }

    if (!canInvokeMethod(principal, method)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: `当前角色无权限调用 ${method}`
      };
    }

    if (!readString(effective, "actor")) {
      effective.actor = principal.displayName ?? principal.subject;
    }

    return {
      ok: true,
      params: effective
    };
  };

  const issueLocalAccessToken = async (input: {
    user: UserRecord;
    tenantId: string;
    memberships: WorkspaceMembershipRecord[];
  }): Promise<string> => {
    const issuedAtSec = Math.floor(now().getTime() / 1000);
    const workspaceIds = dedupStrings(input.memberships.map((item) => item.workspaceId));
    const roles = dedupRoles(input.memberships.map((item) => item.role));
    const payload: Record<string, unknown> = {
      sub: input.user.id,
      username: input.user.username,
      tenantId: input.tenantId,
      workspaceIds,
      roles,
      source: "local",
      iat: issuedAtSec,
      nbf: issuedAtSec,
      exp: issuedAtSec + config.localJwtExpiresSec,
      iss: config.localIssuer,
      aud: config.localAudience
    };
    return signHs256Jwt(payload, config.localJwtSecret);
  };

  const issueRefreshToken = async (input: { userId: string; tenantId: string }): Promise<string> => {
    const tokenId = randomBytes(24).toString("hex");
    const expiresAt = new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await store.createRefreshToken({
      tokenId,
      userId: input.userId,
      tenantId: input.tenantId,
      expiresAt
    });
    return tokenId;
  };

  return {
    config,
    isAuthRequired: authRequired,
    authenticateConnect,
    authorizeRpc,
    async login(body: Record<string, unknown>): Promise<Record<string, unknown>> {
      await ensureLocalBootstrap();
      if (config.mode === "external") {
        throw new AuthHttpError(400, "INVALID_REQUEST", "当前模式不支持本地账号登录");
      }

      const username = readString(body, "username");
      const password = readString(body, "password");
      const tenantCode = readString(body, "tenant") ?? config.defaultTenantCode;
      if (!username || !password) {
        throw new AuthHttpError(400, "INVALID_REQUEST", "username/password 不能为空");
      }

      const tenant = await store.ensureTenant({
        code: tenantCode,
        name: tenantCode
      });
      const user = await store.findLocalUser(tenant.id, username);
      if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
        throw new AuthHttpError(401, "UNAUTHORIZED", "账号或密码错误");
      }
      const tenantBinding = await store.getUserTenant(tenant.id, user.id);
      if (user.status !== "active" || tenantBinding?.status === "disabled") {
        throw new AuthHttpError(401, "UNAUTHORIZED", "账号已禁用");
      }

      const memberships = await store.listWorkspaceMemberships(tenant.id, user.id);
      if (memberships.length === 0) {
        await store.upsertWorkspaceMembership({
          tenantId: tenant.id,
          workspaceId: config.defaultWorkspaceId,
          userId: user.id,
          role: "member"
        });
      }
      const finalMemberships = await store.listWorkspaceMemberships(tenant.id, user.id);
      const accessToken = await issueLocalAccessToken({
        user,
        tenantId: tenant.id,
        memberships: finalMemberships
      });
      const refreshToken = await issueRefreshToken({
        userId: user.id,
        tenantId: tenant.id
      });
      await store.touchLastLogin(user.id);
      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: config.localJwtExpiresSec,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          username: user.username,
          ...(user.displayName ? { displayName: user.displayName } : {}),
          tenantId: tenant.id,
          workspaceIds: dedupStrings(finalMemberships.map((item) => item.workspaceId)),
          roles: dedupRoles(finalMemberships.map((item) => item.role))
        }
      };
    },
    async refresh(body: Record<string, unknown>): Promise<Record<string, unknown>> {
      await ensureLocalBootstrap();
      if (config.mode === "external") {
        throw new AuthHttpError(400, "INVALID_REQUEST", "当前模式不支持 refresh");
      }
      const refreshToken = readString(body, "refreshToken");
      if (!refreshToken) {
        throw new AuthHttpError(400, "INVALID_REQUEST", "refreshToken 不能为空");
      }
      const found = await store.getRefreshToken(refreshToken);
      if (!found) {
        throw new AuthHttpError(401, "UNAUTHORIZED", "refreshToken 无效");
      }
      if (found.revokedAt) {
        throw new AuthHttpError(401, "UNAUTHORIZED", "refreshToken 已失效");
      }
      if (new Date(found.expiresAt).getTime() <= now().getTime()) {
        throw new AuthHttpError(401, "UNAUTHORIZED", "refreshToken 已过期");
      }
      const user = await store.findUserById(found.userId);
      if (!user) {
        throw new AuthHttpError(401, "UNAUTHORIZED", "账号不存在");
      }
      const tenantBinding = await store.getUserTenant(found.tenantId, user.id);
      if (user.status !== "active" || tenantBinding?.status === "disabled") {
        throw new AuthHttpError(401, "UNAUTHORIZED", "账号已禁用");
      }
      const memberships = await store.listWorkspaceMemberships(found.tenantId, user.id);
      const accessToken = await issueLocalAccessToken({
        user,
        tenantId: found.tenantId,
        memberships
      });
      await store.revokeRefreshToken(refreshToken);
      const nextRefreshToken = await issueRefreshToken({
        userId: user.id,
        tenantId: found.tenantId
      });
      await store.touchLastLogin(user.id);
      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: config.localJwtExpiresSec,
        refresh_token: nextRefreshToken
      };
    },
    async me(authorizationHeader: string | undefined): Promise<Record<string, unknown>> {
      await ensureLocalBootstrap();
      const token = extractBearerToken(authorizationHeader);
      if (!token) {
        throw new AuthHttpError(401, "AUTH_REQUIRED", "缺少 Bearer token");
      }
      const verified = await tryVerifyToken(token);
      return {
        principal: principalSnapshot(verified.principal)
      };
    },
    async logout(body: Record<string, unknown>): Promise<Record<string, unknown>> {
      const refreshToken = readString(body, "refreshToken");
      if (refreshToken) {
        await store.revokeRefreshToken(refreshToken);
      }
      return {
        ok: true
      };
    }
  };
}

function readAuthTokenFromConnectParams(params: Record<string, unknown>): string | undefined {
  const auth = params.auth;
  if (auth && typeof auth === "object" && !Array.isArray(auth)) {
    const token = (auth as Record<string, unknown>).token;
    if (typeof token === "string" && token.trim().length > 0) {
      return token.trim();
    }
  }
  const fallback = params.authToken;
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback.trim();
  }
  return undefined;
}

async function verifyLocalToken(
  token: string,
  config: AuthRuntimeConfig,
  store: AuthStore,
  now: () => Date
): Promise<Principal> {
  const decoded = decodeJwt(token);
  if (decoded.header.alg !== "HS256") {
    throw new Error("local JWT alg 必须为 HS256");
  }
  const expected = signHs256(decoded.signingInput, config.localJwtSecret);
  if (!safeBufferEquals(decoded.signature, expected)) {
    throw new Error("local JWT 签名无效");
  }

  validateTemporalClaims(decoded.payload, now);
  if (config.localIssuer && decoded.payload.iss !== config.localIssuer) {
    throw new Error("local JWT issuer 不匹配");
  }
  if (config.localAudience && !matchesAudience(decoded.payload.aud, config.localAudience)) {
    throw new Error("local JWT audience 不匹配");
  }

  const subject = asNonEmptyString(decoded.payload.sub);
  const tenantId = asNonEmptyString(decoded.payload.tenantId);
  if (!subject || !tenantId) {
    throw new Error("local JWT 缺少 sub/tenantId");
  }

  const user = await store.findUserById(subject);
  const tenantBinding = await store.getUserTenant(tenantId, subject);
  if (user && (user.status !== "active" || tenantBinding?.status === "disabled")) {
    throw new Error("账号已禁用");
  }
  const memberships = await store.listWorkspaceMemberships(tenantId, subject);
  const roleCandidates = [
    ...readRolesFromClaims(decoded.payload.roles),
    ...memberships.map((item) => item.role)
  ];
  const workspaceIds = dedupStrings([
    ...readWorkspaceIdsFromClaims(decoded.payload.workspaceIds),
    ...memberships.map((item) => item.workspaceId)
  ]);
  return {
    subject,
    tenantId,
    workspaceIds: workspaceIds.length > 0 ? workspaceIds : ["w_default"],
    roles: dedupRoles(roleCandidates.length > 0 ? roleCandidates : ["member"]),
    authSource: "local",
    displayName: asNonEmptyString(decoded.payload.username) ?? user?.displayName ?? user?.username,
    claims: pickClaimSnapshot(decoded.payload)
  };
}

async function verifyExternalToken(
  token: string,
  config: AuthRuntimeConfig,
  store: AuthStore,
  now: () => Date,
  jwksProvider: () => Promise<JwkSetCache>
): Promise<Principal> {
  const decoded = decodeJwt(token);
  if (decoded.header.alg !== "RS256") {
    throw new Error("external JWT alg 必须为 RS256");
  }
  const kid = asNonEmptyString(decoded.header.kid);
  if (!kid) {
    throw new Error("external JWT 缺少 kid");
  }

  const jwks = await jwksProvider();
  const jwk = jwks.keysByKid.get(kid);
  if (!jwk) {
    throw new Error(`JWKS 未找到 kid=${kid}`);
  }
  const keyObject = createPublicKey({
    key: jwk as any,
    format: "jwk"
  });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(decoded.signingInput);
  verifier.end();
  const ok = verifier.verify(keyObject, decoded.signature);
  if (!ok) {
    throw new Error("external JWT 签名无效");
  }

  validateTemporalClaims(decoded.payload, now);
  if (config.jwtIssuer && decoded.payload.iss !== config.jwtIssuer) {
    throw new Error("external JWT issuer 不匹配");
  }
  if (config.jwtAudience && !matchesAudience(decoded.payload.aud, config.jwtAudience)) {
    throw new Error("external JWT audience 不匹配");
  }

  const subject = asNonEmptyString(decoded.payload.sub);
  const tenantId = asNonEmptyString(decoded.payload.tenantId);
  if (!subject || !tenantId) {
    throw new Error("external JWT 缺少 sub/tenantId");
  }
  const username =
    asNonEmptyString(decoded.payload.username) ??
    asNonEmptyString(decoded.payload.preferred_username) ??
    `ext_${subject}`;
  const mappedRoles = mapExternalRoles(decoded.payload.roles, config.externalRoleMap);
  const workspaceIdsFromClaim = readWorkspaceIdsFromClaims(decoded.payload.workspaceIds);
  const preferredWorkspaceId = workspaceIdsFromClaim[0] ?? "w_default";
  const user = await store.upsertExternalIdentity({
    provider: config.jwtIssuer ?? "external-jwt",
    subject,
    tenantId,
    username,
    displayName: asNonEmptyString(decoded.payload.name) ?? asNonEmptyString(decoded.payload.username),
    email: asNonEmptyString(decoded.payload.email),
    claims: decoded.payload,
    defaultWorkspaceId: preferredWorkspaceId,
    role: mappedRoles[0] ?? "member"
  });
  await store.touchLastLogin(user.id);
  const memberships = await store.listWorkspaceMemberships(tenantId, user.id);
  const workspaceIds = dedupStrings([
    ...workspaceIdsFromClaim,
    ...memberships.map((item) => item.workspaceId)
  ]);
  const roles = dedupRoles([
    ...mappedRoles,
    ...memberships.map((item) => item.role)
  ]);
  return {
    subject: user.id,
    tenantId,
    workspaceIds: workspaceIds.length > 0 ? workspaceIds : ["w_default"],
    roles: roles.length > 0 ? roles : ["member"],
    authSource: "external",
    displayName: user.displayName ?? username,
    claims: pickClaimSnapshot(decoded.payload)
  };
}

async function getJwksCache(
  config: AuthRuntimeConfig,
  cached: JwkSetCache | undefined,
  now: () => Date
): Promise<JwkSetCache> {
  if (cached && cached.expiresAtMs > now().getTime()) {
    return cached;
  }
  const jwksUrl = config.jwksUrl;
  if (!jwksUrl) {
    throw new Error("缺少 OPENFOAL_JWKS_URL");
  }
  const payload = await getJsonFromUrl(jwksUrl);
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  const keysByKid = new Map<string, Record<string, unknown>>();
  for (const key of keys) {
    if (!key || typeof key !== "object" || Array.isArray(key)) {
      continue;
    }
    const obj = key as Record<string, unknown>;
    const kid = asNonEmptyString(obj.kid);
    if (!kid) {
      continue;
    }
    keysByKid.set(kid, obj);
  }
  if (keysByKid.size === 0) {
    throw new Error("JWKS keys 为空");
  }
  return {
    keysByKid,
    expiresAtMs: now().getTime() + 5 * 60 * 1000
  };
}

function canInvokeMethod(principal: Principal, method: MethodName): boolean {
  if (hasRole(principal, "tenant_admin")) {
    return true;
  }
  if (hasRole(principal, "workspace_admin")) {
    if (WORKSPACE_ADMIN_RESTRICTED_METHODS.has(method)) {
      return false;
    }
    if (!ENTERPRISE_WRITE_METHODS.has(method)) {
      return true;
    }
    return WORKSPACE_ADMIN_ALLOWED_WRITES.has(method);
  }
  if (MEMBER_RESTRICTED_METHODS.has(method)) {
    return false;
  }
  if (!ENTERPRISE_WRITE_METHODS.has(method)) {
    return true;
  }
  return false;
}

function canAccessWorkspace(principal: Principal, workspaceId: string): boolean {
  if (hasRole(principal, "tenant_admin")) {
    return true;
  }
  return principal.workspaceIds.includes(workspaceId);
}

function hasRole(principal: Principal, role: PrincipalRole): boolean {
  return principal.roles.includes(role);
}

function principalSnapshot(principal: Principal): Record<string, unknown> {
  return {
    subject: principal.subject,
    tenantId: principal.tenantId,
    workspaceIds: [...principal.workspaceIds],
    roles: [...principal.roles],
    authSource: principal.authSource,
    ...(principal.displayName ? { displayName: principal.displayName } : {})
  };
}

function parseExternalRoleMap(value: unknown): Record<string, PrincipalRole> {
  const defaultMap: Record<string, PrincipalRole> = {
    ADMIN: "tenant_admin",
    TENANT_ADMIN: "tenant_admin",
    WORKSPACE_ADMIN: "workspace_admin",
    USER: "member",
    MEMBER: "member"
  };
  if (typeof value !== "string" || value.trim().length === 0) {
    return defaultMap;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return defaultMap;
    }
    const out: Record<string, PrincipalRole> = {};
    for (const [key, role] of Object.entries(parsed as Record<string, unknown>)) {
      out[String(key).toUpperCase()] = normalizeRole(role);
    }
    return {
      ...defaultMap,
      ...out
    };
  } catch {
    return defaultMap;
  }
}

function mapExternalRoles(value: unknown, mapping: Record<string, PrincipalRole>): PrincipalRole[] {
  const out: PrincipalRole[] = [];
  if (Array.isArray(value)) {
    for (const role of value) {
      const key = String(role ?? "").trim().toUpperCase();
      if (!key) {
        continue;
      }
      out.push(mapping[key] ?? "member");
    }
  } else if (typeof value === "string") {
    const key = value.trim().toUpperCase();
    if (key) {
      out.push(mapping[key] ?? "member");
    }
  }
  return dedupRoles(out);
}

function decodeJwt(token: string): DecodedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("JWT 格式错误");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const headerText = base64UrlDecodeToText(headerB64);
  const payloadText = base64UrlDecodeToText(payloadB64);
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(headerText);
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error("JWT JSON 解析失败");
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    throw new Error("JWT header 非对象");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JWT payload 非对象");
  }
  return {
    header,
    payload,
    signingInput: `${headerB64}.${payloadB64}`,
    signature: base64UrlDecodeToBuffer(signatureB64)
  };
}

function signHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = signHs256(signingInput, secret);
  return `${signingInput}.${base64UrlEncodeBuffer(signature)}`;
}

function signHs256(signingInput: string, secret: string): any {
  const hmac = createHmac("sha256", secret);
  hmac.update(signingInput);
  return hmac.digest();
}

function validateTemporalClaims(payload: Record<string, unknown>, now: () => Date): void {
  const nowSec = Math.floor(now().getTime() / 1000);
  const exp = asNumber(payload.exp);
  if (typeof exp === "number" && exp <= nowSec) {
    throw new Error("token 已过期");
  }
  const nbf = asNumber(payload.nbf);
  if (typeof nbf === "number" && nbf > nowSec) {
    throw new Error("token 尚未生效");
  }
}

function matchesAudience(rawAud: unknown, expected: string): boolean {
  if (typeof rawAud === "string") {
    return rawAud === expected;
  }
  if (Array.isArray(rawAud)) {
    return rawAud.some((item) => typeof item === "string" && item === expected);
  }
  return false;
}

function readRolesFromClaims(value: unknown): PrincipalRole[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PrincipalRole[] = [];
  for (const item of value) {
    out.push(normalizeRole(item));
  }
  return dedupRoles(out);
}

function readWorkspaceIdsFromClaims(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return dedupStrings(
    value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0)
  );
}

function readMembershipWorkspaces(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const workspaceId = asNonEmptyString((item as Record<string, unknown>).workspaceId);
    if (!workspaceId) {
      continue;
    }
    out.push(workspaceId);
  }
  return dedupStrings(out);
}

function pickClaimSnapshot(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(asNonEmptyString(payload.sub) ? { sub: payload.sub } : {}),
    ...(asNonEmptyString(payload.tenantId) ? { tenantId: payload.tenantId } : {}),
    ...(asNonEmptyString(payload.username) ? { username: payload.username } : {}),
    ...(asNonEmptyString(payload.preferred_username) ? { preferred_username: payload.preferred_username } : {}),
    ...(payload.roles !== undefined ? { roles: payload.roles } : {}),
    ...(payload.workspaceIds !== undefined ? { workspaceIds: payload.workspaceIds } : {}),
    ...(asNonEmptyString(payload.iss) ? { iss: payload.iss } : {}),
    ...(payload.aud !== undefined ? { aud: payload.aud } : {})
  };
}

function hashPassword(password: string): string {
  const iterations = 120000;
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return `pbkdf2$${String(iterations)}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function hashPasswordForStorage(password: string): string {
  return hashPassword(password);
}

function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  const actual = pbkdf2Sync(password, salt, Math.floor(iterations), expected.length, "sha256");
  return safeBufferEquals(actual, expected);
}

async function getJsonFromUrl(urlText: string): Promise<Record<string, unknown>> {
  const url = new URL(urlText);
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
  return await new Promise((resolve, reject) => {
    const req = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname || "/"}${url.search || ""}`,
        method: "GET",
        headers: {
          accept: "application/json"
        }
      },
      (res: any) => {
        const chunks: any[] = [];
        res.on("data", (chunk: any) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const statusCode = typeof res.statusCode === "number" ? res.statusCode : 500;
          const text = Buffer.concat(chunks).toString("utf8");
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`JWKS 请求失败 HTTP ${String(statusCode)}`));
            return;
          }
          try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              reject(new Error("JWKS 响应不是 JSON 对象"));
              return;
            }
            resolve(parsed as Record<string, unknown>);
          } catch {
            reject(new Error("JWKS JSON 解析失败"));
          }
        });
      }
    );
    req.on("error", (error: Error) => {
      reject(error);
    });
    req.end();
  });
}

function dedupStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function dedupRoles(items: PrincipalRole[]): PrincipalRole[] {
  const order: PrincipalRole[] = ["tenant_admin", "workspace_admin", "member"];
  const seen = new Set<PrincipalRole>(items);
  return order.filter((role) => seen.has(role));
}

function normalizeRole(value: unknown): PrincipalRole {
  if (value === "tenant_admin" || value === "workspace_admin") {
    return value;
  }
  return "member";
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeOptionalString(value: unknown): string | undefined {
  const out = asNonEmptyString(value);
  return out && out.length > 0 ? out : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
}

function parseDurationSeconds(raw: unknown, fallback: number): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallback;
  }
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    return Math.max(60, Number(value));
  }
  const m = /^(\d+)([smhd])$/i.exec(value);
  if (!m) {
    return fallback;
  }
  const amount = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ratio = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return Math.max(60, amount * ratio);
}

function readString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function safeBufferEquals(a: any, b: any): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function base64UrlEncode(text: string): string {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeBuffer(buffer: any): string {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecodeToText(value: string): string {
  return base64UrlDecodeToBuffer(value).toString("utf8");
}

function base64UrlDecodeToBuffer(value: string): any {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(`${padded}${padding}`, "base64");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
