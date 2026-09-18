import { describe, expect, it } from "vitest"

import {
  ClientMessageSchema,
  ScheduleCadenceSchema,
  ScheduleTargetSchema,
  ServerMessageSchema,
} from "./index.js"

describe("schedule protocol", () => {
  it("validates create requests and correlated responses", () => {
    const requestId = "schedule-test"
    const parsed = ClientMessageSchema.parse({
      payload: {
        cadence: { everyMs: 60_000, type: "interval" },
        name: "Daily review",
        target: {
          agentId: "claude",
          content: [{ text: "Review the project", type: "text" }],
          type: "new-thread",
        },
      },
      requestId,
      type: "schedule.create.request",
    })
    expect(parsed.type).toBe("schedule.create.request")

    expect(() =>
      ServerMessageSchema.parse({
        payload: { ok: true, value: { id: "not-a-schedule" } },
        requestId,
        type: "schedule.create.response",
      })
    ).toThrow()
  })

  it("rejects unsafe runtime namespaces and short intervals", () => {
    expect(ScheduleTargetSchema.safeParse({ method: "runtime.delete", type: "web3" }).success).toBe(
      false
    )
    expect(ScheduleCadenceSchema.safeParse({ everyMs: 999, type: "interval" }).success).toBe(false)
  })
})
