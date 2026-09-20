export const websiteDocsUrl = (value: string): string => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(value)) return value
  const match = /^(.*?)(\.zh-CN)?\.md(?:(#.*))?$/u.exec(value)
  if (!match) return value

  const sourcePath = match[1] ?? ""
  const fragment = match[3] ?? ""
  const slug = sourcePath.replace(/^\.\//u, "").replace(/^README$/u, "")
  const localePrefix = match[2] ? "/zh-CN" : ""
  return `${localePrefix}/docs${slug ? `/${slug}` : ""}${fragment}`
}
