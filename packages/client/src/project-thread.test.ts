import { describe, expect, it, vi } from "vitest"

import { createProjectThreadActions } from "./project-thread.js"
import type { ServerClient } from "./server-client.js"

describe("project/thread actions", () => {
  it("maps typed actions to project/thread requests and leaves agent-session binding unavailable", async () => {
    const requestProjectThread = vi.fn(async (type: string, _payload: unknown) => ({
      payload: {
        ok: true as const,
        value:
          type === "thread.create.request"
            ? {
                agentId: "codex",
                agentSessionId: null,
                createdAt: 100,
                cwd: null,
                forkedFromId: null,
                id: "01984de2-8f74-7c91-a3b2-5c5e937cf319",
                position: 0,
                recencyAt: null,
                title: null,
                updatedAt: 100,
              }
            : {},
      },
      requestId: "test",
      type: type.replace(/\.request$/, ".response"),
    }))
    const actions = createProjectThreadActions({ requestProjectThread } as unknown as ServerClient)

    await expect(actions.threads.create({ agentId: "codex" })).resolves.toMatchObject({
      agentSessionId: null,
    })
    expect(requestProjectThread).toHaveBeenCalledWith(
      "thread.create.request",
      { agentId: "codex" },
      undefined
    )
    expect(actions.threads).not.toHaveProperty("bindAgentSessionId")
    expect(actions.threads).not.toHaveProperty("getByAgentSession")
  })

  it("turns project/thread result failures into named errors", async () => {
    const requestProjectThread = vi.fn(async () => ({
      payload: {
        error: { code: "THREAD_NOT_FOUND", message: "Thread was not found" },
        ok: false as const,
      },
      requestId: "test",
      type: "thread.read.response" as const,
    }))
    const actions = createProjectThreadActions({ requestProjectThread } as unknown as ServerClient)

    await expect(actions.threads.get("01984de2-8f74-7c91-a3b2-5c5e937cf319")).rejects.toMatchObject(
      { message: "Thread was not found", name: "THREAD_NOT_FOUND" }
    )
  })
})
