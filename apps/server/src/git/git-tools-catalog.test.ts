import { GIT_CLIENT_SCHEMAS } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { gitToolsCatalog } from "./git-tools-catalog.js"

describe("Git tools catalog", () => {
  it("exposes every public Git request with its validated payload schema", () => {
    const tools = gitToolsCatalog().tools
    expect(tools).toHaveLength(GIT_CLIENT_SCHEMAS.length)
    expect(new Set(tools.map((tool) => tool.type)).size).toBe(tools.length)
    expect(
      tools.find((tool) => tool.type === "git.github-pr-stack.request")?.inputSchema
    ).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["cwd", "number", "expectedHead"]),
    })
    expect(
      tools.find((tool) => tool.type === "git.gitlab-mr-read.request")?.inputSchema
    ).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["cwd", "threadId", "iid"]),
    })
    expect(tools.every((tool) => !JSON.stringify(tool.inputSchema).includes('"requestId"'))).toBe(
      true
    )
  })
})
