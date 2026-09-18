import { describe, expect, it } from "vitest"

import { initialRunAt, nextCronRun, nextRunAfter } from "./cron.js"

describe("schedule cadence", () => {
  it("advances interval slots without replaying missed intervals", () => {
    expect(nextRunAfter({ everyMs: 60_000, type: "interval" }, 60_000, 240_000)).toBe(300_000)
  })

  it("supports five-field cron with an explicit timezone", () => {
    const after = Date.parse("2026-01-01T00:00:00.000Z")
    expect(nextCronRun("0 9 * * 1-5", after, "Asia/Shanghai")).toBe(
      Date.parse("2026-01-01T01:00:00.000Z")
    )
  })

  it("uses the configured instant for one-shot schedules", () => {
    expect(initialRunAt({ at: "2026-05-01T12:30:00.000Z", type: "once" }, 0)).toBe(
      Date.parse("2026-05-01T12:30:00.000Z")
    )
  })
})
