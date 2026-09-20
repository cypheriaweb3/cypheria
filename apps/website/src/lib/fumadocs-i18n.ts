import { zhCN } from "@fumadocs/language/zh-cn"
import { defineI18n } from "fumadocs-core/i18n"
import { uiTranslations } from "fumadocs-ui/i18n"

export const docsI18n = defineI18n({
  defaultLanguage: "en",
  fallbackLanguage: null,
  hideLocale: "default-locale",
  languages: ["en", "zh-CN"],
  parser: "dot",
})

export const docsTranslations = docsI18n
  .translations()
  .extend(uiTranslations())
  .preset("zh-CN", zhCN())
