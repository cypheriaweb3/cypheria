import { describe, expect, it } from "vitest"

import { AgentViewSchema } from "./management.js"

describe("agent management protocol", () => {
  it("keeps AgentView fields in domain order with a required version", () => {
    expect(Object.keys(AgentViewSchema.shape)).toEqual([
      "id",
      "name",
      "version",
      "description",
      "repository",
      "website",
      "icon",
      "native",
      "installed",
      "enabled",
      "available",
      "availableVersion",
      "runScope",
      "runtimeState",
      "integrity",
    ])
    expect(AgentViewSchema.shape.version.safeParse(null).success).toBe(false)
    expect(AgentViewSchema.shape.version.safeParse("").success).toBe(false)
  })
})
