export type RuntimeMode = "local" | "cloud";

type GatewayMethod =
  | "connect"
  | "agent.run"
  | "sessions.create"
  | "sessions.list"
  | "sessions.history";

interface RpcRequestFrame {
  type: "req";
  id: string;
  method: GatewayMethod;
  params: Record<string, unknown>;
}

interface RpcResponseSuccess {
  type: "res";
  id: string;
  ok: true;
  payload: Record<string, unknown>;
}

interface RpcResponseFailure {
  type: "res";
  id: string;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

type RpcResponse = RpcResponseSuccess | RpcResponseFailure;

interface RpcEnvelope {
  response: RpcResponse;
  events: RpcEvent[];
}

interface RpcSuccessEnvelope {
  response: RpcResponseSuccess;
  events: RpcEvent[];
}

const SIDE_EFFECT_METHODS = new Set<GatewayMethod>(["agent.run", "sessions.create"]);

export interface RpcEvent {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
  seq: number;
  stateVersion: number;
}

export type GatewaySession = {
  id: string;
  sessionKey: string;
  title: string;
  preview: string;
  runtimeMode: RuntimeMode;
  syncState: string;
  contextUsage: number;
  compactionCount: number;
  memoryFlushState: "idle" | "pending" | "flushed" | "skipped";
  memoryFlushAt?: string;
  updatedAt: string;
};

export type GatewayTranscriptItem = {
  id: number;
  sessionId: string;
  runId?: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export interface RunAgentParams {
  sessionId: string;
  input: string;
  runtimeMode: RuntimeMode;
  llm?: {
    modelRef?: string;
    provider?: string;
    modelId?: string;
    apiKey?: string;
    baseUrl?: string;
  };
}

export interface RunAgentStreamHandlers {
  onEvent?: (event: RpcEvent) => void;
}

export class GatewayRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayRpcError";
    this.code = code;
  }
}

export interface PersonalGatewayClientOptions {
  baseUrl?: string;
  clientName?: string;
  clientVersion?: string;
  workspaceId?: string;
}

export class GatewayClient {
  private readonly baseUrl: string;
  private readonly connectionId: string;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly workspaceId: string;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private requestCounter = 0;

