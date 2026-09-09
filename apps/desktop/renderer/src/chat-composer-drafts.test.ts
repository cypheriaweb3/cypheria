import { describe, expect, it, vi } from "vitest"

import { COMPOSER_DRAFT_STORAGE_KEY, ComposerPromptDraftStore } from "./chat-composer-drafts.js"

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe("composer prompt draft store", () => {
  it("restores a draft through both the client and durable thread aliases", () => {
    const storage = new MemoryStorage()
    const store = new ComposerPromptDraftStore(storage, 100, 250, () => 42)

    store.set(["new-chat-1", "thread-1"], "Keep this unsent prompt")
    store.flush()

    const restored = new ComposerPromptDraftStore(storage)
    expect(restored.get("new-chat-1")).toBe("Keep this unsent prompt")
    expect(restored.get("thread-1")).toBe("Keep this unsent prompt")
  })

  it("removes submitted drafts from every alias", () => {
    const storage = new MemoryStorage()
    const store = new ComposerPromptDraftStore(storage)
    store.set(["new-chat-1", "thread-1"], "Send me")
    store.set(["new-chat-1", "thread-1"], "")
    store.flush()

    expect(store.get("new-chat-1")).toBeUndefined()
    expect(store.get("thread-1")).toBeUndefined()
    expect(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).not.toContain("Send me")
  })

  it("bounds persisted aliases by least-recently-written order", () => {
    const storage = new MemoryStorage()
    let now = 0
    const store = new ComposerPromptDraftStore(storage, 2, 250, () => ++now)

    store.set(["thread-1"], "one")
    store.set(["thread-2"], "two")
    store.set(["thread-1"], "one updated")
    store.set(["thread-3"], "three")

    expect(store.get("thread-1")).toBe("one updated")
    expect(store.get("thread-2")).toBeUndefined()
    expect(store.get("thread-3")).toBe("three")
  })

  it("debounces storage writes", () => {
    vi.useFakeTimers()
    try {
      const storage = new MemoryStorage()
      const store = new ComposerPromptDraftStore(storage, 100, 250)

      store.set(["thread-1"], "a")
      store.set(["thread-1"], "ab")
      expect(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toBeNull()

      vi.advanceTimersByTime(249)
      expect(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toBeNull()
      vi.advanceTimersByTime(1)
      expect(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toContain("ab")
    } finally {
      vi.useRealTimers()
    }
  })
})
