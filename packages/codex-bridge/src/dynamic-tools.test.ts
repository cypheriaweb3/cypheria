import { describe, expect, it } from "vitest"

import type { CodexJsonValue, CodexServerRequestByMethod, ServerRequest } from "./index.js"
import { createCodexDynamicToolRegistry } from "./index.js"

describe("Codex dynamic tool registry", () => {
  it("registers experimental tool specs and dispatches app-server calls", async () => {
    let handler:
      | ((request: CodexServerRequestByMethod<"item/tool/call">) => Promise<CodexJsonValue>)
      | undefined
    const bridge = {
      onServerRequest: <M extends ServerRequest["method"]>(
        method: M,
        next: (request: CodexServerRequestByMethod<M>) => CodexJsonValue | Promise<CodexJsonValue>
      ) => {
        expect(method).toBe("item/tool/call")
        handler = next as typeof handler
        return () => {
          handler = undefined
        }
      },
    }
    const registry = createCodexDynamicToolRegistry(bridge as never)
    const unregister = registry.register(
      [
        {
          description: "Read a wallet",
          inputSchema: { properties: { id: { type: "string" } }, type: "object" },
          name: "read_wallet",
          type: "function",
        },
      ],
      ({ arguments: input }) => ({
        contentItems: [
          { text: `wallet:${String((input as { id?: string }).id)}`, type: "inputText" },
        ],
        success: true,
      })
    )

    expect(registry.getSpecs()).toHaveLength(1)
    await expect(
      handler?.({
        id: "server-1",
        method: "item/tool/call",
        params: {
          arguments: { id: "one" },
          callId: "call-1",
          namespace: null,
          threadId: "thread-1",
          tool: "read_wallet",
          turnId: "turn-1",
        },
      })
    ).resolves.toEqual({
      contentItems: [{ text: "wallet:one", type: "inputText" }],
      success: true,
    })

    unregister()
    expect(registry.getSpecs()).toEqual([])
    registry.close()
  })
})
