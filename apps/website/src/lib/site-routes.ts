export const documentationSlugs = [
  "",
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
] as const

export const marketingSlugs = ["", "product", "security", "developers"] as const

export const prerenderPaths = [
  ...marketingSlugs.map((slug) => (slug ? `/${slug}` : "/")),
  ...marketingSlugs.map((slug) => (slug ? `/zh-CN/${slug}` : "/zh-CN")),
  ...documentationSlugs.map((slug) => (slug ? `/docs/${slug}` : "/docs")),
  ...documentationSlugs.map((slug) => (slug ? `/zh-CN/docs/${slug}` : "/zh-CN/docs")),
  "/404",
  "/zh-CN/404",
  "/api/search",
  "/robots.txt",
  "/sitemap.xml",
] as const

export const siteUrl = (import.meta.env?.CYPHERIA_SITE_URL || "https://cypheria.dev").replace(
  /\/$/u,
  ""
)
