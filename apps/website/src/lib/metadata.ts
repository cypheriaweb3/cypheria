import type { WebsiteLocale } from "./i18n"
import { siteUrl } from "./site-routes"

export const siteDescription =
  "Cypheria is an open-source, local-first workspace for agents, wallets, and the web."

export function localizedHead({
  description,
  locale,
  path,
  title,
}: {
  description: string
  locale: WebsiteLocale
  path: string
  title: string
}) {
  const englishPath = path === "/" ? "" : path
  const localizedPath = locale === "zh-CN" ? `/zh-CN${englishPath}` : englishPath || "/"
  const canonical = `${siteUrl}${localizedPath}`
  const english = `${siteUrl}${englishPath || "/"}`
  const chinese = `${siteUrl}/zh-CN${englishPath}`

  return {
    links: [
      { href: canonical, rel: "canonical" },
      { href: english, hrefLang: "en", rel: "alternate" },
      { href: chinese, hrefLang: "zh-CN", rel: "alternate" },
      { href: english, hrefLang: "x-default", rel: "alternate" },
    ],
    meta: [
      { title },
      { content: description, name: "description" },
      { content: title, property: "og:title" },
      { content: description, property: "og:description" },
      { content: "website", property: "og:type" },
      { content: canonical, property: "og:url" },
      { content: `${siteUrl}/screenshots/desktop-dark.webp`, property: "og:image" },
      { content: "summary_large_image", name: "twitter:card" },
      { content: title, name: "twitter:title" },
      { content: description, name: "twitter:description" },
      { content: `${siteUrl}/screenshots/desktop-dark.webp`, name: "twitter:image" },
    ],
  }
}
