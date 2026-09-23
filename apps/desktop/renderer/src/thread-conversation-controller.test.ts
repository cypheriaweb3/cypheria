import { describe, expect, it, vi } from "vitest"
import { ensureCypheriaClient } from "./cypheria-client.js"
import { ThreadConversationController } from "./thread-conversation-controller.js"

vi.mock("./cypheria-client.js", () => ({ ensureCypheriaClient: vi.fn() }))

describe("ThreadConversationController", () => {
  it("reconnects after a development-mode effect remount", async () => {
    vi.mocked(ensureCypheriaClient).mockResolvedValue({
      on: () => () => undefined,
      subscribeConnectionStatus: () => () => undefined,
    } as never)
    const controller = new ThreadConversationController({ agentId: "codex" })
    const firstConnect = controller.connect()
    controller.dispose()
    await controller.connect()
    await firstConnect
    expect(controller.getSnapshot().loadState).toBe("ready")
  })
})
