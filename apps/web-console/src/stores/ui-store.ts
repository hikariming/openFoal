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
      setLanguage: (language) => set({ language }),
      toggleLanguage: () => set({ language: get().language === "zh-CN" ? "en-US" : "zh-CN" }),
      setSiderCollapsed: (siderCollapsed) => set({ siderCollapsed })
    }),
    {
      name: "openfoal_ui"
    }
  )
);
