import { describe, expect, test } from "vitest"

import {
  projectThreadTimelineRows,
  ThreadArchiveRequestSchema,
  ThreadContextUsageSchema,
  ThreadForkRequestSchema,
  ThreadInteractionRespondRequestSchema,
  ThreadTimelineGetRequestSchema,
  ThreadTimelineItemSchema,
  ThreadTimelinePageSchema,
  ThreadTurnSteerRequestSchema,
  ThreadViewSchema,
} from "./index.ts"

describe("thread protocol", () => {
  test("normalizes agent-specific context usage without native payloads", () => {
    const usage = ThreadContextUsageSchema.parse({
      agentId: "claude",
      categories: [{ kind: "used", name: "Messages", tokens: 70 }],
      cost: null,
      kind: "claude",
      maxTokens: 100,
      model: "claude-sonnet",
      observedAt: new Date().toISOString(),
      percentage: 70,
      rawMaxTokens: 120,
      remainingTokens: 30,
      source: "queried",
      tokens: null,
      usedTokens: 70,
    })
    expect(usage.kind).toBe("claude")
    expect(usage.remainingTokens).toBe(30)
  })

  test("uses thread identity while keeping the harness session id observational", () => {
    const thread = ThreadViewSchema.parse({
      activeTurn: null,
      agentId: "codex",
      agentSessionId: "harness-thread-1",
      archivedAt: null,
      attention: false,
      capabilities: {
        changeCwd: true,
        configure: true,
        fork: true,
        promptContent: ["text"],
        harnessExtensions: true,
        steer: true,
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
    expect(thread.agentSessionId).toBe("harness-thread-1")
  })

  test("models shared archive and fork operations using Cypheria thread ids", () => {
    const threadId = "01996a3a-bcde-7000-8000-000000000001"
    expect(
      ThreadArchiveRequestSchema.parse({
        payload: { threadId },
        requestId: "request-1",
        type: "thread.archive.request",
      }).payload.threadId
    ).toBe(threadId)
    expect(
      ThreadForkRequestSchema.parse({
        payload: { cwd: "/tmp/fork", threadId, title: "Fork" },
        requestId: "request-2",
        type: "thread.fork.request",
      }).payload
    ).toMatchObject({ cwd: "/tmp/fork", threadId, title: "Fork" })
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

  test("models keyed multi-question answers and structured harness responses", () => {
    const request = ThreadInteractionRespondRequestSchema.parse({
      payload: {
        interactionId: "question-1",
        response: {
          answers: { language: ["TypeScript"], tests: ["Vitest", "Playwright"] },
          type: "answers",
        },
        threadId: "01996a3a-bcde-7000-8000-000000000001",
      },
      requestId: "request-1",
      type: "thread.interaction.respond.request",
    })

    expect(request.payload.response).toEqual({
      answers: { language: ["TypeScript"], tests: ["Vitest", "Playwright"] },
      type: "answers",
    })

    expect(
      ThreadInteractionRespondRequestSchema.parse({
        payload: {
          interactionId: "permission-1",
          response: {
            outcome: "allow_always",
            permissions: { network: { enabled: true } },
            scope: "session",
            strictAutoReview: true,
            type: "permission",
          },
          threadId: "01996a3a-bcde-7000-8000-000000000001",
        },
        requestId: "request-2",
        type: "thread.interaction.respond.request",
      }).payload.response
    ).toMatchObject({ scope: "session", strictAutoReview: true })
  })

  test("validates active-turn steering as a common thread request", () => {
    expect(
      ThreadTurnSteerRequestSchema.parse({
        payload: {
          clientMessageId: "message-2",
          content: [{ text: "adjust", type: "text" }],
          threadId: "01996a3a-bcde-7000-8000-000000000001",
        },
        requestId: "request-1",
        type: "thread.turn.steer.request",
      })
    ).toMatchObject({ payload: { clientMessageId: "message-2" } })
  })

  test("validates the shared rich timeline surface and harness extensions", () => {
    const items = [
      {
        attachments: [
          { data: "AA==", mimeType: "image/png", type: "image" },
          { name: "spec.md", type: "resource-link", uri: "https://example.com/spec.md" },
        ],
        itemId: "user-1",
        operation: "replace",
        role: "user",
        text: "Review these",
        type: "message",
      },
      {
        command: "pnpm test",
        cwd: "/work/cypheria",
        durationMs: 250,
        exitCode: 0,
        itemId: "command-1",
        output: "ok",
        status: "completed",
        type: "command",
      },
      {
        changes: [
          {
            diff: "+export const value = 1",
            kind: "update",
            path: "src/index.ts",
            previousPath: null,
          },
        ],
        itemId: "diff-1",
        status: "completed",
        type: "diff",
      },
      {
        decision: "pending",
        interactionId: "permission-1",
        itemId: "approval-1",
        message: "Allow pnpm test?",
        title: "Command approval",
        type: "approval",
      },
      {
        itemId: "artifact-1",
        kind: "file",
        mimeType: "text/plain",
        name: "report.txt",
        type: "artifact",
        uri: "file:///work/report.txt",
      },
      {
        agentId: "claude",
        itemId: "harness-1",
        nativeType: "sdk_message",
        payload: { subtype: "compact_boundary" },
        type: "harness",
      },
    ]

    expect(items.map((item) => ThreadTimelineItemSchema.safeParse(item).success)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ])
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
        harnessItemId: null,
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
        harnessItemId: null,
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
        harnessItemId: null,
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
