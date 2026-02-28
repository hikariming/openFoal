export const METHODS = [
  "connect",
  "agent.run",
  "agent.abort",
  "runtime.setMode",
  "sessions.create",
  "sessions.list",
  "sessions.get",
  "sessions.history",
  "agents.list",
  "agents.upsert",
  "users.list",
  "users.create",
  "users.updateStatus",
  "users.resetPassword",
  "users.updateMemberships",
  "secrets.upsertModelKey",
  "secrets.getModelKeyMeta",
  "executionTargets.list",
  "executionTargets.upsert",
  "budget.get",
  "budget.update",
  "policy.get",
  "policy.update",
  "audit.query",
  "metrics.summary",
  "sandbox.usage",
  "memory.get",
  "memory.search",
  "memory.appendDaily",
  "memory.archive",
  "context.get",
  "context.upsert",
  "skills.catalog.list",
  "skills.catalog.refresh",
  "skills.installed.list",
  "skills.install",
  "skills.uninstall",
  "skills.syncConfig.get",
  "skills.syncConfig.upsert",
  "skills.syncStatus.get",
  "skills.sync.runNow",
  "skills.bundle.import",
  "skills.bundle.export",
  "skills.bundle.list",
  "infra.health",
  "infra.storage.reconcile"
] as const;

export const EVENTS = [
  "agent.accepted",
  "agent.delta",
  "agent.tool_call_start",
  "agent.tool_call_delta",
  "agent.tool_call",
  "agent.tool_result_start",
  "agent.tool_result_delta",
  "agent.tool_result",
  "agent.completed",
  "agent.failed",
  "runtime.mode_changed",
  "session.updated"
] as const;

export const ERROR_CODES = [
  "UNAUTHORIZED",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "TENANT_SCOPE_MISMATCH",
  "WORKSPACE_SCOPE_MISMATCH",
  "INVALID_REQUEST",
  "METHOD_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "SESSION_BUSY",
  "POLICY_DENIED",
  "MODEL_UNAVAILABLE",
  "TOOL_EXEC_FAILED",
  "INTERNAL_ERROR"
] as const;

export const SIDE_EFFECT_METHODS = new Set<MethodName>([
  "agent.run",
  "agent.abort",
  "runtime.setMode",
  "sessions.create",
  "agents.upsert",
  "users.create",
  "users.updateStatus",
  "users.resetPassword",
  "users.updateMemberships",
  "secrets.upsertModelKey",
  "executionTargets.upsert",
  "budget.update",
  "policy.update",
  "memory.appendDaily",
  "memory.archive",
  "context.upsert",
  "skills.catalog.refresh",
  "skills.install",
  "skills.uninstall",
  "skills.syncConfig.upsert",
  "skills.sync.runNow",
  "skills.bundle.import",
  "skills.bundle.export",
  "infra.storage.reconcile"
]);

export type MethodName = (typeof METHODS)[number];
export type EventName = (typeof EVENTS)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];
export type RuntimeMode = "local" | "cloud";
export type ExecutionMode = "local_sandbox" | "enterprise_cloud";
export type UserRole = "tenant_admin" | "workspace_admin" | "member";
export type UserStatus = "active" | "disabled";
export const AUDIT_ACTIONS = [
  "users.created",
  "users.status_changed",
  "users.password_reset",
  "users.memberships_updated",
  "secrets.model_key_upserted",
  "execution.mode_changed"
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type SyncState = "local_only" | "syncing" | "synced" | "conflict";

export interface Session {
  id: string;
  sessionKey: string;
  tenantId: string;
  workspaceId: string;
  ownerUserId: string;
  visibility: "private" | "workspace";
  title: string;
  preview: string;
  runtimeMode: RuntimeMode;
  syncState: SyncState;
  contextUsage: number;
  compactionCount: number;
  memoryFlushState: "idle" | "pending" | "flushed" | "skipped";
  memoryFlushAt?: string;
  updatedAt: string;
}

export interface ReqFrame {
  type: "req";
  id: string;
  method: MethodName;
  params: Record<string, unknown>;
}

export interface ResSuccessFrame {
  type: "res";
  id: string;
  ok: true;
  payload: Record<string, unknown>;
}

export interface ResFailureFrame {
  type: "res";
  id: string;
  ok: false;
  error: ProtocolError;
}

export type ResFrame = ResSuccessFrame | ResFailureFrame;

export interface EventFrame {
  type: "event";
  event: EventName;
  payload: Record<string, unknown>;
  seq: number;
  stateVersion: number;
}

export interface ProtocolError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ProtocolError };

const METHOD_SET = new Set<string>(METHODS);

export function isSideEffectMethod(method: MethodName): boolean {
  return SIDE_EFFECT_METHODS.has(method);
}

export function makeErrorRes(
  id: string,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): ResFailureFrame {
  return {
    type: "res",
    id,
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  };
}

export function makeSuccessRes(id: string, payload: Record<string, unknown>): ResSuccessFrame {
  return {
    type: "res",
    id,
    ok: true,
    payload
  };
}

export function validateReqFrame(input: unknown): ValidationResult<ReqFrame> {
  if (!isRecord(input)) {
    return invalid("请求帧必须是对象");
  }

  if (input.type !== "req") {
    return invalid("请求帧 type 必须为 req");
  }

  if (!isNonEmptyString(input.id)) {
    return invalid("请求帧 id 必须是非空字符串");
  }

  if (!isNonEmptyString(input.method)) {
    return invalid("请求帧 method 必须是非空字符串");
  }

  if (!METHOD_SET.has(input.method)) {
    return {
      ok: false,
      error: {
        code: "METHOD_NOT_FOUND",
        message: `未知方法: ${input.method}`
      }
    };
  }

  if (!isRecord(input.params)) {
    return invalid("请求帧 params 必须是对象");
  }

  const method = input.method as MethodName;
  if (isSideEffectMethod(method)) {
    const key = input.params.idempotencyKey;
    if (!isNonEmptyString(key)) {
      return invalid(`side-effect 方法 ${method} 需要 idempotencyKey`);
    }
  }

  return {
    ok: true,
    data: {
      type: "req",
      id: input.id,
      method,
      params: input.params
    }
  };
}

function invalid(message: string): ValidationResult<ReqFrame> {
  return {
    ok: false,
    error: {
      code: "INVALID_REQUEST",
      message
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
