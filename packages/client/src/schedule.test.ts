import { describe, expect, it, vi } from "vitest"
import { createScheduleActions } from "./schedule.js"
import type { ServerClient } from "./server-client.js"

describe("schedule actions", () => {
  it("maps the public facade to schedule protocol requests", async () => {
    const requestSchedule = vi.fn(async (type: string) => ({
      payload: { ok: true as const, value: type === "schedule.delete.request" ? {} : [] },
      requestId: "test",
      type: type.replace(/\.request$/, ".response"),
    }))
    const actions = createScheduleActions({ requestSchedule } as unknown as ServerClient)
    const scheduleId = crypto.randomUUID()

    await actions.list()
    await actions.listRuns(scheduleId, 25)
    await actions.delete(scheduleId)

    expect(requestSchedule.mock.calls).toEqual([
      ["schedule.list.request", {}, undefined],
      ["schedule.runs.list.request", { limit: 25, scheduleId }, undefined],
      ["schedule.delete.request", { scheduleId }, undefined],
    ])
  })

  it("normalizes schedule failures as named errors", async () => {
    const requestSchedule = vi.fn(async () => ({
      payload: {
        error: { code: "SCHEDULE_NOT_FOUND", message: "Schedule was not found" },
        ok: false as const,
      },
      requestId: "test",
      type: "schedule.get.response" as const,
    }))
    const actions = createScheduleActions({ requestSchedule } as unknown as ServerClient)

    await expect(actions.get(crypto.randomUUID())).rejects.toMatchObject({
      message: "Schedule was not found",
      name: "SCHEDULE_NOT_FOUND",
    })
  })
})
