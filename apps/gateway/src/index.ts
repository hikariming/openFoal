import { createMockCoreService, type CoreEvent, type CoreService } from "../../../packages/core/dist/index.js";
import {
  InMemorySessionRepository,
  type RuntimeMode,
  type SessionRecord,
  type SessionRepository
} from "../../../packages/storage/dist/index.js";
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

export interface ConnectionState {
  connected: boolean;
  nextSeq: number;
  stateVersion: number;
  runningSessionIds: Set<string>;
  queuedModeChanges: Map<string, RuntimeMode>;
}

export interface GatewayHandleResult {
  response: ResFrame;
  events: EventFrame[];
}

export interface GatewayRouter {
  handle(input: unknown, state: ConnectionState): Promise<GatewayHandleResult>;
}

interface GatewayDeps {
  coreService?: CoreService;
  sessionRepo?: SessionRepository;
  now?: () => Date;
}

interface StoredIdempotency {
  fingerprint: string;
  result: GatewayHandleResult;
}

const DEFAULT_POLICY = {
  toolDefault: "deny",
  highRisk: "approval-required",
  bashMode: "sandbox"
};

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
  const coreService = deps.coreService ?? createMockCoreService();
  const sessionRepo = deps.sessionRepo ?? new InMemorySessionRepository();
  const now = deps.now ?? (() => new Date());
  const idempotencyStore = new Map<string, StoredIdempotency>();

  return {
    async handle(input: unknown, state: ConnectionState): Promise<GatewayHandleResult> {
      const validated = validateReqFrame(input);
      if (!validated.ok) {
        return {
          response: makeErrorRes(extractRequestId(input), validated.error.code, validated.error.message),
          events: []
        };
      }

      const req = validated.data;
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
        const existing = idempotencyStore.get(idempotencyKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            return {
              response: makeErrorRes(req.id, "IDEMPOTENCY_CONFLICT", "同幂等键参数不一致"),
              events: []
            };
          }
          return cloneResult(existing.result);
        }
      }

      const result = await route(req, state, coreService, sessionRepo, now);

      if (idempotencyKey && result.response.ok) {
        idempotencyStore.set(idempotencyKey, {
          fingerprint,
          result: cloneResult(result)
        });
      }

      return result;
    }
  };
}

