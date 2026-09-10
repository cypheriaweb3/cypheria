import { describe, expect, it } from "vitest"

import { loadServerConfig } from "./config.js"

describe("loadServerConfig", () => {
  it("uses secure loopback defaults", () => {
    const config = loadServerConfig({})
    expect(config.host).toBe("127.0.0.1")
    expect(config.port).toBe(6768)
    expect(config.webAppEnabled).toBe(true)
  })

  it("requires authentication when exposed beyond loopback", () => {
    expect(() => loadServerConfig({ CYPHERIA_SERVER_HOST: "0.0.0.0" })).toThrow(
      "required when binding outside loopback"
    )
  })

  it("parses environment overrides", () => {
    const config = loadServerConfig({
      CYPHERIA_SERVER_ALLOWED_ORIGINS: "https://one.example, https://two.example",
      CYPHERIA_SERVER_PORT: "7788",
      CYPHERIA_SERVER_WEB_ENABLED: "off",
    })
    expect(config.allowedOrigins).toEqual(["https://one.example", "https://two.example"])
    expect(config.port).toBe(7788)
    expect(config.webAppEnabled).toBe(false)
  })
})
