import { describe, expect, it } from "vitest"

import {
  hasCypheriaProtocol,
  isAuthorized,
  isOriginAllowed,
  readBearerToken,
  readWebSocketToken,
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
})
