import { describe, expect, it } from "vitest"

import { defaultMergeMethod, mergeBlocker } from "./pull-request-merge.js"

const clean = { mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" } as const

describe("mergeBlocker", () => {
  it("reports blockers in priority order", () => {
    expect(mergeBlocker({ state: "CLOSED", isDraft: true, metadata: clean, checks: [] })).toBe(
      "closed"
    )
    expect(mergeBlocker({ state: "OPEN", isDraft: true, metadata: clean, checks: [] })).toBe(
      "draft"
    )
    expect(
      mergeBlocker({
        state: "OPEN",
        isDraft: false,
        metadata: { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" },
        checks: [{ bucket: "fail" }],
      })
    ).toBe("conflicts")
    expect(
      mergeBlocker({
        state: "OPEN",
        isDraft: false,
        metadata: clean,
        checks: [{ bucket: "pending" }, { bucket: "fail" }],
      })
    ).toBe("failingChecks")
    expect(
      mergeBlocker({
        state: "OPEN",
        isDraft: false,
        metadata: clean,
        checks: [{ bucket: "pending" }],
      })
    ).toBe("pendingChecks")
    expect(
      mergeBlocker({
        state: "OPEN",
        isDraft: false,
        metadata: { mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" },
        checks: [],
      })
    ).toBe("blocked")
    expect(
      mergeBlocker({
        state: "OPEN",
        isDraft: false,
        metadata: { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" },
        checks: null,
      })
    ).toBe("unknown")
    expect(mergeBlocker({ state: "OPEN", isDraft: false, metadata: null, checks: null })).toBe(
      "unknown"
    )
  })

  it("allows a clean or unstable pull request with passing checks", () => {
    expect(
      mergeBlocker({ state: "OPEN", isDraft: false, metadata: clean, checks: [{ bucket: "pass" }] })
    ).toBeNull()
    expect(
      mergeBlocker({
        state: "OPEN",
        isDraft: false,
        metadata: { mergeable: "MERGEABLE", mergeStateStatus: "HAS_HOOKS" },
        checks: null,
      })
    ).toBeNull()
  })
})

describe("defaultMergeMethod", () => {
  it("keeps an allowed saved method and falls back to the first allowed one", () => {
    expect(defaultMergeMethod("squash", ["merge", "squash"])).toBe("squash")
    expect(defaultMergeMethod("merge", ["squash"])).toBe("squash")
    expect(defaultMergeMethod("merge", [])).toBeNull()
  })
})
