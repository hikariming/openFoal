import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

export const supportedLanguages = ['zh-CN', 'en-US'] as const
export type AppLanguage = (typeof supportedLanguages)[number]

const resources = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS },
}

if (!i18n.isInitialized) {
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: 'zh-CN',
      supportedLngs: supportedLanguages,
      interpolation: {
        escapeValue: false,
      },
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: 'openfoal_lang',
        caches: ['localStorage'],
      },
    })
}

export function normalizeLanguage(value: string | null | undefined): AppLanguage {
  if (!value) {
    return 'zh-CN'
  }

  const normalized = value.toLowerCase()
  if (normalized.startsWith('en')) {
    return 'en-US'
  }
  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }
  return 'zh-CN'
}

export default i18n
