import { describe, expect, it, vi } from "vitest"

import { createProjectThreadActions } from "./project-thread.js"
import type { ServerClient } from "./server-client.js"

describe("project and section actions", () => {
  it("maps typed project actions to project requests", async () => {
    const requestProjectThread = vi.fn(async (type: string, _payload: unknown) => ({
      payload: {
        ok: true as const,
        value:
          type === "project.membership.list.request"
            ? { data: [], nextCursor: null }
            : {
                createdAt: 100,
                id: "01984de2-8f74-7c91-a3b2-5c5e937cf319",
                name: "Cypheria",
                position: 0,
                recencyAt: null,
                roots: ["/tmp/cypheria"],
                updatedAt: 100,
              },
      },
      requestId: "test",
      type: type.replace(/\.request$/, ".response"),
    }))
    const actions = createProjectThreadActions({ requestProjectThread } as unknown as ServerClient)

    await expect(
      actions.projects.create({ name: "Cypheria", roots: ["/tmp/cypheria"] })
    ).resolves.toMatchObject({ name: "Cypheria" })
    expect(requestProjectThread).toHaveBeenCalledWith(
      "project.create.request",
      { name: "Cypheria", roots: ["/tmp/cypheria"] },
      undefined
    )
    await expect(actions.projects.listMemberships()).resolves.toEqual({
      data: [],
      nextCursor: null,
    })
    expect(requestProjectThread).toHaveBeenCalledWith(
      "project.membership.list.request",
      {},
      undefined
    )
  })
})
