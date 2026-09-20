import { loader } from "fumadocs-core/source"
import { defineDocs } from "fumadocs-mdx/macro"
import { docsI18n } from "./fumadocs-i18n"

export const docs = defineDocs({
  dir: "../../docs",
  docs: {
    async: true,
  },
})

export const source = loader({
  baseUrl: "/docs",
  i18n: docsI18n,
  slugs(_file, next) {
    const slugs = next()
    return slugs.length === 1 && slugs[0] === "README" ? [] : slugs
  },
  source: docs.toFumadocsSource(),
  url(slugs, locale) {
    const prefix = locale === "zh-CN" ? "/zh-CN" : ""
    return `${prefix}/docs${slugs.length ? `/${slugs.join("/")}` : ""}`
  },
})
