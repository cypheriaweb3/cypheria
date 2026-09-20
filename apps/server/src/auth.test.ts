import { describe, expect, it } from "vitest"

import {
  CYPHERIA_DESKTOP_ORIGIN,
  hasCypheriaProtocol,
  isAuthorized,
  isOriginAllowed,
  readBearerToken,
  readWebSocketToken,
  resolveWebSocketAllowedOrigins,
} from "./auth.js"

describe("server authentication", () => {
  it("reads HTTP and WebSocket credentials", () => {
    expect(readBearerToken("Bearer secret-token")).toBe("secret-token")
    expect(readWebSocketToken("cypheria.v1, cypheria.bearer.secret-token")).toBe("secret-token")
    expect(hasCypheriaProtocol("cypheria.v1, cypheria.bearer.secret-token")).toBe(true)
  })

  it("enforces configured credentials and origins", () => {
    expect(isAuthorized(undefined, undefined)).toBe(true)
    expect(isAuthorized("secret", "secret")).toBe(true)
    expect(isAuthorized("wrong", "secret")).toBe(false)
    expect(isOriginAllowed(undefined, [])).toBe(true)
    expect(isOriginAllowed("https://app.example", [])).toBe(false)
    expect(isOriginAllowed("https://app.example", ["https://app.example"])).toBe(true)
    expect(isOriginAllowed("https://other.example", ["https://app.example"])).toBe(false)
  })

  it("always allows the server itself and the trusted desktop renderer origin", () => {
    expect(resolveWebSocketAllowedOrigins("http://127.0.0.1:6768/api/v1/ws", [])).toEqual([
      "http://127.0.0.1:6768",
      CYPHERIA_DESKTOP_ORIGIN,
    ])
    expect(
      resolveWebSocketAllowedOrigins("http://127.0.0.1:6768/api/v1/ws", ["https://app.example"])
    ).toContain("https://app.example")
  })
})
