import type { Schedule } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import {
  type AutomationSchedules,
  AutomationTool,
  cadenceToRrule,
  rruleToCadence,
} from "./automation.js"

describe("rruleToCadence", () => {
  it.each([
    ["FREQ=MINUTELY;INTERVAL=30", { everyMs: 1_800_000, type: "interval" }],
    ["FREQ=HOURLY;INTERVAL=2", { everyMs: 7_200_000, type: "interval" }],
    ["FREQ=HOURLY;BYMINUTE=15", { expression: "15 * * * *", type: "cron" }],
    ["FREQ=HOURLY;INTERVAL=3;BYMINUTE=0", { expression: "0 */3 * * *", type: "cron" }],
    ["FREQ=DAILY;BYHOUR=9", { expression: "0 9 * * *", type: "cron" }],
    ["RRULE:FREQ=DAILY;BYHOUR=9,17;BYMINUTE=30", { expression: "30 9,17 * * *", type: "cron" }],
    ["FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=8;BYMINUTE=5", { expression: "5 8 * * 1,5", type: "cron" }],
    ["FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=7", { expression: "0 7 1 * *", type: "cron" }],
  ])("%s", (rrule, cadence) => {
    expect(rruleToCadence(rrule)).toEqual(cadence)
  })

  it.each([
    ["DTSTART:20260101T000000Z\nFREQ=DAILY;BYHOUR=9", /DTSTART/u],
    ["FREQ=DAILY", /BYHOUR/u],
    ["FREQ=DAILY;INTERVAL=2;BYHOUR=9", /INTERVAL=1/u],
    ["FREQ=WEEKLY;BYHOUR=9", /BYDAY/u],
    ["FREQ=YEARLY", /FREQ must be/u],
    ["FREQ=DAILY;BYHOUR=9;COUNT=3", /COUNT/u],
    ["FREQ=MINUTELY;BYHOUR=3", /BYHOUR/u],
    ["FREQ=DAILY;BYHOUR=25", /BYHOUR must list/u],
  ])("rejects %s", (rrule, message) => {
    expect(() => rruleToCadence(rrule)).toThrow(message)
  })
})

describe("cadenceToRrule", () => {
  it("round-trips the forms the tool writes", () => {
    for (const rrule of [
      "FREQ=MINUTELY;INTERVAL=30",
      "FREQ=HOURLY;INTERVAL=2",
      "FREQ=HOURLY;BYMINUTE=15",
      "FREQ=HOURLY;INTERVAL=3;BYMINUTE=0",
      "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      "FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=8;BYMINUTE=5",
      "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=7;BYMINUTE=0",
    ]) {
      expect(cadenceToRrule(rruleToCadence(rrule))).toBe(rrule)
    }
  })

  it("leaves a cadence it did not write without an RRULE", () => {
    expect(cadenceToRrule({ at: "2030-01-01T00:00:00.000Z", type: "once" })).toBeNull()
    expect(cadenceToRrule({ expression: "0 9 * 6 *", type: "cron" })).toBeNull()
  })
})

const fakeSchedules = () => {
  const store = new Map<string, Schedule>()
  let next = 0
  const make = (
    id: string,
    input: { cadence: Schedule["cadence"]; name?: string | null; target: Schedule["target"] },
    status: Schedule["status"] = "active"
  ): Schedule => ({
    cadence: input.cadence,
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    lastRunAt: null,
    name: input.name ?? null,
    nextRunAt: null,
    revision: 0,
    status,
    target: input.target,
    updatedAt: "2026-01-01T00:00:00.000Z",
  })
  const schedules: AutomationSchedules = {
    create: async (input) => {
      const created = make(`00000000-0000-4000-8000-00000000000${++next}`, input)
      store.set(created.id, created)
      return created
    },
    delete: async (id) => {
      store.delete(id)
    },
    get: async (id) => {
      const found = store.get(id)
      if (!found) throw new Error("Schedule was not found")
      return found
    },
    pause: async (id) => {
      const paused = { ...(store.get(id) as Schedule), status: "paused" as const }
      store.set(id, paused)
      return paused
    },
    resume: async (id) => {
      const resumed = { ...(store.get(id) as Schedule), status: "active" as const }
      store.set(id, resumed)
      return resumed
    },
    update: async ({ scheduleId, ...patch }) => {
      const current = store.get(scheduleId) as Schedule
      const updated = {
        ...current,
        ...(patch.cadence ? { cadence: patch.cadence } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.target ? { target: patch.target } : {}),
      }
      store.set(scheduleId, updated)
      return updated
    },
  }
  return { schedules, store }
}

