import { createRuntimeCoreService, type CoreEvent, type CoreService } from "../../../packages/core/dist/index.js";
import {
  DEFAULT_SESSION_PREVIEW,
  DEFAULT_SESSION_TITLE,
  InMemoryIdempotencyRepository,
  InMemorySessionRepository,
  InMemoryTranscriptRepository,
  SqliteIdempotencyRepository,
  SqliteSessionRepository,
  SqliteTranscriptRepository,
  type IdempotencyRepository,
  type RuntimeMode,
  type SessionRecord,
  type SessionRepository,
  type TranscriptRepository
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
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createServer } from "node:http";
// @ts-ignore -- workspace backend packages do not currently ship root-level @types/node.
import { createHash } from "node:crypto";

declare const Buffer: any;

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

export interface GatewayHandleOptions {
  transport?: "http" | "ws";
  onEvent?: (event: EventFrame) => void;
}

export interface GatewayRouter {
  handle(input: unknown, state: ConnectionState, options?: GatewayHandleOptions): Promise<GatewayHandleResult>;
}

export interface GatewayServerOptions {
  host?: string;
  port?: number;
  sqlitePath?: string;
  router?: GatewayRouter;
}

export interface GatewayServerHandle {
  host: string;
  port: number;
  close(): Promise<void>;
}

interface GatewayDeps {
  coreService?: CoreService;
  sessionRepo?: SessionRepository;
  transcriptRepo?: TranscriptRepository;
  idempotencyRepo?: IdempotencyRepository;
  now?: () => Date;
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
  const coreService = deps.coreService ?? createRuntimeCoreService();
  const sessionRepo = deps.sessionRepo ?? new InMemorySessionRepository();
  const transcriptRepo = deps.transcriptRepo ?? new InMemoryTranscriptRepository();
  const idempotencyRepo = deps.idempotencyRepo ?? new InMemoryIdempotencyRepository();
  const now = deps.now ?? (() => new Date());

  return {
    async handle(input: unknown, state: ConnectionState, options: GatewayHandleOptions = {}): Promise<GatewayHandleResult> {
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
        const existing = await idempotencyRepo.get(idempotencyKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            return {
              response: makeErrorRes(req.id, "IDEMPOTENCY_CONFLICT", "同幂等键参数不一致"),
              events: []
            };
          }
          const replayed = cloneResult(existing.result as GatewayHandleResult);
          if ((options.transport ?? "http") === "ws" && options.onEvent) {
            for (const event of replayed.events) {
              options.onEvent(event);
            }
          }
          return replayed;
        }
      }

      const result = await route(req, state, coreService, sessionRepo, transcriptRepo, now, options);

      if (idempotencyKey && result.response.ok) {
        await idempotencyRepo.set(idempotencyKey, {
          fingerprint,
          result: cloneResult(result)
        });
      }

      return result;
    }
  };
}

