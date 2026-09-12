import { describe, expect, it } from "vitest"

import { isSupervisorMessage, isWorkerMessage } from "./process-messages.js"

describe("server process messages", () => {
  it("validates bidirectional heartbeats and lifecycle messages", () => {
    expect(isSupervisorMessage({ timestamp: Date.now(), type: "heartbeat" })).toBe(true)
    expect(isSupervisorMessage({ action: "restart", type: "stop" })).toBe(true)
    expect(isSupervisorMessage({ timestamp: "now", type: "heartbeat" })).toBe(false)

    expect(isWorkerMessage({ timestamp: Date.now(), type: "heartbeat" })).toBe(true)
    expect(isWorkerMessage({ action: "shutdown", type: "lifecycle" })).toBe(true)
    expect(isWorkerMessage({ type: "fatal" })).toBe(false)
  })
})
