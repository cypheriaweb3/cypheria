import { describe, expect, it } from "vitest"

import { normalizeServerWebSocketUrl } from "./server-url-core"

describe("normalizeServerWebSocketUrl", () => {
  it("normalizes an HTTP server URL to the Cypheria WebSocket endpoint", () => {
    expect(normalizeServerWebSocketUrl("https://cypheria.example/custom?token=nope")).toBe(
      "wss://cypheria.example/api/v1/ws"
    )
  })
})
