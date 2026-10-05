import { posix } from "node:path"

/**
 * The Website route of a Markdown link in `docs/`. `from` is the linking document's path inside
 * `docs/` (such as `server/runtime.md`), against which a relative link resolves; links that are
 * external, anchors, not Markdown, or outside `docs/` are left as written.
 */
export const websiteDocsUrl = (value: string, from = "README.md"): string => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(value)) return value
  const match = /^(.*?)(\.zh-CN)?\.md(?:(#.*))?$/u.exec(value)
  if (!match) return value

  const target = posix.normalize(posix.join(posix.dirname(from), match[1] ?? ""))
  if (target.startsWith("../")) return value
  const fragment = match[3] ?? ""
  const slug = target === "README" ? "" : target.replace(/\/README$/u, "")
  const localePrefix = match[2] ? "/zh-CN" : ""
  return `${localePrefix}/docs${slug ? `/${slug}` : ""}${fragment}`
}