export async function startGatewayServer(options: GatewayServerOptions = {}): Promise<GatewayServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const router =
    options.router ??
    createGatewayRouter({
      sessionRepo: new SqliteSessionRepository(options.sqlitePath),
      transcriptRepo: new SqliteTranscriptRepository(options.sqlitePath),
      idempotencyRepo: new SqliteIdempotencyRepository(options.sqlitePath)
    });
  const httpConnections = new Map<string, ConnectionState>();
  const sockets = new Set<any>();

  const server = createServer(async (req: any, res: any) => {
    try {
      await handleHttpRequest(req, res, router, httpConnections);
    } catch (error) {
      writeJson(res, 500, {
        error: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.on("upgrade", (req: any, socket: any, head: any) => {
    void handleUpgrade(req, socket, head, router);
  });
  server.on("connection", (socket: any) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await listen(server, host, port);
  const addr = server.address();
  const actualPort = addr && typeof addr === "object" ? addr.port : port;

  return {
    host,
    port: actualPort,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await closeServer(server);
    }
  };
}

async function route(
  req: ReqFrame,
  state: ConnectionState,
  coreService: CoreService,
  sessionRepo: SessionRepository,
  transcriptRepo: TranscriptRepository,
  now: () => Date,
  options: GatewayHandleOptions
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

    case "sessions.create": {
      const titleParam = requireString(req.params, "title");
      const runtimeMode = asRuntimeMode(req.params.runtimeMode) ?? "local";
      const session = createSession(createSessionId(), runtimeMode, titleParam ?? DEFAULT_SESSION_TITLE);
      await sessionRepo.upsert(session);
      return {
        response: makeSuccessRes(req.id, { session }),
        events: [createEvent(state, "session.updated", { session })]
      };
    }

    case "sessions.list": {
      const items = await sessionRepo.list();
      return {
        response: makeSuccessRes(req.id, { items }),
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

    case "sessions.history": {
      const sessionId = requireString(req.params, "sessionId");
      if (!sessionId) {
        return invalidParams(req.id, "sessions.history 需要 sessionId");
      }

      const session = await sessionRepo.get(sessionId);
      if (!session) {
        return {
          response: makeErrorRes(req.id, "INVALID_REQUEST", `未知会话: ${sessionId}`),
          events: []
        };
      }

      const rawLimit = req.params.limit;
      const parsedLimit = rawLimit === undefined ? 200 : asPositiveInt(rawLimit);
      if (rawLimit !== undefined && !parsedLimit) {
        return invalidParams(req.id, "sessions.history 的 limit 必须是正整数");
      }
      const limit = Math.min(parsedLimit ?? 200, 500);

      const rawBeforeId = req.params.beforeId;
      const beforeId = rawBeforeId === undefined ? undefined : asPositiveInt(rawBeforeId);
      if (rawBeforeId !== undefined && !beforeId) {
        return invalidParams(req.id, "sessions.history 的 beforeId 必须是正整数");
      }

      const items = await transcriptRepo.list(sessionId, limit, beforeId);
      return {
        response: makeSuccessRes(req.id, { items }),
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
      const llm = asLlmOptions(req.params.llm);
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

      const allEvents: EventFrame[] = [];
      const responseEvents: EventFrame[] = [];
      let acceptedRunId = "";
      const emit = (event: EventFrame): void => {
        allEvents.push(event);
        options.onEvent?.(event);
        if ((options.transport ?? "http") === "http" && isHttpCompatibleRunEvent(event.event)) {
          responseEvents.push(event);
        }
      };

      await transcriptRepo.append({
        sessionId,
        event: "user.input",
        payload: { input },
        createdAt: now().toISOString()
      });

      const sessionWithInput = withSessionInput(session, input);
      if (sessionWithInput.title !== session.title || sessionWithInput.preview !== session.preview) {
        await sessionRepo.upsert(sessionWithInput);
        const refreshed = await sessionRepo.get(sessionId);
        session = refreshed ?? sessionWithInput;
        emit(createEvent(state, "session.updated", { session }));
      }

      state.runningSessionIds.add(sessionId);
      try {
        for await (const coreEvent of coreService.run({
          sessionId,
          input,
          runtimeMode: session.runtimeMode,
          ...(llm ? { llm } : {})
        })) {
          const mapped = mapCoreEvent(coreEvent);
          if (mapped.event === "agent.accepted") {
            const runId = mapped.payload.runId;
            if (typeof runId === "string") {
              acceptedRunId = runId;
            }
          }
          emit(createEvent(state, mapped.event, mapped.payload));
        }
      } finally {
        state.runningSessionIds.delete(sessionId);
      }

      const queuedMode = state.queuedModeChanges.get(sessionId);
      if (queuedMode) {
        state.queuedModeChanges.delete(sessionId);
        const updated = await sessionRepo.setRuntimeMode(sessionId, queuedMode);
        if (updated) {
          emit(
            createEvent(state, "runtime.mode_changed", {
              sessionId,
              runtimeMode: queuedMode,
              status: "applied"
            })
          );
          emit(createEvent(state, "session.updated", { session: updated }));
        }
      }

      if (!acceptedRunId) {
        await persistTranscript(sessionId, transcriptRepo, undefined, allEvents, now);
        return {
          response: makeErrorRes(req.id, "INTERNAL_ERROR", "agent.run 未返回 runId"),
          events: responseEvents
        };
      }

      await persistTranscript(sessionId, transcriptRepo, acceptedRunId, allEvents, now);

      return {
        response: makeSuccessRes(req.id, {
          runId: acceptedRunId,
          status: "accepted"
        }),
        events: responseEvents
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

async function persistTranscript(
  sessionId: string,
  transcriptRepo: TranscriptRepository,
  runId: string | undefined,
  events: EventFrame[],
  now: () => Date
): Promise<void> {
  for (const event of filterEventsForTranscript(events)) {
    await transcriptRepo.append({
      sessionId,
      runId,
      event: event.event,
      payload: event.payload,
      createdAt: now().toISOString()
    });
  }
}

const TRANSCRIPT_KEY_EVENT_NAMES = new Set<EventFrame["event"]>([
  "agent.accepted",
  "agent.delta",
  "agent.tool_call_start",
  "agent.tool_call",
  "agent.tool_result_start",
  "agent.tool_result",
  "agent.completed",
  "agent.failed",
  "runtime.mode_changed",
  "session.updated"
]);

function filterEventsForTranscript(events: EventFrame[]): EventFrame[] {
  return events.filter((event) => TRANSCRIPT_KEY_EVENT_NAMES.has(event.event));
}

async function handleHttpRequest(
  req: any,
  res: any,
  router: GatewayRouter,
  httpConnections: Map<string, ConnectionState>
): Promise<void> {
  const method = typeof req.method === "string" ? req.method.toUpperCase() : "";
  const pathname = readPathname(req.url, req.headers?.host);

  if (method === "OPTIONS") {
    writeCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/health") {
    writeJson(res, 200, {
      ok: true,
      service: "gateway",
      time: new Date().toISOString()
    });
    return;
  }

  if (method === "POST" && pathname === "/rpc") {
    const body = await readJsonBody(req);
    const connectionId = readConnectionId(req.url, req.headers?.host, req.headers?.["x-openfoal-connection-id"]);
    const state = getOrCreateConnectionState(httpConnections, connectionId);
    const result = await router.handle(body, state, {
      transport: "http"
    });
    writeJson(res, 200, result);
    return;
  }

  writeJson(res, 404, {
    error: "NOT_FOUND"
  });
}

async function handleUpgrade(req: any, socket: any, head: any, router: GatewayRouter): Promise<void> {
  try {
    const pathname = readPathname(req.url, req.headers?.host);
    if (pathname !== "/ws") {
      writeUpgradeFailure(socket, 404, "Not Found");
      return;
    }

    const wsKey = req.headers?.["sec-websocket-key"];
    if (typeof wsKey !== "string" || wsKey.trim().length === 0) {
      writeUpgradeFailure(socket, 400, "Missing Sec-WebSocket-Key");
      return;
    }

    const accept = createHash("sha1")
      .update(`${wsKey.trim()}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        ""
      ].join("\r\n")
    );

    const state = createConnectionState();
    let raw = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
    let processing = Promise.resolve();

    socket.on("data", (chunk: any) => {
      raw = Buffer.concat([raw, chunk]);
      processing = processing
        .then(async () => {
          while (true) {
            const parsed = tryParseWsFrame(raw);
            if (!parsed) {
              break;
            }
            raw = parsed.rest;

            if (parsed.opcode === 0x8) {
              socket.end();
              return;
            }

            if (parsed.opcode === 0x9) {
              socket.write(encodeWsFrame(parsed.payload, 0x0a));
              continue;
            }

            if (parsed.opcode !== 0x1) {
              continue;
            }

            const text = parsed.payload.toString("utf8");
            let input: unknown;
            try {
              input = JSON.parse(text);
            } catch {
              input = text;
            }

            const method = readWsMethod(input);
            if (method === "agent.run") {
              const result = await router.handle(input, state, {
                transport: "ws",
                onEvent: (event) => {
                  socket.write(encodeWsFrame(Buffer.from(JSON.stringify(event), "utf8"), 0x1));
                }
              });
              socket.write(encodeWsFrame(Buffer.from(JSON.stringify(result.response), "utf8"), 0x1));
              continue;
            }

            const result = await router.handle(input, state, {
              transport: "ws"
            });
            socket.write(encodeWsFrame(Buffer.from(JSON.stringify(result.response), "utf8"), 0x1));
            for (const event of result.events) {
              socket.write(encodeWsFrame(Buffer.from(JSON.stringify(event), "utf8"), 0x1));
            }
          }
        })
        .catch(() => {
          if (!socket.destroyed) {
            socket.destroy();
          }
        });
    });

    socket.on("error", () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    });
  } catch {
    if (!socket.destroyed) {
      socket.destroy();
    }
  }
}

function writeUpgradeFailure(socket: any, code: number, message: string): void {
  socket.write(
    [
      `HTTP/1.1 ${code} ${message}`,
      "Connection: close",
      "Content-Length: 0",
      "",
      ""
    ].join("\r\n")
  );
  socket.destroy();
}

function tryParseWsFrame(raw: any): { opcode: number; payload: any; rest: any } | null {
  if (raw.length < 2) {
    return null;
  }

  const first = raw[0];
  const second = raw[1];
  const opcode = first & 0x0f;
  let offset = 2;
  let payloadLength = second & 0x7f;
  const masked = (second & 0x80) !== 0;

  if (payloadLength === 126) {
    if (raw.length < offset + 2) {
      return null;
    }
    payloadLength = raw.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (raw.length < offset + 8) {
      return null;
    }
    const high = raw.readUInt32BE(offset);
    const low = raw.readUInt32BE(offset + 4);
    payloadLength = high * 2 ** 32 + low;
    offset += 8;
  }

  let mask: any = null;
  if (masked) {
    if (raw.length < offset + 4) {
      return null;
    }
    mask = raw.subarray(offset, offset + 4);
    offset += 4;
  }

  if (raw.length < offset + payloadLength) {
    return null;
  }

  const payload = Buffer.from(raw.subarray(offset, offset + payloadLength));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = payload[i] ^ mask[i % 4];
    }
  }

  return {
    opcode,
    payload,
    rest: raw.subarray(offset + payloadLength)
  };
}

function encodeWsFrame(payload: any, opcode: number): any {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header: number[] = [0x80 | (opcode & 0x0f)];

  if (bytes.length < 126) {
    header.push(bytes.length);
  } else if (bytes.length <= 0xffff) {
    header.push(126, (bytes.length >>> 8) & 0xff, bytes.length & 0xff);
  } else {
    const high = Math.floor(bytes.length / 2 ** 32);
    const low = bytes.length >>> 0;
    header.push(
      127,
      (high >>> 24) & 0xff,
      (high >>> 16) & 0xff,
      (high >>> 8) & 0xff,
      high & 0xff,
      (low >>> 24) & 0xff,
      (low >>> 16) & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff
    );
  }

  return Buffer.concat([Buffer.from(header), bytes]);
}

function readPathname(rawUrl: string | undefined, host: string | undefined): string {
  const url = new URL(rawUrl ?? "/", `http://${host ?? "127.0.0.1"}`);
  return url.pathname;
}

function readConnectionId(rawUrl: string | undefined, host: string | undefined, headerValue: unknown): string {
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  const url = new URL(rawUrl ?? "/", `http://${host ?? "127.0.0.1"}`);
  const fromQuery = url.searchParams.get("connectionId");
  return fromQuery && fromQuery.trim().length > 0 ? fromQuery.trim() : "http_default";
}

function readWsMethod(input: unknown): MethodName | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const method = (input as Record<string, unknown>).method;
  if (typeof method !== "string") {
    return undefined;
  }
  return method as MethodName;
}

async function readJsonBody(req: any): Promise<unknown> {
  const chunks: any[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: any) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve();
    });
    req.on("error", (error: unknown) => {
      reject(error);
    });
  });

  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function writeJson(res: any, statusCode: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.statusCode = statusCode;
  writeCorsHeaders(res);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(Buffer.byteLength(text)));
  res.end(text);
}

function writeCorsHeaders(res: any): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-openfoal-connection-id");
}

function getOrCreateConnectionState(
  states: Map<string, ConnectionState>,
  connectionId: string
): ConnectionState {
  const existing = states.get(connectionId);
  if (existing) {
    return existing;
  }
  const created = createConnectionState();
  states.set(connectionId, created);
  return created;
}

async function listen(server: any, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: any): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function createSession(id: string, runtimeMode: RuntimeMode, title = DEFAULT_SESSION_TITLE): SessionRecord {
  return {
    id,
    sessionKey: `workspace:w_default/agent:a_default/main:thread:${id}`,
    title: normalizeSessionTitle(title),
    preview: DEFAULT_SESSION_PREVIEW,
    runtimeMode,
    syncState: "local_only",
    updatedAt: new Date().toISOString()
  };
}

function createSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function withSessionInput(session: SessionRecord, input: string): SessionRecord {
  const nextTitle =
    session.title === DEFAULT_SESSION_TITLE ? normalizeSessionTitle(summarizeInputForTitle(input)) : session.title;
  const nextPreview = summarizeInputForPreview(input);
  return {
    ...session,
    title: nextTitle,
    preview: nextPreview
  };
}

function summarizeInputForTitle(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return DEFAULT_SESSION_TITLE;
  }
  return compact.slice(0, 32);
}

function summarizeInputForPreview(input: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) {
    return DEFAULT_SESSION_PREVIEW;
  }
  return compact.slice(0, 80);
}

function normalizeSessionTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return DEFAULT_SESSION_TITLE;
  }
  return compact.slice(0, 32);
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
    case "tool_call_start":
      return {
        event: "agent.tool_call_start",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName
        }
      };
    case "tool_call_delta":
      return {
        event: "agent.tool_call_delta",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          delta: coreEvent.delta
        }
      };
    case "tool_call":
      return {
        event: "agent.tool_call",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          args: coreEvent.args
        }
      };
    case "tool_result_start":
      return {
        event: "agent.tool_result_start",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName
        }
      };
    case "tool_result_delta":
      return {
        event: "agent.tool_result_delta",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
          toolName: coreEvent.toolName,
          delta: coreEvent.delta
        }
      };
    case "tool_result":
      return {
        event: "agent.tool_result",
        payload: {
          runId: coreEvent.runId,
          toolCallId: coreEvent.toolCallId,
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

function isHttpCompatibleRunEvent(eventName: EventFrame["event"]): boolean {
  return (
    eventName !== "agent.tool_call_start" &&
    eventName !== "agent.tool_call_delta" &&
    eventName !== "agent.tool_result_start" &&
    eventName !== "agent.tool_result_delta"
  );
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

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const floored = Math.floor(value);
  if (floored <= 0) {
    return undefined;
  }
  return floored;
}

function asLlmOptions(
  value: unknown
):
  | {
      modelRef?: string;
      provider?: string;
      modelId?: string;
      apiKey?: string;
      baseUrl?: string;
      streamMode?: "real" | "mock";
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const data = value as Record<string, unknown>;
  const modelRef = requireString(data, "modelRef");
  const provider = requireString(data, "provider");
  const modelId = requireString(data, "modelId");
  const apiKey = requireString(data, "apiKey");
  const baseUrl = requireString(data, "baseUrl");
  const streamMode = data.streamMode === "real" || data.streamMode === "mock" ? data.streamMode : undefined;

  if (!modelRef && !provider && !modelId && !apiKey && !baseUrl && !streamMode) {
    return undefined;
  }

  return {
    ...(modelRef ? { modelRef } : {}),
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(streamMode ? { streamMode } : {})
  };
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
