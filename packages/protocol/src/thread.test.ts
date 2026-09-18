import { describe, expect, test } from "vitest"

import {
  projectThreadTimelineRows,
  ThreadInteractionRespondRequestSchema,
  ThreadTimelineGetRequestSchema,
  ThreadTimelinePageSchema,
  ThreadViewSchema,
} from "./index.ts"

describe("thread protocol", () => {
  test("uses thread identity while keeping the provider session id observational", () => {
    const thread = ThreadViewSchema.parse({
      activeTurn: null,
      agentId: "codex",
      agentSessionId: "provider-thread-1",
      attention: false,
      capabilities: {
        changeCwd: true,
        configure: true,
        fork: true,
        promptContent: ["text"],
        providerExtensions: true,
      },
      createdAt: 1,
      cwd: "/tmp/project",
      forkedFromId: null,
      id: "01996a3a-bcde-7000-8000-000000000001",
      pendingInteractions: [],
      position: 0,
      recencyAt: null,
      state: "idle",
      title: null,
      updatedAt: 1,
    })

    expect(thread.id).toBe("01996a3a-bcde-7000-8000-000000000001")
    expect(thread.agentSessionId).toBe("provider-thread-1")
  })

  test("keeps epoch and sequence in the timeline contract", () => {
    const request = ThreadTimelineGetRequestSchema.parse({
      payload: { threadId: "01996a3a-bcde-7000-8000-000000000001" },
      requestId: "request-1",
      type: "thread.timeline.get.request",
    })
    expect(request.payload.direction).toBe("tail")
    expect(request.payload.projection).toBe("projected")

    expect(
      ThreadTimelinePageSchema.safeParse({
        canonicalRows: [],
        endCursor: null,
        epoch: "c4a760a8-19be-4db1-aa1b-f42159a20542",
        hasNewer: false,
        hasOlder: false,
        projectedItems: [],
        projection: "projected",
        reset: false,
        startCursor: null,
        threadId: "01996a3a-bcde-7000-8000-000000000001",
      }).success
    ).toBe(true)
  })

  test("models multi-question answers without provider-shaped escape hatches", () => {
    const request = ThreadInteractionRespondRequestSchema.parse({
      payload: {
        interactionId: "question-1",
        response: { answers: [["TypeScript"], ["Vitest", "Playwright"]], type: "answers" },
        threadId: "01996a3a-bcde-7000-8000-000000000001",
      },
      requestId: "request-1",
      type: "thread.interaction.respond.request",
    })

    expect(request.payload.response).toEqual({
      answers: [["TypeScript"], ["Vitest", "Playwright"]],
      type: "answers",
    })
  })

  test("projects canonical updates and retains their exact source coverage", () => {
    const rows = [
      {
        item: {
          itemId: "assistant-1",
          operation: "append" as const,
          role: "assistant" as const,
          text: "hello",
          type: "message" as const,
        },
        providerItemId: null,
        seq: 1,
        timestamp: "2026-09-18T00:00:00.000Z",
        turnId: "turn-1",
      },
      {
        item: {
          itemId: "tool-1",
          name: "shell",
          status: "running" as const,
          input: { command: "pwd" },
          output: null,
          error: null,
          type: "tool" as const,
        },
        providerItemId: null,
        seq: 2,
        timestamp: "2026-09-18T00:00:01.000Z",
        turnId: "turn-1",
      },
      {
        item: {
          itemId: "assistant-1",
          operation: "append" as const,
          role: "assistant" as const,
          text: " world",
          type: "message" as const,
        },
        providerItemId: null,
        seq: 3,
        timestamp: "2026-09-18T00:00:02.000Z",
        turnId: "turn-1",
      },
    ]

    expect(projectThreadTimelineRows(rows)).toEqual([
      expect.objectContaining({
        collapsed: true,
        item: expect.objectContaining({ text: "hello world" }),
        seqEnd: 3,
        seqStart: 1,
        sourceSeqRanges: [
          { end: 1, start: 1 },
          { end: 3, start: 3 },
        ],
      }),
      expect.objectContaining({ seqEnd: 2, seqStart: 2 }),
    ])
  })
})
