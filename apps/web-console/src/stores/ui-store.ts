import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UiLanguage = "zh-CN" | "en-US";

type UiState = {
  language: UiLanguage;
  siderCollapsed: boolean;
  setLanguage: (language: UiLanguage) => void;
  toggleLanguage: () => void;
  setSiderCollapsed: (collapsed: boolean) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      language: "zh-CN",
      siderCollapsed: false,
      setLanguage: (language) => set({ language: normalizeUiLanguage(language) }),
      toggleLanguage: () => set({ language: normalizeUiLanguage(get().language) === "zh-CN" ? "en-US" : "zh-CN" }),
      setSiderCollapsed: (siderCollapsed) => set({ siderCollapsed })
    }),
    {
      name: "openfoal_ui",
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<UiState> | undefined) ?? {};
        return {
          ...currentState,
          ...persisted,
          language: normalizeUiLanguage(persisted.language ?? currentState.language)
        };
      }
    }
  )
);

function normalizeUiLanguage(value: unknown): UiLanguage {
  if (typeof value !== "string") {
    return "zh-CN";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("en")) {
    return "en-US";
  }
  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }
  return "zh-CN";
}
