import type { v2 } from "@cypheria/protocol/codex-types"
import { describe, expect, it, vi } from "vitest"

import { CodexDynamicToolRegistry } from "./codex-dynamic-tools.js"

const spec: v2.DynamicToolSpec = {
  description: "Read the active wallet",
  inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  name: "wallet_read",
  type: "function",
}

describe("CodexDynamicToolRegistry", () => {
  it("registers trusted handlers and unregisters them without exposing execution to clients", async () => {
    const registry = new CodexDynamicToolRegistry()
    const handler = vi.fn(async () => ({
      contentItems: [{ text: "0x1234", type: "inputText" as const }],
      success: true,
    }))
    const unregister = registry.register([spec], handler)

    expect(registry.getSpecs()).toEqual([spec])
    await expect(
      registry.call({
        arguments: {},
        callId: "call-1",
        namespace: null,
        threadId: "native-thread",
        tool: "wallet_read",
        turnId: "turn-1",
      })
    ).resolves.toMatchObject({ success: true })
    expect(handler).toHaveBeenCalledOnce()

    unregister()
    await expect(
      registry.call({
        arguments: {},
        callId: "call-2",
        namespace: null,
        threadId: "native-thread",
        tool: "wallet_read",
        turnId: "turn-1",
      })
    ).resolves.toMatchObject({ success: false })
  })

  it("rejects duplicate tool names", () => {
    const registry = new CodexDynamicToolRegistry()
    registry.register([spec], () => ({ contentItems: [], success: true }))
    expect(() => registry.register([spec], () => ({ contentItems: [], success: true }))).toThrow(
      "already registered"
    )
  })
})