const tool = () => {
  const { schedules, store } = fakeSchedules()
  return {
    store,
    tool: new AutomationTool({
      agentOf: async () => "claude",
      defaultAgentId: "codex",
      projectRoot: async (projectId) => `/projects/${projectId}`,
      schedules,
    }),
  }
}

describe("AutomationTool", () => {
  it("creates a heartbeat that wakes the calling thread", async () => {
    const { tool: automations, store } = tool()
    const created = (await automations.call(
      {
        destination: "thread",
        kind: "heartbeat",
        mode: "create",
        name: "Watch CI",
        prompt: "Check CI",
        rrule: "FREQ=MINUTELY;INTERVAL=30",
      },
      "thread-1"
    )) as { id: string; kind: string; rrule: string; status: string }
    expect(created).toMatchObject({
      kind: "heartbeat",
      rrule: "FREQ=MINUTELY;INTERVAL=30",
      status: "ACTIVE",
    })
    expect(store.get(created.id)?.target).toEqual({
      content: [{ text: "Check CI", type: "text" }],
      threadId: "thread-1",
      type: "thread",
    })
  })

  it("creates a cron automation that starts a new task in a project, paused", async () => {
    const { tool: automations, store } = tool()
    const created = (await automations.call(
      {
        kind: "cron",
        mode: "create",
        name: "Digest",
        projectId: "p1",
        prompt: "Summarize",
        rrule: "FREQ=DAILY;BYHOUR=9",
        status: "PAUSED",
      },
      "thread-1"
    )) as { id: string; status: string }
    expect(created.status).toBe("PAUSED")
    expect(store.get(created.id)?.target).toEqual({
      agentId: "claude",
      content: [{ text: "Summarize", type: "text" }],
      cwd: "/projects/p1",
      title: "Digest",
      type: "new-thread",
    })
  })

  it("needs a thread for a heartbeat and the three core fields", async () => {
    const { tool: automations } = tool()
    await expect(
      automations.call(
        { kind: "heartbeat", mode: "create", name: "n", prompt: "p", rrule: "FREQ=HOURLY" },
        undefined
      )
    ).rejects.toThrow(/targetThreadId/u)
    await expect(automations.call({ kind: "cron", mode: "create" }, "t")).rejects.toThrow(
      /name, prompt, and rrule/u
    )
  })

  it("updates the schedule, pauses, views, and deletes", async () => {
    const { tool: automations, store } = tool()
    const created = (await automations.call(
      {
        kind: "heartbeat",
        mode: "create",
        name: "n",
        prompt: "p",
        rrule: "FREQ=HOURLY;INTERVAL=1",
        targetThreadId: "t",
      },
      "x"
    )) as { id: string }
    const updated = (await automations.call(
      {
        id: created.id,
        mode: "update",
        prompt: "q",
        rrule: "FREQ=DAILY;BYHOUR=7",
        status: "PAUSED",
      },
      "x"
    )) as { prompt: string; rrule: string; status: string }
    expect(updated).toMatchObject({
      prompt: "q",
      rrule: "FREQ=DAILY;BYHOUR=7;BYMINUTE=0",
      status: "PAUSED",
    })
    expect(
      ((await automations.call({ id: created.id, mode: "view" }, "x")) as { status: string }).status
    ).toBe("PAUSED")
    await expect(
      automations.call({ id: created.id, kind: "cron", mode: "update" }, "x")
    ).rejects.toThrow(/cannot change kind/u)
    await automations.call({ id: created.id, mode: "delete" }, "x")
    expect(store.size).toBe(0)
  })

  it("does not expose a web3 schedule as an automation", async () => {
    const { tool: automations, store } = tool()
    store.set("w", {
      cadence: { everyMs: 60_000, type: "interval" },
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "w",
      lastRunAt: null,
      name: null,
      nextRunAt: null,
      revision: 0,
      status: "active",
      target: { method: "wallet.sign", type: "web3" },
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    await expect(automations.call({ id: "w", mode: "view" }, "x")).rejects.toThrow(
      /not an automation/u
    )
  })
})
