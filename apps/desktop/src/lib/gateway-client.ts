export type RuntimeMode = "local" | "cloud";

type GatewayMethod =
  | "connect"
  | "agent.run"
  | "agent.abort"
  | "runtime.setMode"
  | "sessions.create"
  | "sessions.list"
  | "sessions.get"
  | "sessions.history";

type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "METHOD_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "SESSION_BUSY"
  | "POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "MODEL_UNAVAILABLE"
  | "TOOL_EXEC_FAILED"
  | "INTERNAL_ERROR";

interface RpcRequestFrame {
  type: "req";
  id: string;
  method: GatewayMethod;
  params: Record<string, unknown>;
}

interface RpcError {
  code: ErrorCode;
  message: string;
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
  error: RpcError;
}

type RpcResponse = RpcResponseSuccess | RpcResponseFailure;

export interface RpcEvent {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
  seq: number;
  stateVersion: number;
}

interface RpcEnvelope {
  response: RpcResponse;
  events: RpcEvent[];
}

export class GatewayRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayRpcError";
    this.code = code;
  }
}

interface GatewayClientOptions {
  baseUrl?: string;
  connectionId?: string;
}

const SIDE_EFFECT_METHODS = new Set<GatewayMethod>(["agent.run", "agent.abort", "runtime.setMode", "sessions.create"]);

export type GatewaySession = {
  id: string;
  sessionKey: string;
  title: string;
  preview: string;
  runtimeMode: RuntimeMode;
  syncState: string;
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
    streamMode?: "real" | "mock";
  };
}

export interface RunAgentStreamHandlers {
  onEvent?: (event: RpcEvent) => void;
}

export class GatewayHttpClient {
  private readonly baseUrl: string;
  private readonly connectionId: string;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private requestCounter = 0;

  constructor(options: GatewayClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? readDefaultBaseUrl());
    this.connectionId = options.connectionId ?? createConnectionId();
  }

  async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      const result = await this.request("connect", {
        client: {
          name: "desktop",
          version: "0.1.0"
        },
        workspaceId: "w_default"
      });
      if (!result.response.ok) {
        throw new GatewayRpcError(result.response.error.code, result.response.error.message);
      }
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
    const items = result.response.ok ? result.response.payload.items : [];
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
    const session = result.response.ok ? result.response.payload.session : null;
    if (!isGatewaySession(session)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid sessions.create payload");
    }
    return session;
  }

  async getSession(sessionId: string): Promise<GatewaySession | null> {
    await this.ensureConnected();
    const result = await this.request("sessions.get", { sessionId });
    const session = result.response.ok ? result.response.payload.session : null;
    if (session == null) {
      return null;
    }
    if (!isGatewaySession(session)) {
      throw new GatewayRpcError("INVALID_RESPONSE", "Invalid sessions.get payload");
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
    const items = result.response.ok ? result.response.payload.items : [];
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isGatewayTranscriptItem);
  }

  async setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode): Promise<void> {
    await this.ensureConnected();
    await this.request("runtime.setMode", {
      sessionId,
      runtimeMode
    });
  }

  async runAgent(params: RunAgentParams): Promise<{ runId?: string; events: RpcEvent[] }> {
    await this.ensureConnected();
    const result = await this.request("agent.run", {
      sessionId: params.sessionId,
      input: params.input,
      runtimeMode: params.runtimeMode,
      ...(params.llm ? { llm: params.llm } : {})
    });
    if (!result.response.ok) {
      throw new GatewayRpcError(result.response.error.code, result.response.error.message);
    }
    const runId = asString(result.response.payload.runId);
    return {
      runId,
      events: result.events
    };
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

      const fallback = await this.runAgent(params);
      for (const event of fallback.events) {
        handlers.onEvent?.(event);
      }
      return {
        ...fallback,
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

    const wsUrl = toWebSocketUrl(this.baseUrl);
    const ws = await openWebSocket(wsUrl);
    const collectedEvents: RpcEvent[] = [];
    let runRequestSent = false;
    const pending = new Map<
      string,
      {
        resolve: (value: RpcResponse) => void;
        reject: (error: Error) => void;
      }
    >();
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

    const requestOverWs = (method: GatewayMethod, params: Record<string, unknown>): Promise<RpcResponse> => {
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
              ...params,
              idempotencyKey: createIdempotencyKey(method)
            }
          : params
      };

      return new Promise<RpcResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(frame));
      });
    };

    try {
      const connectRes = await requestOverWs("connect", {
        client: {
          name: "desktop",
          version: "0.1.0"
        },
        workspaceId: "w_default"
      });
      if (!connectRes.ok) {
        throw new GatewayWsPreflightError(connectRes.error.message);
      }

      runRequestSent = true;
      const runRes = await requestOverWs("agent.run", {
        sessionId: params.sessionId,
        input: params.input,
        runtimeMode: params.runtimeMode,
        ...(params.llm ? { llm: params.llm } : {})
      });

      if (!runRes.ok) {
        throw new GatewayRpcError(runRes.error.code, runRes.error.message);
      }

      const runId = asString(runRes.payload.runId);
      cleanup();
      return {
        runId,
        events: collectedEvents
      };
    } catch (error) {
      cleanup();
      if (error instanceof GatewayRpcError) {
        throw error;
      }
      if (runRequestSent) {
        throw new GatewayRpcError("NETWORK_ERROR", toErrorMessage(error));
      }
      throw new GatewayWsPreflightError(toErrorMessage(error));
    }
  }

  async abortRun(runId: string): Promise<void> {
    await this.ensureConnected();
    await this.request("agent.abort", {
      runId
    });
  }

  private async request(method: GatewayMethod, params: Record<string, unknown>): Promise<RpcEnvelope> {
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

    let response: Response;
    try {
      response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(req)
      });
    } catch (error) {
      throw new GatewayRpcError("NETWORK_ERROR", toErrorMessage(error));
    }

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
    return payload;
  }
}

