import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";
import { enUS as desktopEnUS } from "../../../desktop/src/locales/en-US";
import { zhCN as desktopZhCN } from "../../../desktop/src/locales/zh-CN";

const resources = {
  "zh-CN": {
    translation: mergeLocale(desktopZhCN, zhCN)
  },
  "en-US": {
    translation: mergeLocale(desktopEnUS, enUS)
  }
};

if (!i18n.isInitialized) {
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: "zh-CN",
      supportedLngs: ["zh-CN", "en-US"],
      interpolation: {
        escapeValue: false
      },
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: "openfoal_lang"
      }
    });
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
