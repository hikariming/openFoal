import { create } from "zustand";

export type RuntimeMode = "local" | "cloud";
export type SyncState = "local_only" | "syncing" | "synced" | "conflict";

export type LlmProfile = {
  id: string;
  name: string;
  modelRef: string;
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
};

export type LlmConfig = {
  activeProfileId: string;
  profiles: LlmProfile[];
};

export type SessionItem = {
  id: string;
  sessionKey: string;
  title: string;
  updatedAt: string;
  preview: string;
  runtimeMode: RuntimeMode;
  syncState: SyncState;
  contextUsage: number;
  compactionCount: number;
  memoryFlushState: "idle" | "pending" | "flushed" | "skipped";
  memoryFlushAt?: string;
};

type AppStore = {
  sessions: SessionItem[];
  activeSessionId: string;
  llmConfig: LlmConfig;
  setSessions: (sessions: SessionItem[]) => void;
  upsertSession: (session: SessionItem) => void;
  setActiveSession: (sessionId: string) => void;
  setRuntimeMode: (runtimeMode: RuntimeMode) => void;
  setLlmConfig: (patch: Partial<LlmConfig>) => void;
};

const DEFAULT_LLM_PROFILES: LlmProfile[] = [
  {
    id: "profile_kimi_k2p5",
    name: "Kimi · k2p5",
    modelRef: "",
    provider: "kimi",
    modelId: "k2p5",
    apiKey: "",
    baseUrl: "https://api.moonshot.cn/v1"
  },
  {
    id: "profile_openai_4omini",
    name: "OpenAI · gpt-4o-mini",
    modelRef: "",
    provider: "openai",
    modelId: "gpt-4o-mini",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1"
  },
  {
    id: "profile_anthropic_sonnet",
    name: "Anthropic · claude-sonnet-4-5",
    modelRef: "",
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    apiKey: "",
    baseUrl: "https://api.anthropic.com"
  }
];

const DEFAULT_LLM_CONFIG: LlmConfig = {
  activeProfileId: DEFAULT_LLM_PROFILES[0].id,
  profiles: DEFAULT_LLM_PROFILES
};

const LLM_CONFIG_STORAGE_KEY = "openfoal.desktop.llmConfig.v2";
const LEGACY_LLM_CONFIG_STORAGE_KEY = "openfoal.desktop.llmConfig.v1";

export const useAppStore = create<AppStore>((set) => ({
  sessions: [],
  activeSessionId: "",
  llmConfig: readLlmConfig(),
  setSessions: (sessions) =>
    set((prev) => {
      const sorted = sortSessions(sessions.map(normalizeSessionItem));
      const activeExists = sorted.some((session) => session.id === prev.activeSessionId);
      return {
        sessions: sorted,
        activeSessionId: activeExists ? prev.activeSessionId : sorted[0]?.id ?? ""
      };
    }),
  upsertSession: (session) =>
    set((prev) => {
      const normalizedSession = normalizeSessionItem(session);
      const exists = prev.sessions.some((item) => item.id === session.id);
      const merged = exists
        ? prev.sessions.map((item) => (item.id === session.id ? normalizedSession : item))
        : [...prev.sessions, normalizedSession];
      const sorted = sortSessions(merged);
      return {
        sessions: sorted,
        activeSessionId: prev.activeSessionId || normalizedSession.id
      };
    }),
  setActiveSession: (sessionId) =>
    set((prev) => {
      if (!prev.sessions.some((session) => session.id === sessionId)) {
        return {};
      }
      return { activeSessionId: sessionId };
    }),
  setRuntimeMode: (runtimeMode) =>
    set((prev) => {
      const targetId = prev.activeSessionId;
      if (!targetId) {
        return {};
      }
      return {
        sessions: prev.sessions.map((session) =>
          session.id === targetId
            ? {
                ...session,
                runtimeMode
              }
            : session
        )
      };
    }),
  setLlmConfig: (patch) =>
    set((prev) => {
      const next = normalizeLlmConfig({
        ...prev.llmConfig,
        ...patch
      });
      writeLlmConfig(next);
      return { llmConfig: next };
    })
}));

export function getActiveSession(sessions: SessionItem[], activeSessionId: string): SessionItem | undefined {
  return sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
}

export function getSessionRuntimeMode(sessions: SessionItem[], activeSessionId: string): RuntimeMode {
  return getActiveSession(sessions, activeSessionId)?.runtimeMode ?? "local";
}

export function getActiveLlmProfile(config: LlmConfig): LlmProfile {
  const active = config.profiles.find((item) => item.id === config.activeProfileId);
  return active ?? config.profiles[0] ?? DEFAULT_LLM_CONFIG.profiles[0];
}

