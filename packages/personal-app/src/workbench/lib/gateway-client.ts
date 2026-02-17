import {
  GatewayClient,
  GatewayRpcError,
  type GatewayAuditItem,
  type GatewaySkillBundle,
  type GatewaySkillBundleSummary,
  type GatewaySkillCatalogItem,
  type GatewaySkillCatalogResult,
  type GatewayInstalledSkill,
  type GatewaySkillSyncConfigPatch,
  type GatewaySkillSyncConfigResponse,
  type GatewaySkillSyncStatus,
  type GatewaySkillSyncStatusResponse,
  type GatewaySkillSyncRun,
  type GatewayMemoryAppendResult,
  type GatewayMemoryArchiveResult,
  type GatewayMemoryReadResult,
  type GatewayMemorySearchResult,
  type GatewayMetricsSummary,
  type GatewaySandboxUsage,
  type GatewayModelKeyMeta,
  type GatewayPolicy,
  type GatewayPolicyPatch,
  type GatewaySession,
  type GatewayTranscriptItem,
  type PolicyDecision,
  type RpcEvent,
  type RunAgentParams,
  type RunAgentStreamHandlers,
  type SkillSyncScope,
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
  GatewaySandboxUsage,
  GatewayModelKeyMeta,
  GatewayAuditItem,
  GatewaySkillSyncConfigPatch,
  GatewaySkillSyncConfigResponse,
  GatewaySkillSyncStatusResponse,
  GatewaySkillSyncStatus,
  GatewaySkillSyncRun,
  GatewaySkillCatalogResult,
  GatewaySkillCatalogItem,
  GatewayInstalledSkill,
  GatewaySkillBundleSummary,
  GatewaySkillBundle,
  SkillSyncScope,
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
      getAccessToken: readAccessTokenFromStorage,
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

  async getSandboxUsage(params: { sessionId: string; executionTargetId?: string }): Promise<GatewaySandboxUsage> {
    return await this.client.getSandboxUsage(params);
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

  async listSkillCatalog(params: {
    scope?: SkillSyncScope;
    userId?: string;
    timezone?: string;
  } = {}): Promise<GatewaySkillCatalogResult> {
    return await this.client.listSkillCatalog(params);
  }

  async refreshSkillCatalog(params: {
    scope?: SkillSyncScope;
    userId?: string;
    timezone?: string;
    offline?: boolean;
  } = {}): Promise<{ run: GatewaySkillSyncRun; itemCount: number; availability: "online" | "cached" | "unavailable" }> {
    return await this.client.refreshSkillCatalog(params);
  }

  async listInstalledSkills(params: {
    scope?: SkillSyncScope;
    userId?: string;
  } = {}): Promise<GatewayInstalledSkill[]> {
    return await this.client.listInstalledSkills(params);
  }

  async installSkill(params: {
    skillId: string;
    scope?: SkillSyncScope;
    userId?: string;
  }): Promise<GatewayInstalledSkill> {
    return await this.client.installSkill(params);
  }

  async uninstallSkill(params: {
    skillId: string;
    scope?: SkillSyncScope;
    userId?: string;
  }): Promise<{ skillId: string; removed: boolean }> {
    return await this.client.uninstallSkill(params);
  }

  async getSkillSyncConfig(params: {
    scope?: SkillSyncScope;
    userId?: string;
    timezone?: string;
  } = {}): Promise<GatewaySkillSyncConfigResponse> {
    return await this.client.getSkillSyncConfig(params);
  }

  async upsertSkillSyncConfig(input: {
    scope?: SkillSyncScope;
    userId?: string;
    timezone?: string;
    config: GatewaySkillSyncConfigPatch;
  }): Promise<GatewaySkillSyncConfigResponse> {
    return await this.client.upsertSkillSyncConfig(input);
  }

  async getSkillSyncStatus(params: {
    scope?: SkillSyncScope;
    userId?: string;
    timezone?: string;
  } = {}): Promise<GatewaySkillSyncStatusResponse> {
    return await this.client.getSkillSyncStatus(params);
  }

  async runSkillSyncNow(params: {
    scope?: SkillSyncScope;
    userId?: string;
    timezone?: string;
    offline?: boolean;
  } = {}): Promise<{ run: GatewaySkillSyncRun; status: GatewaySkillSyncStatus }> {
    return await this.client.runSkillSyncNow(params);
  }

  async listSkillBundles(): Promise<GatewaySkillBundleSummary[]> {
    return await this.client.listSkillBundles();
  }

  async importSkillBundle(input: { bundle: GatewaySkillBundle }): Promise<{
    bundle: GatewaySkillBundle;
    importedCount: number;
    catalogSize: number;
  }> {
    return await this.client.importSkillBundle(input);
  }

  async exportSkillBundle(input: {
    bundleId?: string;
    name?: string;
    skillIds?: string[];
  } = {}): Promise<GatewaySkillBundle> {
    return await this.client.exportSkillBundle(input);
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

function readAccessTokenFromStorage(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const token = window.localStorage.getItem("openfoal_access_token");
  if (typeof token !== "string") {
    return undefined;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export { GatewayRpcError };
