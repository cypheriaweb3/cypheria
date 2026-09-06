import { setupI18n } from "@lingui/core"
import type { LanguageBootstrap, LanguageSettings } from "../../ipc/src/index.js"
import { messages as enMessages } from "./locales/en/messages.po"
import { messages as zhCnMessages } from "./locales/zh-CN/messages.po"

export const sourceLanguage: LanguageBootstrap = { locale: "en", preference: "system" }

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

export const activateLanguage = (language: LanguageBootstrap | LanguageSettings): void => {
  i18n.activate(language.locale)

  if (typeof document !== "undefined") {
    document.documentElement.lang = language.locale
    document.documentElement.dir = "ltr"
  }
}
