import type { CypheriaApi } from "@cypheria/client"
import type { AgentId, ServerMessage, ThreadView } from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import { createAcp } from "./acp/index.js"
import { createClaude } from "./claude/index.js"
import { createCodex } from "./codex/index.js"
import { createOpenCode } from "./opencode/index.js"
import { createPi } from "./pi/index.js"

const thread = (agentId: ThreadView["agentId"], state: ThreadView["state"]): ThreadView => ({
  activeTurn: state === "running" ? { id: "turn-1", startedAt: "2026-09-18T00:00:00.000Z" } : null,
  agentId,
  agentSessionId: `${agentId}-session`,
  archivedAt: null,
  attention: false,
  capabilities: {
    changeCwd: true,
    configure: true,
    fork: true,
    promptContent: ["text", "image"],
    providerExtensions: true,
    steer: true,
  },
  createdAt: 1,
  cwd: "/repo",
  forkedFromId: null,
  id: "01996a3a-bcde-7000-8000-000000000001",
  pendingInteractions: [],
  position: 0,
  recencyAt: 1,
  state,
  title: null,
  updatedAt: 1,
})

const createFakeClient = (agentId: ThreadView["agentId"]) => {
  const listeners = new Map<string, Set<(message: never) => void>>()
  const emit = (message: ServerMessage) => {
    for (const listener of listeners.get(message.type) ?? []) listener(message as never)
  }
  const created = thread(agentId, "idle")
  const threads = {
    cancelTurn: vi.fn(async () => thread(agentId, "idle")),
    close: vi.fn(async () => thread(agentId, "stopped")),
    create: vi.fn(async () => ({
      thread: created,
      timeline: { endCursor: null, epoch: crypto.randomUUID() },
    })),
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => created),
    getTimeline: vi.fn(),
    list: vi.fn(),
    move: vi.fn(),
    respondToInteraction: vi.fn(),
    resume: vi.fn(async () => ({
      thread: created,
      timeline: { endCursor: null, epoch: crypto.randomUUID() },
    })),
    startTurn: vi.fn(async () => {
      setTimeout(() => {
        emit({
          payload: {
            epoch: crypto.randomUUID(),
            row: {
              item: {
                itemId: "answer-1",
                operation: "append",
                role: "assistant",
                text: "Done.",
                type: "message",
              },
              providerItemId: "native-answer-1",
              seq: 1,
              timestamp: "2026-09-18T00:00:01.000Z",
              turnId: "turn-1",
            },
            threadId: created.id,
          },
          type: "thread.timeline.appended.notification",
        })
        emit({ payload: thread(agentId, "idle"), type: "thread.updated.notification" })
      }, 0)
      return { thread: thread(agentId, "running"), turnId: "turn-1" }
    }),
    timeline: { get: vi.fn() },
    touchRecency: vi.fn(),
    update: vi.fn(),
    updateConfig: vi.fn(async () => created),
  }
  const client = {
    on: (type: string, handler: (message: never) => void) => {
      const handlers = listeners.get(type) ?? new Set()
      handlers.add(handler)
      listeners.set(type, handlers)
      return () => handlers.delete(handler)
    },
    threads,
  } as unknown as Pick<CypheriaApi, "on" | "threads">
  return { client, threads }
}

const prompt = [
  { content: [{ text: "Implement it", type: "text" as const }], role: "user" as const },
]

describe("Cypheria AI SDK providers", () => {
  it("creates all first-party and ACP providers over the shared client", () => {
    const { client } = createFakeClient("codex")
    const providers = [
      createCodex({ client }),
      createClaude({ client }),
      createPi({ client }),
      createOpenCode({ client }),
      createAcp({ agentId: "gemini", client }),
    ]
    expect(providers.map((provider) => provider("default").provider)).toEqual([
      "cypheria.codex",
      "cypheria.claude",
      "cypheria.pi",
      "cypheria.opencode",
      "cypheria.gemini",
    ])
  })

  it.each([
    ["codex", (client: Pick<CypheriaApi, "on" | "threads">) => createCodex({ client })],
    ["claude", (client: Pick<CypheriaApi, "on" | "threads">) => createClaude({ client })],
    ["pi", (client: Pick<CypheriaApi, "on" | "threads">) => createPi({ client })],
    ["opencode", (client: Pick<CypheriaApi, "on" | "threads">) => createOpenCode({ client })],
    [
      "gemini",
      (client: Pick<CypheriaApi, "on" | "threads">) => createAcp({ agentId: "gemini", client }),
    ],
  ] as const)("streams canonical timeline text for %s", async (agentId, createProvider) => {
    const { client, threads } = createFakeClient(agentId as AgentId)
    const model = createProvider(client)("agent-model")
    const result = await model.doStream({ prompt })
    const parts = []
    for await (const part of result.stream) parts.push(part)

    expect(parts).toContainEqual(expect.objectContaining({ type: "stream-start" }))
    expect(parts).toContainEqual(
      expect.objectContaining({ delta: "Done.", id: "answer-1", type: "text-delta" })
    )
    expect(parts).toContainEqual(expect.objectContaining({ id: "answer-1", type: "text-end" }))
    expect(parts).toContainEqual(
      expect.objectContaining({
        finishReason: { raw: "completed", unified: "stop" },
        providerMetadata: {
          cypheria: expect.objectContaining({
            agentId,
            modelId: "agent-model",
            threadId: "01996a3a-bcde-7000-8000-000000000001",
          }),
        },
        type: "finish",
      })
    )
    expect(threads.create).toHaveBeenCalledWith(expect.objectContaining({ agentId }))
    expect(threads.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ text: "Implement it", type: "text" }] })
    )
  })

  it("deletes explicitly ephemeral threads after completion", async () => {
    const { client, threads } = createFakeClient("claude")
    const model = createClaude({ client, threadMode: "ephemeral" })("claude-default")
    const result = await model.doStream({ prompt })
    for await (const _part of result.stream) {
      // Drain the stream.
    }
    expect(threads.delete).toHaveBeenCalledWith("01996a3a-bcde-7000-8000-000000000001")
  })

  it("sends only the latest message when continuing a persistent server thread", async () => {
    const { client, threads } = createFakeClient("codex")
    const model = createCodex({
      client,
      threadId: "01996a3a-bcde-7000-8000-000000000001",
    })("default")
    const result = await model.doStream({
      prompt: [
        { content: [{ text: "Earlier", type: "text" }], role: "user" },
        { content: [{ text: "Previous answer", type: "text" }], role: "assistant" },
        { content: [{ text: "Continue", type: "text" }], role: "user" },
      ],
    })
    for await (const _part of result.stream) {
      // Drain the stream.
    }

    expect(threads.create).not.toHaveBeenCalled()
    expect(threads.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ content: [{ text: "Continue", type: "text" }] })
    )
  })

  it("embeds browser-local attachment URLs before sending them to the server", async () => {
    const { client, threads } = createFakeClient("codex")
    const model = createCodex({ client })("default")
    const result = await model.doStream({
      prompt: [
        {
          content: [
            {
              data: { type: "url", url: new URL("data:image/png;base64,AA==") },
              mediaType: "image/png",
              type: "file",
            },
          ],
          role: "user",
        },
      ],
    })
    for await (const _part of result.stream) {
      // Drain the stream.
    }

    expect(threads.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [{ data: "AA==", mimeType: "image/png", type: "image" }],
      })
    )
  })
})
