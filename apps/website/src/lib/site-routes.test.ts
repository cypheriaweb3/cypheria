import { describe, expect, it } from "vitest"
import { documentationSlugs, marketingSlugs, prerenderPaths } from "./site-routes"

describe("prerender routes", () => {
  it("pairs every marketing and documentation page across locales", () => {
    for (const slug of marketingSlugs) {
      const path = slug ? `/${slug}` : "/"
      expect(prerenderPaths).toContain(path)
      expect(prerenderPaths).toContain(slug ? `/zh-CN/${slug}` : "/zh-CN")
    }
    for (const slug of documentationSlugs) {
      expect(prerenderPaths).toContain(slug ? `/docs/${slug}` : "/docs")
      expect(prerenderPaths).toContain(slug ? `/zh-CN/docs/${slug}` : "/zh-CN/docs")
    }
  })

  it("does not create Marketplace application routes", () => {
    expect(
      prerenderPaths.some((path) => path === "/marketplace" || path.startsWith("/marketplace/"))
    ).toBe(false)
    expect(prerenderPaths).not.toContain("/api/v1")
  })
})
