import { describe, expect, it, vi } from "vitest"

import {
  MAX_UNREAD_THREAD_IDS,
  UNREAD_THREAD_STORAGE_KEY,
  UnreadThreadStore,
  unreadThreadMutationFromCodexEvent,
} from "./chat-unread-state.js"

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe("unread thread state", () => {
  it("persists read state, notifies subscribers, and hydrates another renderer", () => {
    const storage = new MemoryStorage()
    const store = new UnreadThreadStore(storage)
    const listener = vi.fn()
    store.subscribe(listener)

    expect(store.markUnread("thread-1")).toBe(true)
    expect(store.has("thread-1")).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(new UnreadThreadStore(storage).has("thread-1")).toBe(true)

    expect(store.markRead("thread-1")).toBe(true)
    expect(store.has("thread-1")).toBe(false)
    expect(JSON.parse(storage.values.get(UNREAD_THREAD_STORAGE_KEY) ?? "null")).toEqual([])
  })

  it("bounds persisted ids and keeps the most recently marked entries", () => {
    const storage = new MemoryStorage()
    const store = new UnreadThreadStore(storage, 2)

    store.markUnread("thread-1")
    store.markUnread("thread-2")
    store.markUnread("thread-3")

    expect(store.getSnapshot()).toEqual(new Set(["thread-2", "thread-3"]))
    expect(MAX_UNREAD_THREAD_IDS).toBe(1_000)
  })

  it("syncs external-window changes and ignores malformed storage", () => {
    const store = new UnreadThreadStore(undefined, 3)
    expect(store.syncFromStorage('["thread-1","thread-2"]')).toBe(true)
    expect(store.getSnapshot()).toEqual(new Set(["thread-1", "thread-2"]))
    expect(store.syncFromStorage("not-json")).toBe(true)
    expect(store.getSnapshot()).toEqual(new Set())
  })

  it("maps completion and lifecycle notifications to read-state mutations", () => {
    const notification = (method: string, threadId = "thread-1") => ({
      event: "codex.notification",
      payload: { method, params: { threadId } },
    })

    expect(unreadThreadMutationFromCodexEvent(notification("turn/completed"), "thread-2")).toEqual({
      action: "unread",
      threadId: "thread-1",
    })
    expect(unreadThreadMutationFromCodexEvent(notification("turn/completed"), "thread-1")).toEqual({
      action: "read",
      threadId: "thread-1",
    })
    expect(unreadThreadMutationFromCodexEvent(notification("thread/archived"))).toEqual({
      action: "read",
      threadId: "thread-1",
    })
    expect(unreadThreadMutationFromCodexEvent(notification("item/completed"))).toBeNull()
  })
})
