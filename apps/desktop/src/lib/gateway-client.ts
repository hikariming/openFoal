export type RuntimeMode = "local" | "cloud";

type GatewayMethod =
  | "connect"
  | "agent.run"
  | "agent.abort"
  | "runtime.setMode"
  | "sessions.list";

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

const SIDE_EFFECT_METHODS = new Set<GatewayMethod>(["agent.run", "agent.abort", "runtime.setMode"]);

export type GatewaySession = {
  id: string;
  sessionKey: string;
  runtimeMode: RuntimeMode;
  syncState: string;
  updatedAt: string;
};

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
    const sessions = result.response.ok ? result.response.payload.sessions : [];
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions.filter(isGatewaySession);
  }

  async setRuntimeMode(sessionId: string, runtimeMode: RuntimeMode): Promise<void> {
    await this.ensureConnected();
    await this.request("runtime.setMode", {
      sessionId,
      runtimeMode
    });
  }

  async runAgent(params: {
    sessionId: string;
    input: string;
    runtimeMode: RuntimeMode;
    llm?: {
      provider?: string;
      modelId?: string;
      apiKey?: string;
      baseUrl?: string;
      streamMode?: "real" | "mock";
    };
  }): Promise<{ runId?: string; events: RpcEvent[] }> {
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

function isGatewaySession(value: unknown): value is GatewaySession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.sessionKey === "string" &&
    (item.runtimeMode === "local" || item.runtimeMode === "cloud") &&
    typeof item.syncState === "string" &&
    typeof item.updatedAt === "string"
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
