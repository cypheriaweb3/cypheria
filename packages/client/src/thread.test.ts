import { describe, expect, it, vi } from "vitest"

import type { ServerClient } from "./server-client.js"
import { createThreadActions } from "./thread.js"

const thread = {
  activeTurn: null,
  agentId: "codex" as const,
  agentSessionId: null,
  archivedAt: null,
  attention: false,
  capabilities: {
    changeCwd: true,
    configure: false,
    fork: { assistantMessage: false, threadHead: false, userMessage: false },
    promptContent: ["text" as const],
    rewind: { userMessage: false },
    harnessExtensions: false,
    steer: false,
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
  it("exposes generic Server-owned Thread attachments and notifications", async () => {
    const attachment = {
      attachmentType: "pull_request" as const,
      createdAt: 100,
      identityKey: "github:github.com:cypheria/cypheria#42",
      payload: {
        host: "github.com",
        number: 42,
        owner: "cypheria",
        provider: "github" as const,
        repository: "cypheria",
        url: "https://github.com/cypheria/cypheria/pull/42",
      },
      threadId: thread.id,
      updatedAt: 100,
    }
    const requestThread = vi.fn(async (type: string) => ({
      payload: {
        ok: true as const,
        value:
          type === "thread.attachment.list.request"
            ? { data: [attachment], nextCursor: null }
            : attachment,
      },
      requestId: "test",
      type: type.replace(/\.request$/, ".response"),
    }))
    const handlers = new Map<string, (message: never) => void>()
    const on = vi.fn((type: string, handler: (message: never) => void) => {
      handlers.set(type, handler)
      return () => handlers.delete(type)
    })
    const actions = createThreadActions({ on, requestThread } as unknown as ServerClient)

    await expect(
      actions.attachments.addPullRequest(thread.id, attachment.payload.url)
    ).resolves.toEqual(attachment)
    await expect(actions.attachments.list({ attachmentType: "pull_request" })).resolves.toEqual({
      data: [attachment],
      nextCursor: null,
    })
    const observed = vi.fn()
    const unsubscribe = actions.attachments.subscribe(observed)
    handlers.get("thread.attachment.upserted.notification")?.({
      payload: attachment,
      type: "thread.attachment.upserted.notification",
    } as never)
    expect(observed).toHaveBeenCalledWith({
      payload: attachment,
      type: "thread.attachment.upserted.notification",
    })
    unsubscribe()

    expect(requestThread).toHaveBeenCalledWith(
      "thread.attachment.add.request",
      {
        attachment: { attachmentType: "pull_request", url: attachment.payload.url },
        threadId: thread.id,
      },
      undefined
    )
  })

  it("uses thread.get and never exposes the harness session id as a handle", async () => {
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

  it("exposes archive, unarchive, and fork through shared thread requests", async () => {
    const requestThread = vi.fn(async (type: string, _payload: unknown) => ({
      payload: {
        ok: true as const,
        value:
          type === "thread.fork.request"
            ? {
                composerContent: [],
                thread,
                timeline: {
                  canonicalRows: [],
                  endCursor: null,
                  epoch: crypto.randomUUID(),
                  projectedItems: [],
                  startCursor: null,
                  threadId: thread.id,
                },
              }
            : type === "thread.archive.request"
              ? { thread, warnings: [] }
              : thread,
      },
      requestId: "test",
      type: type.replace(/\.request$/, ".response"),
    }))
    const actions = createThreadActions({ requestThread } as unknown as ServerClient)

    await actions.archive(thread.id)
    await actions.unarchive(thread.id)
    await actions.fork({ target: { kind: "thread-head" }, threadId: thread.id })

    expect(requestThread.mock.calls.map(([type]) => type)).toEqual([
      "thread.archive.request",
      "thread.unarchive.request",
      "thread.fork.request",
    ])
  })

  it("steers an active turn through the shared thread request", async () => {
    const requestThread = vi.fn(async (type: string) => ({
      payload: { ok: true as const, value: { thread, turnId: "turn-1" } },
      requestId: "test",
      type: type.replace(/\.request$/, ".response"),
    }))
    const actions = createThreadActions({ requestThread } as unknown as ServerClient)

    await actions.steerTurn({
      clientMessageId: "message-2",
      content: [{ text: "adjust", type: "text" }],
      threadId: thread.id,
    })

    expect(requestThread).toHaveBeenCalledWith(
      "thread.turn.steer.request",
      {
        clientMessageId: "message-2",
        content: [{ text: "adjust", type: "text" }],
        threadId: thread.id,
      },
      undefined
    )
  })

  it("queries and subscribes to normalized context usage", async () => {
    const usage = {
      agentId: "codex" as const,
      cost: null,
      cumulativeTokens: {
        cacheRead: 10,
        cacheWrite: 0,
        input: 20,
        output: 5,
        reasoning: 2,
        total: 37,
      },
      kind: "codex" as const,
      maxTokens: 100,
      model: null,
      observedAt: new Date().toISOString(),
      percentage: 37,
      remainingTokens: 63,
      source: "reported" as const,
      tokens: {
        cacheRead: 10,
        cacheWrite: 0,
        input: 20,
        output: 5,
        reasoning: 2,
        total: 37,
      },
      usedTokens: 37,
    }
    let notificationHandler: ((message: unknown) => void) | undefined
    const requestThread = vi.fn(async (type: string) => ({
      payload: { ok: true as const, value: usage },
      requestId: "test",
      type: type.replace(/\.request$/, ".response"),
    }))
    const on = vi.fn((_type, handler) => {
      notificationHandler = handler
      return () => undefined
    })
    const actions = createThreadActions({ on, requestThread } as unknown as ServerClient)
    const observed = vi.fn()

    await expect(actions.contextUsage.get(thread.id)).resolves.toEqual(usage)
    actions.contextUsage.subscribe(thread.id, observed)
    notificationHandler?.({ payload: { threadId: thread.id, usage } })

    expect(requestThread).toHaveBeenCalledWith(
      "thread.context.usage.get.request",
      { threadId: thread.id },
      undefined
    )
    expect(observed).toHaveBeenCalledWith(usage)
  })
})
