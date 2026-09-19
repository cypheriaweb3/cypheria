import type { ThreadInteraction, ThreadTimelineProjectedItem } from "@cypheria/protocol"
import { describe, expect, it } from "vitest"

import { canonicalInteractionToView, canonicalTimelineToUiMessages } from "./canonical-chat.js"

const projected = (
  item: ThreadTimelineProjectedItem["item"],
  turnId: string | null = "turn-1",
  seq = 1
): ThreadTimelineProjectedItem => ({
  collapsed: false,
  item,
  seqEnd: seq,
  seqStart: seq,
  sourceSeqRanges: [{ end: seq, start: seq }],
  timestamp: "2026-09-18T00:00:00.000Z",
  turnId,
})

describe("canonicalTimelineToUiMessages", () => {
  it("groups assistant timeline items by turn while preserving common rich parts", () => {
    const messages = canonicalTimelineToUiMessages([
      projected(
        { itemId: "user-1", operation: "replace", role: "user", text: "hello", type: "message" },
        "turn-1",
        1
      ),
      projected(
        { itemId: "reason-1", operation: "replace", text: "thinking", type: "reasoning" },
        "turn-1",
        2
      ),
      projected(
        {
          error: null,
          input: { path: "README.md" },
          itemId: "tool-1",
          name: "read_file",
          output: "contents",
          status: "completed",
          type: "tool",
        },
        "turn-1",
        3
      ),
      projected(
        {
          command: "pnpm test",
          cwd: "/repo",
          durationMs: 120,
          exitCode: 0,
          itemId: "command-1",
          output: "ok",
          status: "completed",
          type: "command",
        },
        "turn-1",
        4
      ),
      projected(
        {
          itemId: "assistant-1",
          operation: "replace",
          role: "assistant",
          text: "done",
          type: "message",
        },
        "turn-1",
        5
      ),
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      parts: [{ text: "hello", type: "text" }],
      role: "user",
    })
    expect(messages[1]).toMatchObject({
      id: "assistant:turn-1",
      parts: [
        { text: "thinking", type: "reasoning" },
        { state: "output-available", toolName: "read_file", type: "dynamic-tool" },
        {
          kind: "cypheria.command",
          providerMetadata: { cypheria: { item: { itemId: "command-1" } } },
          type: "custom",
        },
        { text: "done", type: "text" },
      ],
      role: "assistant",
    })
  })

  it("restores user attachments from canonical history", () => {
    const messages = canonicalTimelineToUiMessages([
      projected({
        attachments: [
          { data: "AA==", mimeType: "image/png", type: "image" },
          {
            data: "notes",
            mimeType: "text/plain",
            name: "notes.txt",
            type: "embedded-resource",
            uri: "inline-text:notes.txt",
          },
        ],
        itemId: "user-with-files",
        operation: "replace",
        role: "user",
        text: "Review",
        type: "message",
      }),
    ])

    expect(messages[0]).toMatchObject({
      parts: [
        { text: "Review", type: "text" },
        { mediaType: "image/png", type: "file", url: "data:image/png;base64,AA==" },
        {
          filename: "notes.txt",
          mediaType: "text/plain",
          type: "file",
          url: "data:text/plain,notes",
        },
      ],
      role: "user",
    })
  })
})

describe("canonicalInteractionToView", () => {
  it("keeps permission and question choices usable in the existing conversation UI", () => {
    const permission: ThreadInteraction = {
      createdAt: "2026-09-18T00:00:00.000Z",
      expiresAt: null,
      id: "permission-1",
      kind: "permission",
      message: "Allow command?",
      options: [
        { description: null, id: "allow_once", label: "Allow once" },
        { description: null, id: "allow_always", label: "Always allow" },
        { description: null, id: "deny", label: "Deny" },
      ],
      title: "Command",
    }
    expect(canonicalInteractionToView(permission, "thread-1")).toMatchObject({
      interactionId: "permission-1",
      kind: "approval",
      params: { availableDecisions: ["accept", "acceptForSession", "decline"] },
      threadId: "thread-1",
    })

    permission.harness = {
      agentId: "codex",
      metadata: {
        permissions: { network: { enabled: true } },
        reason: "Needs package access",
      },
      nativeType: "agent.codex.item.permissions.request_approval.request",
    }
    expect(canonicalInteractionToView(permission, "thread-1")).toMatchObject({
      method: "item/permissions/requestApproval",
      params: {
        permissions: { network: { enabled: true } },
        reason: "Needs package access",
      },
    })

    const question: ThreadInteraction = {
      createdAt: "2026-09-18T00:00:00.000Z",
      expiresAt: null,
      id: "question-1",
      kind: "question",
      message: "Choose a mode",
      options: [{ description: "Safer", id: "safe", label: "Safe" }],
      title: "Mode",
    }
    expect(canonicalInteractionToView(question, "thread-1").questions).toEqual([
      {
        header: "Mode",
        id: "0",
        isOther: false,
        isSecret: false,
        options: [{ description: "Safer", label: "Safe" }],
        question: "Choose a mode",
      },
    ])
  })
})
