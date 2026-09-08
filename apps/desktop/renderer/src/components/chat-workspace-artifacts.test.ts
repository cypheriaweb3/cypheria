import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import { deriveChatWorkspaceArtifacts, displayChatArtifactPath } from "./chat-workspace-artifacts"

describe("displayChatArtifactPath", () => {
  it("shortens project files across platform path separators", () => {
    expect(displayChatArtifactPath("/repo/src/index.ts", "/repo/")).toBe("src/index.ts")
    expect(displayChatArtifactPath("C:\\repo\\src\\index.ts", "C:\\repo")).toBe("src/index.ts")
    expect(displayChatArtifactPath("/elsewhere/index.ts", "/repo")).toBe("/elsewhere/index.ts")
  })
})

describe("deriveChatWorkspaceArtifacts", () => {
  it("derives the latest changed files and command transcripts", () => {
    const messages = [
      {
        id: "assistant-1",
        parts: [
          {
            input: JSON.stringify({ command: "pnpm test", cwd: "/repo" }),
            output: { exitCode: 0, output: "Tests passed", status: "completed" },
            providerExecuted: true,
            state: "output-available",
            toolCallId: "command-1",
            toolName: "command",
            type: "dynamic-tool",
          },
          {
            input: {
              changes: [
                { diff: "@@ -1 +1 @@\n-old\n+new", kind: { type: "update" }, path: "src/a.ts" },
              ],
            },
            output: {
              changes: [
                { diff: "@@ -1 +1 @@\n-old\n+new", kind: { type: "update" }, path: "src/a.ts" },
              ],
              status: "completed",
            },
            providerExecuted: true,
            state: "output-available",
            toolCallId: "change-1",
            toolName: "fileChange",
            type: "dynamic-tool",
          },
        ],
        role: "assistant",
      },
    ] as UIMessage[]

    expect(deriveChatWorkspaceArtifacts(messages)).toEqual({
      commands: [
        {
          command: "pnpm test",
          cwd: "/repo",
          exitCode: 0,
          id: "command-1",
          output: "Tests passed",
          status: "completed",
        },
      ],
      files: [
        {
          diff: "@@ -1 +1 @@\n-old\n+new",
          id: "change-1:0",
          kind: "update",
          path: "src/a.ts",
          status: "completed",
        },
      ],
    })
  })

  it("supports preliminary command output and keeps the latest change for a path", () => {
    const messages = [
      {
        id: "assistant-2",
        parts: [
          {
            input: { changes: [{ diff: "+first", kind: "add", path: "README.md" }] },
            output: { changes: [{ diff: "+first", kind: "add", path: "README.md" }] },
            providerExecuted: true,
            state: "output-available",
            toolCallId: "change-1",
            toolName: "fileChange",
            type: "dynamic-tool",
          },
          {
            input: { changes: [{ diff: "+second", kind: "update", path: "README.md" }] },
            output: { changes: [{ diff: "+second", kind: "update", path: "README.md" }] },
            providerExecuted: true,
            state: "output-available",
            toolCallId: "change-2",
            toolName: "fileChange",
            type: "dynamic-tool",
          },
          {
            input: { command: "build", cwd: "/repo" },
            output: { output: "building", status: "inProgress" },
            providerExecuted: true,
            state: "output-available",
            toolCallId: "command-2",
            toolName: "command",
            type: "dynamic-tool",
          },
        ],
        role: "assistant",
      },
    ] as UIMessage[]

    const artifacts = deriveChatWorkspaceArtifacts(messages)
    expect(artifacts.files).toHaveLength(1)
    expect(artifacts.files[0]?.diff).toBe("+second")
    expect(artifacts.commands[0]).toMatchObject({ output: "building", status: "inProgress" })
  })
})
