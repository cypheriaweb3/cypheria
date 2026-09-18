import { describe, expect, it, vi } from "vitest"

import type { ServerClient } from "./server-client.js"
import { createThreadActions } from "./thread.js"

const thread = {
  activeTurn: null,
  agentId: "codex" as const,
  agentSessionId: null,
  attention: false,
  capabilities: {
    changeCwd: true,
    configure: false,
    fork: false,
    promptContent: ["text" as const],
    providerExtensions: false,
  },
  createdAt: 100,
  cwd: null,
  forkedFromId: null,
  id: "01984de2-8f74-7c91-a3b2-5c5e937cf319",
  pendingInteractions: [],
  position: 0,
  recencyAt: null,
  state: "stopped" as const,
  title: null,
  updatedAt: 100,
}

describe("thread actions", () => {
  it("uses thread.get and never exposes the provider session id as a handle", async () => {
    const requestThread = vi.fn(async (type: string, _payload: unknown) => ({
      payload: { ok: true as const, value: thread },
      requestId: "test",
      type: type.replace(/\.request$/, ".response"),
    }))
    const actions = createThreadActions({ requestThread } as unknown as ServerClient)

    await expect(actions.get(thread.id)).resolves.toMatchObject({ id: thread.id })
    expect(requestThread).toHaveBeenCalledWith(
      "thread.get.request",
      { threadId: thread.id },
      undefined
    )
    expect(actions).not.toHaveProperty("getByAgentSessionId")
  })

  it("turns thread result failures into named errors", async () => {
    const requestThread = vi.fn(async () => ({
      payload: {
        error: { code: "THREAD_NOT_FOUND", message: "Thread was not found" },
        ok: false as const,
      },
      requestId: "test",
      type: "thread.get.response" as const,
    }))
    const actions = createThreadActions({ requestThread } as unknown as ServerClient)

    await expect(actions.get(thread.id)).rejects.toMatchObject({
      message: "Thread was not found",
      name: "THREAD_NOT_FOUND",
    })
  })
})