export function createLlmProfile(seed?: Partial<LlmProfile>): LlmProfile {
  const generatedId = `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const provider = firstNonEmpty(seed?.provider, "kimi") ?? "kimi";
  const modelId = firstNonEmpty(seed?.modelId, "k2p5") ?? "k2p5";
  const baseUrl = firstNonEmpty(seed?.baseUrl, baseUrlByProvider(provider)) ?? "";
  const name = firstNonEmpty(seed?.name, `${provider} · ${modelId}`) ?? `${provider} · ${modelId}`;
  return {
    id: firstNonEmpty(seed?.id, generatedId) ?? generatedId,
    name,
    modelRef: firstNonEmpty(seed?.modelRef) ?? "",
    provider,
    modelId,
    apiKey: firstNonEmpty(seed?.apiKey) ?? "",
    baseUrl
  };
}

function readLlmConfig(): LlmConfig {
  if (typeof window === "undefined") {
    return DEFAULT_LLM_CONFIG;
  }

  const raw = window.localStorage.getItem(LLM_CONFIG_STORAGE_KEY);
  if (raw) {
    try {
      return normalizeLlmConfig(JSON.parse(raw));
    } catch {
      return DEFAULT_LLM_CONFIG;
    }
  }

  const legacyRaw = window.localStorage.getItem(LEGACY_LLM_CONFIG_STORAGE_KEY);
  if (!legacyRaw) {
    return DEFAULT_LLM_CONFIG;
  }

  try {
    return normalizeLlmConfig(parseLegacyLlmConfig(JSON.parse(legacyRaw)));
  } catch {
    return DEFAULT_LLM_CONFIG;
  }
}

function parseLegacyLlmConfig(value: unknown): LlmConfig {
  if (!isRecord(value)) {
    return DEFAULT_LLM_CONFIG;
  }

  const provider = firstNonEmpty(asString(value.provider), DEFAULT_LLM_CONFIG.profiles[0].provider);
  const modelId = firstNonEmpty(asString(value.modelId), DEFAULT_LLM_CONFIG.profiles[0].modelId);
  const apiKey = firstNonEmpty(asString(value.apiKey)) ?? "";
  const baseUrl = firstNonEmpty(asString(value.baseUrl), DEFAULT_LLM_CONFIG.profiles[0].baseUrl);
  const profile = createLlmProfile({
    id: "profile_legacy",
    name: "Legacy",
    provider: provider ?? "kimi",
    modelId: modelId ?? "k2p5",
    apiKey,
    baseUrl: baseUrl ?? ""
  });
  return {
    activeProfileId: profile.id,
    profiles: [profile]
  };
}

function normalizeLlmConfig(value: unknown): LlmConfig {
  if (!isRecord(value)) {
    return DEFAULT_LLM_CONFIG;
  }

  const profilesInput = Array.isArray(value.profiles) ? value.profiles : [];
  const normalizedProfiles: LlmProfile[] = [];
  const seen = new Set<string>();

  for (const item of profilesInput) {
    if (!isRecord(item)) {
      continue;
    }
    const profile = createLlmProfile({
      id: asString(item.id) ?? undefined,
      name: asString(item.name) ?? undefined,
      modelRef: asString(item.modelRef) ?? undefined,
      provider: asString(item.provider) ?? undefined,
      modelId: asString(item.modelId) ?? undefined,
      apiKey: asString(item.apiKey) ?? undefined,
      baseUrl: asString(item.baseUrl) ?? undefined
    });
    if (seen.has(profile.id)) {
      continue;
    }
    seen.add(profile.id);
    normalizedProfiles.push(profile);
  }

  const profiles = normalizedProfiles.length > 0 ? normalizedProfiles : DEFAULT_LLM_CONFIG.profiles;
  const activeProfileId = firstNonEmpty(asString(value.activeProfileId), profiles[0].id) ?? profiles[0].id;
  const activeExists = profiles.some((item) => item.id === activeProfileId);

  return {
    activeProfileId: activeExists ? activeProfileId : profiles[0].id,
    profiles
  };
}

function writeLlmConfig(value: LlmConfig): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(LLM_CONFIG_STORAGE_KEY, JSON.stringify(value));
}

function baseUrlByProvider(provider: string): string {
  if (provider === "openai") {
    return "https://api.openai.com/v1";
  }
  if (provider === "anthropic") {
    return "https://api.anthropic.com";
  }
  return "https://api.moonshot.cn/v1";
}

function sortSessions(sessions: SessionItem[]): SessionItem[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeSessionItem(session: SessionItem): SessionItem {
  return {
    ...session,
    contextUsage: typeof session.contextUsage === "number" ? session.contextUsage : 0,
    compactionCount: typeof session.compactionCount === "number" ? session.compactionCount : 0,
    memoryFlushState:
      session.memoryFlushState === "pending" ||
      session.memoryFlushState === "flushed" ||
      session.memoryFlushState === "skipped"
        ? session.memoryFlushState
        : "idle",
    ...(typeof session.memoryFlushAt === "string" ? { memoryFlushAt: session.memoryFlushAt } : {})
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
