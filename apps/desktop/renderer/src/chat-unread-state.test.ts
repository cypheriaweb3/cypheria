import { describe, expect, it } from "vitest"

import {
  MAX_UNREAD_THREAD_IDS,
  nextUnreadThreadIds,
  unreadThreadMutationFromServerMessage,
} from "./chat-unread-state.js"

describe("unread thread state", () => {
  it("adds and removes ids immutably", () => {
    expect(nextUnreadThreadIds([], { action: "unread", threadId: "thread-1" })).toEqual([
      "thread-1",
    ])
    expect(
      nextUnreadThreadIds(["thread-1", "thread-2"], {
        action: "read",
        threadId: "thread-1",
      })
    ).toEqual(["thread-2"])
  })

  it("bounds persisted ids and keeps the most recently marked entries", () => {
    expect(
      nextUnreadThreadIds(["thread-1", "thread-2"], { action: "unread", threadId: "thread-3" }, 2)
    ).toEqual(["thread-2", "thread-3"])
    expect(MAX_UNREAD_THREAD_IDS).toBe(1_000)
  })

  it("maps completion and lifecycle notifications to read-state mutations", () => {
    const notification = {
      payload: {
        epoch: crypto.randomUUID(),
        row: {
          item: {
            boundary: "assistant-final" as const,
            itemId: "assistant-1",
            operation: "append" as const,
            role: "assistant" as const,
            text: "Done",
            type: "message" as const,
          },
          harnessItemId: null,
          seq: 1,
          timestamp: new Date().toISOString(),
          turnId: "turn-1",
        },
        threadId: "01996a3a-bcde-7000-8000-000000000001",
      },
      type: "thread.timeline.appended.notification" as const,
    }

    expect(unreadThreadMutationFromServerMessage(notification, "thread-2")).toMatchObject({
      action: "unread",
      threadId: notification.payload.threadId,
    })
    expect(
      unreadThreadMutationFromServerMessage(notification, notification.payload.threadId)
    ).toMatchObject({
      action: "read",
      threadId: notification.payload.threadId,
    })
  })
})
