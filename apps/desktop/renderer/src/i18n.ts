import { setupI18n } from "@lingui/core"
import type { LanguageBootstrap, LanguageLocale, SupportedLocale } from "../../ipc/src/index.js"
import { messages as enMessages } from "./locales/en/messages.po"
import { messages as zhCnMessages } from "./locales/zh-CN/messages.po"

export const sourceLanguage: LanguageBootstrap = { locale: "en", localeOverride: null }

export const getBootstrapLanguage = (): LanguageBootstrap =>
  typeof window === "undefined"
    ? sourceLanguage
    : (window.cypheria?.bootstrap.language ?? sourceLanguage)

export const i18n = setupI18n({
  locale: sourceLanguage.locale,
  messages: {
    en: enMessages,
    "zh-CN": zhCnMessages,
  },
})

export const activateLanguage = (language: LanguageBootstrap): void => {
  i18n.activate(language.locale)

  if (typeof document !== "undefined") {
    document.documentElement.lang = language.locale
    document.documentElement.dir = "ltr"
  }
}

export const resolveRendererLocale = (override: LanguageLocale | null): SupportedLocale => {
  if (override !== null) return override === "zh-CN" ? "zh-CN" : "en"
  for (const language of navigator.languages) {
    const normalized = language.toLowerCase()
    if (
      normalized === "zh" ||
      normalized.startsWith("zh-cn") ||
      normalized.startsWith("zh-sg") ||
      normalized.startsWith("zh-hans")
    )
      return "zh-CN"
    if (normalized === "en" || normalized.startsWith("en-")) return "en"
  }
  return "en"
}
