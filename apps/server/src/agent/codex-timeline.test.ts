import type { v2 } from "@cypheria/protocol/codex-types"
import { describe, expect, it } from "vitest"

import { codexThreadItemToTimeline } from "./codex-timeline.js"

describe("Codex native timeline mapping", () => {
  it("preserves stable item identity while projecting assistant and command lifecycle", () => {
    expect(
      codexThreadItemToTimeline({
        delivery: null,
        id: "answer",
        memoryCitation: null,
        phase: null,
        questions: null,
        text: "Hello",
        type: "agentMessage",
      })
    ).toMatchObject({ itemId: "answer", operation: "replace", text: "Hello", type: "message" })

    expect(
      codexThreadItemToTimeline({
        aggregatedOutput: "ok\n",
        command: "pnpm test",
        commandActions: [],
        cwd: "/repo",
        durationMs: 50,
        exitCode: 0,
        id: "command",
        processId: null,
        status: "completed",
        type: "commandExecution",
      } as unknown as v2.ThreadItem)
    ).toMatchObject({
      command: "pnpm test",
      itemId: "command",
      output: "ok\n",
      status: "completed",
      type: "command",
    })
  })

  it("keeps Codex-specific tool payloads in validated harness metadata", () => {
    const item = codexThreadItemToTimeline({
      arguments: { address: "0x1234" },
      callId: "call-1",
      contentItems: [{ text: "1 ETH", type: "inputText" }],
      id: "tool-1",
      namespace: "wallet",
      status: "completed",
      tool: "balance",
      type: "dynamicToolCall",
    } as unknown as v2.ThreadItem)

    expect(item).toMatchObject({
      harnessData: { agentId: "codex", nativeType: "codex.item.dynamicToolCall" },
      itemId: "tool-1",
      name: "wallet.balance",
      status: "completed",
      type: "tool",
    })
  })
})
