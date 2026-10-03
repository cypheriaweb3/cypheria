import { setupI18n } from "@lingui/core"

import { messages as enMessages } from "./locales/en/messages.po"
import { messages as zhCnMessages } from "./locales/zh-CN/messages.po"

export const i18n = setupI18n({
  locale: "en",
  messages: { en: enMessages, "zh-CN": zhCnMessages },
})

/** Activates the language the host reports, falling back to English. */
export const activateLocale = (locale: string | undefined): void => {
  const normalized = locale?.toLowerCase() ?? ""
  i18n.activate(normalized.startsWith("zh") ? "zh-CN" : "en")
}
