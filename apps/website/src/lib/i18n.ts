import { setupI18n } from "@lingui/core"
import { messages as enMessages } from "@/locales/en/messages.po"
import { messages as zhCnMessages } from "@/locales/zh-CN/messages.po"

export const locales = ["en", "zh-CN"] as const
export type WebsiteLocale = (typeof locales)[number]

export const localeFromPathname = (pathname: string): WebsiteLocale =>
  pathname === "/zh-CN" || pathname.startsWith("/zh-CN/") ? "zh-CN" : "en"

export const createWebsiteI18n = (locale: WebsiteLocale) =>
  setupI18n({
    locale,
    messages: {
      en: enMessages,
      "zh-CN": zhCnMessages,
    },
  })

export const localizePath = (pathname: string, locale: WebsiteLocale): string => {
  const englishPath = pathname.replace(/^\/zh-CN(?=\/|$)/u, "") || "/"
  return locale === "zh-CN" ? `/zh-CN${englishPath === "/" ? "" : englishPath}` : englishPath
}
