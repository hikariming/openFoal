import {
  GatewayClient,
  GatewayRpcError,
  type GatewayAuditItem,
  type GatewayMemoryAppendResult,
  type GatewayMemoryArchiveResult,
  type GatewayMemoryReadResult,
  type GatewayMemorySearchResult,
  type GatewayMetricsSummary,
  type GatewayModelKeyMeta,
  type GatewayPolicy,
  type GatewayPolicyPatch,
  type GatewaySession,
  type GatewayTranscriptItem,
  type PolicyDecision,
  type RpcEvent,
  type RunAgentParams,
  type RunAgentStreamHandlers,
  type RuntimeMode
} from "../../gateway-client";

export type {
  RuntimeMode,
  PolicyDecision,
  RpcEvent,
  RunAgentParams,
  RunAgentStreamHandlers,
  GatewaySession,
  GatewayTranscriptItem,
  GatewayPolicy,
  GatewayPolicyPatch,
  GatewayMetricsSummary,
  GatewayModelKeyMeta,
  GatewayAuditItem,
  GatewayMemoryReadResult,
  GatewayMemorySearchResult,
  GatewayMemoryArchiveResult,
  GatewayMemoryAppendResult
};

export type GatewayMemorySearchHit = GatewayMemorySearchResult["results"][number];

export class GatewayHttpClient {
  private readonly client: GatewayClient;

  constructor(options: { baseUrl?: string } = {}) {
    this.client = new GatewayClient({
      ...options,
      clientName: "desktop",
      clientVersion: "0.1.0",
      useRuntimeConfig: true,
      useRuntimeToken: true,
      persistAccessToken: false,
      preferWebSocket: true
    });
  }

  async ensureConnected(): Promise<void> {
    await this.client.ensureConnected();
  }

  async listSessions(): Promise<GatewaySession[]> {
    return await this.client.listSessions();
  }

  async createSession(params?: { title?: string; runtimeMode?: RuntimeMode }): Promise<GatewaySession> {
    return await this.client.createSession(params ?? {});
  }

  async getSession(sessionId: string): Promise<GatewaySession | null> {
    return await this.client.getSession({ sessionId });
  }

  async getSessionHistory(params: {
    sessionId: string;
    limit?: number;
    beforeId?: number;
  }): Promise<GatewayTranscriptItem[]> {
    return await this.client.getSessionHistory(params);
  }

  async setRuntimeMode(
    sessionId: string,
    runtimeMode: RuntimeMode
  ): Promise<{ sessionId: string; runtimeMode: RuntimeMode; status: string; effectiveOn?: string }> {
    const result = await this.client.setRuntimeMode({ sessionId, runtimeMode });
    return {
      sessionId: result.sessionId ?? sessionId,
      runtimeMode: result.runtimeMode ?? runtimeMode,
      status: result.status ?? "applied",
      ...(typeof result.effectiveOn === "string" ? { effectiveOn: result.effectiveOn } : {})
    };
  }

  async getPolicy(scopeKey = "default"): Promise<GatewayPolicy> {
    return await this.client.getPolicy({ scopeKey });
  }

  async updatePolicy(patch: GatewayPolicyPatch, scopeKey = "default"): Promise<GatewayPolicy> {
    return await this.client.updatePolicy({ patch, scopeKey });
  }

  async queryAudit(params: {
    action?: string;
    actor?: string;
    resource?: string;
    limit?: number;
    cursor?: number;
  } = {}): Promise<GatewayAuditItem[]> {
    const result = await this.client.queryAudit(params);
    return result.items;
  }

  async getMetricsSummary(): Promise<GatewayMetricsSummary> {
    return await this.client.getMetricsSummary();
  }

  async getModelKeyMeta(params: { provider?: string } = {}): Promise<GatewayModelKeyMeta[]> {
    return await this.client.getModelKeyMeta(params);
  }

  async memoryGet(params: { path?: string; from?: number; lines?: number } = {}): Promise<GatewayMemoryReadResult> {
    return await this.client.memoryGet(params);
  }

  async memorySearch(params: {
    query: string;
    maxResults?: number;
    mode?: "hybrid" | "keyword" | "contains";
  }): Promise<GatewayMemorySearchResult> {
    return await this.client.memorySearch(params);
  }

  async memoryAppendDaily(params: {
    content: string;
    date?: string;
    includeLongTerm?: boolean;
  }): Promise<GatewayMemoryAppendResult> {
    return await this.client.memoryAppendDaily(params);
  }

  async memoryArchive(params: {
    date?: string;
    includeLongTerm?: boolean;
    clearDaily?: boolean;
  } = {}): Promise<GatewayMemoryArchiveResult> {
    return await this.client.memoryArchive(params);
  }

  async runAgent(params: RunAgentParams): Promise<{ runId?: string; events: RpcEvent[] }> {
    return await this.client.runAgent(params);
  }

  async runAgentStream(
    params: RunAgentParams,
    handlers: RunAgentStreamHandlers = {}
  ): Promise<{ runId?: string; events: RpcEvent[]; transport: "ws" | "http" }> {
    return await this.client.runAgentStream(params, handlers);
  }

  async abortRun(runId: string): Promise<void> {
    await this.client.abortRun(runId);
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

export { GatewayRpcError };
