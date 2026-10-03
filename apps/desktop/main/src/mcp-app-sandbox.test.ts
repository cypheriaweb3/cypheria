import { describe, expect, it } from "vitest"

import { handleMcpAppSandboxRequest, isAllowedSandboxNavigation } from "./mcp-app-sandbox.js"

describe("MCP App sandbox", () => {
  it("serves only the proxy page on a valid sandbox origin", async () => {
    const page = handleMcpAppSandboxRequest("cypheria-sandbox://a0123456789abcdef/")
    expect(page.status).toBe(200)
    expect(page.headers.get("Content-Type")).toContain("text/html")
    const html = await page.text()
    expect(html).toContain("ui/notifications/sandbox-proxy-ready")
    expect(html).toContain("ui/notifications/sandbox-resource-ready")
    expect(html).not.toContain("Content-Security-Policy")
    expect(handleMcpAppSandboxRequest("cypheria-sandbox://a0123/other").status).toBe(404)
    expect(handleMcpAppSandboxRequest("cypheria-sandbox://BAD_HOST/").status).toBe(404)
  })

  it("keeps App frames on sandbox origins and inline documents", () => {
    expect(isAllowedSandboxNavigation("cypheria-sandbox://a1/")).toBe(true)
    expect(isAllowedSandboxNavigation("about:srcdoc")).toBe(true)
    expect(isAllowedSandboxNavigation("https://example.com")).toBe(false)
    expect(isAllowedSandboxNavigation("cypheria://app/")).toBe(false)
  })
})
