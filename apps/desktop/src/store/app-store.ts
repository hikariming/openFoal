import { create } from "zustand";

export type RuntimeMode = "local" | "cloud";
export type LlmConfig = {
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
};

export type SessionItem = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
};

type AppStore = {
  sessions: SessionItem[];
  activeSessionId: string;
  runtimeMode: RuntimeMode;
  llmConfig: LlmConfig;
  setActiveSession: (sessionId: string) => void;
  setRuntimeMode: (runtimeMode: RuntimeMode) => void;
  setLlmConfig: (patch: Partial<LlmConfig>) => void;
};

const seedSessions: SessionItem[] = [
  {
    id: "s1",
    title: "new-desktop",
    updatedAt: "Today · 14:28",
    preview: "继续优化首页布局和输入区样式"
  },
  {
    id: "s2",
    title: "Skill Store 内容策展",
    updatedAt: "Today · 09:12",
    preview: "补 12 个 featured skills 文案和图标"
  },
  {
    id: "s3",
    title: "Automations 流程草案",
    updatedAt: "Yesterday · 22:40",
    preview: "定义每周巡检自动化输出格式"
  },
  {
    id: "s4",
    title: "Brand Theme v2",
    updatedAt: "Yesterday · 19:03",
    preview: "更新品牌色 token 与 hover 态"
  }
];

const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: "kimi",
  modelId: "k2p5",
  apiKey: "",
  baseUrl: "https://api.moonshot.cn/v1"
};

const LLM_CONFIG_STORAGE_KEY = "openfoal.desktop.llmConfig.v1";

export const useAppStore = create<AppStore>((set) => ({
  sessions: seedSessions,
  activeSessionId: seedSessions[0].id,
  runtimeMode: "local",
  llmConfig: readLlmConfig(),
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  setRuntimeMode: (runtimeMode) => set({ runtimeMode }),
  setLlmConfig: (patch) =>
    set((prev) => {
      const next = {
        ...prev.llmConfig,
        ...patch
      };
      writeLlmConfig(next);
      return { llmConfig: next };
    })
}));

function readLlmConfig(): LlmConfig {
  if (typeof window === "undefined") {
    return DEFAULT_LLM_CONFIG;
  }
  const raw = window.localStorage.getItem(LLM_CONFIG_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_LLM_CONFIG;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      provider: typeof parsed.provider === "string" && parsed.provider.trim() ? parsed.provider : DEFAULT_LLM_CONFIG.provider,
      modelId: typeof parsed.modelId === "string" && parsed.modelId.trim() ? parsed.modelId : DEFAULT_LLM_CONFIG.modelId,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      baseUrl:
        typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl : DEFAULT_LLM_CONFIG.baseUrl
    };
  } catch {
    return DEFAULT_LLM_CONFIG;
  }
}

function writeLlmConfig(value: LlmConfig): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(LLM_CONFIG_STORAGE_KEY, JSON.stringify(value));
}
