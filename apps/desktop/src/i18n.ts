import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { enUS } from "./locales/en-US";
import { zhCN } from "./locales/zh-CN";

const resources = {
  "en-US": { translation: enUS },
  "zh-CN": { translation: zhCN }
} as const;

const browserLang = navigator.language.toLowerCase();
const defaultLanguage = browserLang.startsWith("zh") ? "zh-CN" : "en-US";

void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLanguage,
  fallbackLng: "en-US",
  interpolation: {
    escapeValue: false
  }
});

export { i18n };
