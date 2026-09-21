import { describe, expect, it } from "vitest"
import { createInMemorySearch, resolveAvailableHarnessId } from "./harness-selection"

const available = [{ id: "antigravity-acp" as const }, { id: "cline" as const }]

describe("resolveAvailableHarnessId", () => {
  it("accepts an id from the current available catalog", () => {
    expect(resolveAvailableHarnessId("cline", available)).toBe("cline")
  })

  it("ignores the null value emitted when Base UI clears a selection", () => {
    expect(resolveAvailableHarnessId(null, available)).toBeUndefined()
  })

  it("ignores stale and unknown ids", () => {
    expect(resolveAvailableHarnessId("codex", available)).toBeUndefined()
    expect(resolveAvailableHarnessId({ id: "cline" }, available)).toBeUndefined()
  })
})

describe("createInMemorySearch", () => {
  const harnesses = [
    {
      description: "Google's AI coding agent",
      id: "antigravity-acp",
      name: "Google Antigravity",
      version: "1.1.1",
    },
    {
      description: "An autonomous coding agent",
      id: "cline",
      name: "Cline",
      version: "3.2.0",
    },
  ]
  const search = createInMemorySearch(
    harnesses,
    (harness) => `${harness.name} ${harness.id} ${harness.version} ${harness.description}`
  )

  it("preserves source order when the query is empty", () => {
    expect(search.search("  ")).toEqual(harnesses)
  })

  it("finds partial names and descriptions in memory", () => {
    expect(search.search("gravity").map((harness) => harness.id)).toEqual(["antigravity-acp"])
    expect(search.search("autonomous").map((harness) => harness.id)).toEqual(["cline"])
  })

  it("indexes version values", () => {
    expect(search.search("1.1.1").map((harness) => harness.id)).toEqual(["antigravity-acp"])
  })
})