  constructor(options: PersonalGatewayClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? readDefaultBaseUrl());
    this.connectionId = createConnectionId();
    this.clientName = options.clientName ?? "personal-shell";
    this.clientVersion = options.clientVersion ?? "0.1.0";
    this.workspaceId = options.workspaceId ?? "w_default";
  }

  async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      await this.request("connect", {
        client: {
          name: this.clientName,
          version: this.clientVersion
        },
        workspaceId: this.workspaceId
      });
      this.connected = true;
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async listSessions(): Promise<GatewaySession[]> {
    await this.ensureConnected();
    const result = await this.request("sessions.list", {});
    const items = result.response.payload.items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isGatewaySession);
  }

  async createSession(params?: { title?: string; runtimeMode?: RuntimeMode }): Promise<GatewaySession> {
    await this.ensureConnected();
    const result = await this.request("sessions.create", {
      ...(params?.title ? { title: params.title } : {}),
      ...(params?.runtimeMode ? { runtimeMode: params.runtimeMode } : {})
    });
    const session = result.response.payload.session;
    if (!isGatewaySession(session)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid sessions.create payload");
    }
    return session;
  }

  async getSessionHistory(params: {
    sessionId: string;
    limit?: number;
    beforeId?: number;
  }): Promise<GatewayTranscriptItem[]> {
    await this.ensureConnected();
    const result = await this.request("sessions.history", {
      sessionId: params.sessionId,
      ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      ...(typeof params.beforeId === "number" ? { beforeId: params.beforeId } : {})
    });
    const items = result.response.payload.items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isGatewayTranscriptItem);
  }

  async runAgentStream(
    params: RunAgentParams,
    handlers: RunAgentStreamHandlers = {}
  ): Promise<{ runId?: string; events: RpcEvent[]; transport: "ws" | "http" }> {
    try {
      const wsResult = await this.runAgentViaWs(params, handlers);
      return {
        ...wsResult,
        transport: "ws"
      };
    } catch (error) {
      if (!(error instanceof GatewayWsPreflightError)) {
        throw error;
      }
      const fallback = await this.request("agent.run", {
        sessionId: params.sessionId,
        input: params.input,
        runtimeMode: params.runtimeMode,
        ...(params.llm ? { llm: params.llm } : {})
      });
      for (const event of fallback.events) {
        handlers.onEvent?.(event);
      }
      return {
        runId: asString(fallback.response.payload.runId),
        events: fallback.events,
        transport: "http"
      };
    }
  }

  private async runAgentViaWs(
    params: RunAgentParams,
    handlers: RunAgentStreamHandlers
  ): Promise<{ runId?: string; events: RpcEvent[] }> {
    if (typeof WebSocket === "undefined") {
      throw new GatewayWsPreflightError("WebSocket is unavailable");
    }

    const ws = await openWebSocket(toWebSocketUrl(this.baseUrl));
    const collectedEvents: RpcEvent[] = [];
    const pending = new Map<string, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }>();
    let closed = false;

    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      for (const waiter of pending.values()) {
        waiter.reject(new GatewayRpcError("NETWORK_ERROR", "WebSocket closed"));
      }
      pending.clear();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    ws.onmessage = (msg) => {
      const parsed = parseWsJson(msg.data);
      if (!parsed) {
        return;
      }
      if (isRpcEvent(parsed)) {
        collectedEvents.push(parsed);
        handlers.onEvent?.(parsed);
        return;
      }
      if (isRpcResponse(parsed)) {
        const waiter = pending.get(parsed.id);
        if (!waiter) {
          return;
        }
        pending.delete(parsed.id);
        waiter.resolve(parsed);
      }
    };

    ws.onclose = () => {
      cleanup();
    };
    ws.onerror = () => {
      cleanup();
    };

    const requestOverWs = (method: GatewayMethod, paramsValue: Record<string, unknown>): Promise<RpcResponse> => {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new GatewayWsPreflightError("WebSocket is not open");
      }
      const id = `ws_r_${++this.requestCounter}`;
      const frame: RpcRequestFrame = {
        type: "req",
        id,
        method,
        params: SIDE_EFFECT_METHODS.has(method)
          ? {
              ...paramsValue,
              idempotencyKey: createIdempotencyKey(method)
            }
          : paramsValue
      };

      return new Promise<RpcResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(frame));
      });
    };

    const connectRes = await requestOverWs("connect", {
      client: {
        name: this.clientName,
        version: this.clientVersion
      },
      workspaceId: this.workspaceId
    });

    if (!connectRes.ok) {
      cleanup();
      throw new GatewayWsPreflightError(`${connectRes.error.code}: ${connectRes.error.message}`);
    }

    const runRes = await requestOverWs("agent.run", {
      sessionId: params.sessionId,
      input: params.input,
      runtimeMode: params.runtimeMode,
      ...(params.llm ? { llm: params.llm } : {})
    });

    if (!runRes.ok) {
      cleanup();
      throw new GatewayRpcError(runRes.error.code, runRes.error.message);
    }

    await waitForTerminalEvent(collectedEvents, ws, pending, handlers);

    cleanup();
    return {
      runId: asString(runRes.payload.runId),
      events: collectedEvents
    };
  }

  private async request(method: GatewayMethod, params: Record<string, unknown>): Promise<RpcSuccessEnvelope> {
    const id = `r_${++this.requestCounter}`;
    const req: RpcRequestFrame = {
      type: "req",
      id,
      method,
      params: SIDE_EFFECT_METHODS.has(method)
        ? {
            ...params,
            idempotencyKey: createIdempotencyKey(method)
          }
        : params
    };

    const endpoint = new URL("/rpc", this.baseUrl);
    endpoint.searchParams.set("connectionId", this.connectionId);

    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(req)
    }).catch((error: unknown) => {
      throw new GatewayRpcError("NETWORK_ERROR", toErrorMessage(error));
    });

    if (!response.ok) {
      throw new GatewayRpcError("HTTP_ERROR", `HTTP ${response.status}`);
    }

    const payload = (await response.json()) as Partial<RpcEnvelope>;
    if (!isRpcEnvelope(payload)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid gateway response");
    }
    if (!payload.response.ok) {
      throw new GatewayRpcError(payload.response.error.code, payload.response.error.message);
    }
    return {
      response: payload.response,
      events: payload.events
    };
  }
}