let singletonClient: GatewayHttpClient | null = null;

export function getGatewayClient(): GatewayHttpClient {
  if (singletonClient) {
    return singletonClient;
  }
  singletonClient = new GatewayHttpClient();
  return singletonClient;
}

class GatewayWsPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayWsPreflightError";
  }
}

function readDefaultBaseUrl(): string {
  const raw = import.meta.env.VITE_GATEWAY_BASE_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return "http://127.0.0.1:8787";
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return normalized;
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      reject(new GatewayWsPreflightError(toErrorMessage(error)));
      return;
    }

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      ws.close();
      reject(new GatewayWsPreflightError("WebSocket open timeout"));
    }, 3000);

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
      reject(new GatewayWsPreflightError("WebSocket open failed"));
    };
  });
}

function parseWsJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createConnectionId(): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `desktop_${Date.now()}_${rand}`;
}

function createIdempotencyKey(method: GatewayMethod): string {
  return `${method}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
}

function isRpcEnvelope(value: Partial<RpcEnvelope>): value is RpcEnvelope {
  return Boolean(value.response && typeof value.response === "object" && Array.isArray(value.events));
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const frame = value as Partial<RpcResponse>;
  return frame.type === "res" && typeof frame.id === "string" && typeof frame.ok === "boolean";
}

function isRpcEvent(value: unknown): value is RpcEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const frame = value as Partial<RpcEvent>;
  return (
    frame.type === "event" &&
    typeof frame.event === "string" &&
    typeof frame.seq === "number" &&
    typeof frame.stateVersion === "number" &&
    Boolean(frame.payload && typeof frame.payload === "object")
  );
}

function isGatewaySession(value: unknown): value is GatewaySession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.sessionKey === "string" &&
    typeof item.title === "string" &&
    typeof item.preview === "string" &&
    (item.runtimeMode === "local" || item.runtimeMode === "cloud") &&
    typeof item.syncState === "string" &&
    typeof item.updatedAt === "string"
  );
}

function isGatewayTranscriptItem(value: unknown): value is GatewayTranscriptItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "number" &&
    typeof item.sessionId === "string" &&
    (item.runId === undefined || typeof item.runId === "string") &&
    typeof item.event === "string" &&
    Boolean(item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)) &&
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
