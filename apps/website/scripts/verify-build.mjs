import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const publicDir = resolve(root, "dist/client")
const failures = []
const required = [
  "index.html",
  "product/index.html",
  "security/index.html",
  "developers/index.html",
  "docs/index.html",
  "zh-CN/index.html",
  "zh-CN/product/index.html",
  "zh-CN/security/index.html",
  "zh-CN/developers/index.html",
  "zh-CN/docs/index.html",
  "404/index.html",
  "zh-CN/404/index.html",
  "api/search",
  "robots.txt",
  "sitemap.xml",
  "_headers",
  "site.webmanifest",
]

for (const path of required) {
  if (!existsSync(resolve(publicDir, path))) failures.push(`missing prerendered asset: ${path}`)
}

const routeSlugs = [
  "agent-harnesses",
  "architecture",
  "brand",
  "codex-app-server-api",
  "codex-app-server-config",
  "codex-permissions",
  "database",
  "desktop",
  "development",
  "integrations",
  "marketplace",
  "protocol",
  "relay",
  "schedules",
  "server",
  "todo",
  "ui",
  "web3",
]

for (const slug of routeSlugs) {
  for (const prefix of ["docs", "zh-CN/docs"]) {
    const path = `${prefix}/${slug}/index.html`
    if (!existsSync(resolve(publicDir, path))) failures.push(`missing localized document: ${path}`)
  }
}

for (const path of ["index.html", "product/index.html", "docs/index.html", "zh-CN/index.html"]) {
  if (!existsSync(resolve(publicDir, path))) continue
  const html = readFileSync(resolve(publicDir, path), "utf8")
  if (!html.includes('rel="canonical"')) failures.push(`${path}: missing canonical link`)
  if (!html.includes('hrefLang="en"') || !html.includes('hrefLang="zh-CN"'))
    failures.push(`${path}: missing locale alternates`)
  if (/href="[^"]*\.zh-CN\.md(?:#|")|href="[^"]*\.md(?:#|")/u.test(html))
    failures.push(`${path}: contains a Markdown source link`)
}

if (existsSync(resolve(publicDir, "api/search"))) {
  const search = readFileSync(resolve(publicDir, "api/search"), "utf8")
  if (!search.includes('"i18n":true') || !search.includes('"en"') || !search.includes('"zh-CN"'))
    failures.push("static search index does not contain both locales")
}

if (existsSync(resolve(root, "src/routes/marketplace.tsx")))
  failures.push("Marketplace route must not be implemented in this release")

if (failures.length) {
  console.error(
    `Website build verification failed:\n${failures.map((item) => `- ${item}`).join("\n")}`
  )
  process.exitCode = 1
} else {
  console.log(
    `Website build verification passed for ${required.length} core assets and ${routeSlugs.length * 2} localized documents.`
  )
}
