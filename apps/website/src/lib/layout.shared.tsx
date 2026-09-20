import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { Brand, BrandIcon } from "@/components/brand"
import {
  DocsDrawerLanguageSelect,
  DocsDrawerLanguageText,
  DocsDrawerThemeSwitch,
} from "@/components/docs-nav-actions"
import type { WebsiteLocale } from "./i18n"

export function baseOptions(locale: WebsiteLocale): BaseLayoutProps {
  const prefix = locale === "zh-CN" ? "/zh-CN" : ""
  return {
    links: [
      {
        icon: <BrandIcon className="docs-drawer-brand-icon" />,
        label: "Cypheria home",
        on: "menu",
        text: "Cypheria",
        type: "icon",
        url: prefix || "/",
      },
      { text: locale === "zh-CN" ? "产品" : "Product", url: `${prefix}/product` },
      { text: locale === "zh-CN" ? "安全" : "Security", url: `${prefix}/security` },
      { text: locale === "zh-CN" ? "开发者" : "Developers", url: `${prefix}/developers` },
    ],
    nav: {
      title: Brand,
      url: prefix || "/",
    },
    slots: {
      languageSelect: {
        root: DocsDrawerLanguageSelect,
        text: DocsDrawerLanguageText,
      },
      themeSwitch: DocsDrawerThemeSwitch,
    },
    themeSwitch: { enabled: true },
  }
}