function readDefaultBaseUrl(): string {
  const runtime = readRuntimeGatewayBaseUrl();
  if (runtime) {
    return runtime;
  }

  if (typeof import.meta !== "undefined" && import.meta.env) {
    const raw = (import.meta.env as Record<string, unknown>).VITE_GATEWAY_BASE_URL;
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim();
    }
  }

  if (typeof window !== "undefined" && typeof window.location?.origin === "string") {
    const origin = window.location.origin.trim();
    if (origin.startsWith("http://") || origin.startsWith("https://")) {
      return origin;
    }
  }

  return "http://127.0.0.1:8787";
}

function readRuntimeGatewayBaseUrl(): string | undefined {
  const config = (globalThis as { __OPENFOAL_CONFIG__?: { gatewayBaseUrl?: unknown } }).__OPENFOAL_CONFIG__;
  const value = typeof config?.gatewayBaseUrl === "string" ? config.gatewayBaseUrl.trim() : "";
  return value.length > 0 ? value : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function createConnectionId(): string {
  return `personal_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function createIdempotencyKey(method: GatewayMethod): string {
  return `idem_${method}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function isRpcEnvelope(value: Partial<RpcEnvelope>): value is RpcEnvelope {
  return Boolean(value.response && typeof value.response === "object" && Array.isArray(value.events));
}

function isGatewaySession(value: unknown): value is GatewaySession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.sessionKey === "string" &&
    typeof item.title === "string" &&
    typeof item.preview === "string" &&
    (item.runtimeMode === "local" || item.runtimeMode === "cloud") &&
    typeof item.contextUsage === "number" &&
    typeof item.compactionCount === "number" &&
    typeof item.updatedAt === "string"
  );
}

function isGatewayTranscriptItem(value: unknown): value is GatewayTranscriptItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "number" &&
    typeof item.sessionId === "string" &&
    typeof item.event === "string" &&
    Boolean(item.payload && typeof item.payload === "object") &&
    typeof item.createdAt === "string"
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

function parseWsJson(data: unknown): RpcEvent | RpcResponse | null {
  if (typeof data !== "string") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (isRpcEvent(parsed)) {
    return parsed;
  }
  if (isRpcResponse(parsed)) {
    return parsed;
  }
  return null;
}

function isRpcEvent(value: unknown): value is RpcEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const frame = value as Record<string, unknown>;
  return (
    frame.type === "event" &&
    typeof frame.event === "string" &&
    typeof frame.seq === "number" &&
    typeof frame.stateVersion === "number" &&
    Boolean(frame.payload && typeof frame.payload === "object")
  );
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const frame = value as Record<string, unknown>;
  if (frame.type !== "res" || typeof frame.id !== "string") {
    return false;
  }
  if (frame.ok === true) {
    return Boolean(frame.payload && typeof frame.payload === "object");
  }
  if (frame.ok === false) {
    return Boolean(frame.error && typeof frame.error === "object");
  }
  return false;
}

class GatewayWsPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayWsPreflightError";
  }
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      ws.close();
      reject(new GatewayWsPreflightError("WebSocket timeout"));
    }, 4000);

    ws.onopen = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(ws);
    };

    ws.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new GatewayWsPreflightError("WebSocket connection failed"));
    };
  });
}

function waitForTerminalEvent(
  events: RpcEvent[],
  ws: WebSocket,
  pending: Map<string, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }>,
  handlers: RunAgentStreamHandlers
): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      const hasTerminal = events.some((event) => event.event === "agent.completed" || event.event === "agent.failed");
      if (hasTerminal) {
        cleanup();
        resolve();
      }
    };

    const onMessage = (msg: MessageEvent): void => {
      const parsed = parseWsJson(msg.data);
      if (!parsed) {
        return;
      }
      if (isRpcEvent(parsed)) {
        events.push(parsed);
        handlers.onEvent?.(parsed);
        check();
        return;
      }
      if (isRpcResponse(parsed)) {
        const waiter = pending.get(parsed.id);
        if (!waiter) {
          return;
        }
        pending.delete(parsed.id);
        waiter.resolve(parsed);
      }
    };

    const onClose = (): void => {
      cleanup();
      resolve();
    };

    const cleanup = (): void => {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
    };

    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    check();
  });
}
