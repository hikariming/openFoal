import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";
import { workbenchEnUS, workbenchZhCN } from "@openfoal/personal-app/workbench";

const resources = {
  "zh-CN": {
    translation: mergeLocale(workbenchZhCN, zhCN)
  },
  "en-US": {
    translation: mergeLocale(workbenchEnUS, enUS)
  }
};

const webConsoleTranslations = {
  "zh-CN": resources["zh-CN"].translation,
  "en-US": resources["en-US"].translation
} as const;

if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: resolveInitialLanguage(),
      fallbackLng: "zh-CN",
      supportedLngs: ["zh-CN", "en-US"],
      interpolation: {
        escapeValue: false
      }
    });
} else {
  i18n.addResourceBundle("zh-CN", "translation", webConsoleTranslations["zh-CN"], true, true);
  i18n.addResourceBundle("en-US", "translation", webConsoleTranslations["en-US"], true, true);
  void i18n.changeLanguage(resolveInitialLanguage());
}

export default i18n;

function mergeLocale(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    if (isPlainRecord(baseValue) && isPlainRecord(value)) {
      merged[key] = mergeLocale(baseValue, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveInitialLanguage(): "zh-CN" | "en-US" {
  if (typeof window === "undefined") {
    return "zh-CN";
  }

  const persistedUiLanguage = readPersistedUiLanguage();
  const legacyLanguage = window.localStorage.getItem("openfoal_lang");
  return normalizeLanguage(persistedUiLanguage ?? legacyLanguage ?? window.navigator.language);
}

function readPersistedUiLanguage(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const raw = window.localStorage.getItem("openfoal_ui");
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as {
      state?: {
        language?: unknown;
      };
      language?: unknown;
    };
    const fromState = typeof parsed?.state?.language === "string" ? parsed.state.language : undefined;
    const fromRoot = typeof parsed?.language === "string" ? parsed.language : undefined;
    return fromState ?? fromRoot;
  } catch {
    return undefined;
  }
}

function normalizeLanguage(value: unknown): "zh-CN" | "en-US" {
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