async function route(
  req: ReqFrame,
  state: ConnectionState,
  coreService: CoreService,
  sessionRepo: SessionRepository,
  now: () => Date
): Promise<GatewayHandleResult> {
  switch (req.method) {
    case "connect": {
      state.connected = true;
      return {
        response: makeSuccessRes(req.id, {
          protocolVersion: "1.0.0",
          serverTime: now().toISOString()
        }),
        events: []
      };
    }

    case "sessions.list": {
      const sessions = await sessionRepo.list();
      return {
        response: makeSuccessRes(req.id, { sessions }),
        events: []
      };
    }

    case "sessions.get": {
      const sessionId = requireString(req.params, "sessionId");
      if (!sessionId) {
        return invalidParams(req.id, "sessions.get 需要 sessionId");
      }
      const session = await sessionRepo.get(sessionId);
      return {
        response: makeSuccessRes(req.id, { session: session ?? null }),
        events: []
      };
    }

    case "runtime.setMode": {
      const sessionId = requireString(req.params, "sessionId");
      const runtimeMode = asRuntimeMode(req.params.runtimeMode);
      if (!sessionId || !runtimeMode) {
        return invalidParams(req.id, "runtime.setMode 需要 sessionId 和 runtimeMode(local|cloud)");
      }

      if (state.runningSessionIds.has(sessionId)) {
        state.queuedModeChanges.set(sessionId, runtimeMode);
        return {
          response: makeSuccessRes(req.id, {
            sessionId,
            runtimeMode,
            status: "queued-change",
            effectiveOn: "next_turn"
          }),
          events: []
        };
      }

      const updated = await sessionRepo.setRuntimeMode(sessionId, runtimeMode);
      if (!updated) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", `未知会话: ${sessionId}`),
          events: []
        };
      }

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
          status: "applied"
        }),
        events
      };
    }

    case "agent.run": {
      const sessionId = requireString(req.params, "sessionId");
      const input = requireString(req.params, "input");
      const reqRuntimeMode = asRuntimeMode(req.params.runtimeMode);
      if (!sessionId || !input) {
        return invalidParams(req.id, "agent.run 需要 sessionId 和 input");
      }

      if (state.runningSessionIds.has(sessionId)) {
        return {
          response: makeErrorRes(req.id, "SESSION_BUSY", `会话 ${sessionId} 正在运行`),
          events: []
        };
      }

      let session = await sessionRepo.get(sessionId);
      if (!session) {
        session = createSession(sessionId, reqRuntimeMode ?? "local");
        await sessionRepo.upsert(session);
      }

      if (reqRuntimeMode && reqRuntimeMode !== session.runtimeMode) {
        const updated = await sessionRepo.setRuntimeMode(sessionId, reqRuntimeMode);
        if (updated) {
          session = updated;
        }
      }

      const events: EventFrame[] = [];
      let acceptedRunId = "";

      state.runningSessionIds.add(sessionId);
      try {
        for await (const coreEvent of coreService.run({
          sessionId,
          input,
          runtimeMode: session.runtimeMode
        })) {
          const mapped = mapCoreEvent(coreEvent);
          if (mapped.event === "agent.accepted") {
            const runId = mapped.payload.runId;
            if (typeof runId === "string") {
              acceptedRunId = runId;
            }
          }
          events.push(createEvent(state, mapped.event, mapped.payload));
        }
      } finally {
        state.runningSessionIds.delete(sessionId);
      }

      const queuedMode = state.queuedModeChanges.get(sessionId);
      if (queuedMode) {
        state.queuedModeChanges.delete(sessionId);
        const updated = await sessionRepo.setRuntimeMode(sessionId, queuedMode);
        if (updated) {
          events.push(
            createEvent(state, "runtime.mode_changed", {
              sessionId,
              runtimeMode: queuedMode,
              status: "applied"
            })
          );
          events.push(createEvent(state, "session.updated", { session: updated }));
        }
      }

      if (!acceptedRunId) {
        return {
          response: makeErrorRes(req.id, "INTERNAL_ERROR", "agent.run 未返回 runId"),
          events
        };
      }

      return {
        response: makeSuccessRes(req.id, {
          runId: acceptedRunId,
          status: "accepted"
        }),
        events
      };
    }

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
      return {
        response: makeSuccessRes(req.id, {
          policy: DEFAULT_POLICY
        }),
        events: []
      };
    }

    case "policy.update": {
      return {
        response: makeSuccessRes(req.id, {
          updated: true,
          policy: req.params
        }),
        events: [
          createEvent(state, "session.updated", {
            reason: "policy.updated"
          })
        ]
      };
    }

    case "approval.queue": {
      return {
        response: makeSuccessRes(req.id, {
          items: []
        }),
        events: []
      };
    }

    case "approval.resolve": {
      return {
        response: makeSuccessRes(req.id, {
          resolved: true,
          action: req.params.action ?? null
        }),
        events: [
          createEvent(state, "approval.resolved", {
            action: req.params.action ?? "approve"
          })
        ]
      };
    }

    case "audit.query": {
      return {
        response: makeSuccessRes(req.id, {
          items: []
        }),
        events: []
      };
    }

    case "metrics.summary": {
      return {
        response: makeSuccessRes(req.id, {
          metrics: {
            todo: true
          }
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

function createSession(id: string, runtimeMode: RuntimeMode): SessionRecord {
  return {
    id,
    sessionKey: `workspace:w_default/agent:a_default/main:thread:${id}`,
    runtimeMode,
    syncState: "local_only",
    updatedAt: new Date().toISOString()
  };
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
    case "tool_call":
      return {
        event: "agent.tool_call",
        payload: {
          runId: coreEvent.runId,
          toolName: coreEvent.toolName,
          args: coreEvent.args
        }
      };
    case "tool_result":
      return {
        event: "agent.tool_result",
        payload: {
          runId: coreEvent.runId,
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

function getIdempotencyKey(req: ReqFrame): string | undefined {
  if (!isSideEffectMethod(req.method)) {
    return undefined;
  }
  const value = req.params.idempotencyKey;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function buildIdempotencyCacheKey(req: ReqFrame, idempotencyKey: string): string {
  const scope =
    requireString(req.params, "sessionId") ?? requireString(req.params, "runId") ?? "global";
  return `${req.method}:${scope}:${idempotencyKey}`;
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
