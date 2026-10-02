import { describe, expect, it } from "vitest"

import { checkDuration, sortChecks } from "./pull-request-checks.js"

const check = (name: string, bucket: "fail" | "pass" | "pending" | "skipping" | "cancel") => ({
  bucket,
  completedAt: null,
  link: null,
  name,
  startedAt: null,
  state: bucket,
  workflow: null,
})

describe("pull request checks", () => {
  it("puts failures first, then running checks, then the rest by name", () => {
    expect(
      sortChecks([
        check("lint", "pass"),
        check("unit", "fail"),
        check("e2e", "pending"),
        check("build", "pass"),
        check("docs", "skipping"),
      ]).map((entry) => entry.name)
    ).toEqual(["unit", "e2e", "build", "lint", "docs"])
  })

  it("formats how long a finished check took", () => {
    expect(
      checkDuration({ completedAt: "2026-01-01T00:01:05Z", startedAt: "2026-01-01T00:00:00Z" })
    ).toBe("1m 5s")
    expect(
      checkDuration({ completedAt: "2026-01-01T00:00:09Z", startedAt: "2026-01-01T00:00:00Z" })
    ).toBe("9s")
    expect(checkDuration({ completedAt: null, startedAt: "2026-01-01T00:00:00Z" })).toBeNull()
  })
})
