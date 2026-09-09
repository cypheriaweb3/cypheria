import type { ChatStatus } from "ai"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { composerPromptDraftStore } from "./chat-composer-drafts.js"
import { acquireCodexChatThreadScope, RetainedThreadScopeCache } from "./chat-thread-scope.js"

type FakeScope = {
  readonly dispose?: () => void
  readonly id: string
  status: ChatStatus
}

const scope = (id: string, status: ChatStatus = "ready"): FakeScope => ({ id, status })

beforeEach(() => {
  composerPromptDraftStore.set(["draft-scope-client", "draft-scope-thread"], "")
})

describe("retained thread scope cache", () => {
  it("reuses a scope through its client and durable thread aliases", () => {
    const cache = new RetainedThreadScopeCache<FakeScope>(2)
    const original = cache.acquire("new-chat-1", () => scope("scope-1"))

    cache.addAlias(original, "thread-1")

    expect(cache.acquire("thread-1", () => scope("replacement"))).toBe(original)
    expect(cache.size).toBe(1)
  })

  it("keeps only the most recently used terminal scopes", () => {
    const cache = new RetainedThreadScopeCache<FakeScope>(2)
    const first = cache.acquire("thread-1", () => scope("scope-1"))
    cache.acquire("thread-2", () => scope("scope-2"))
    cache.acquire("thread-1", () => scope("replacement"))

    cache.acquire("thread-3", () => scope("scope-3"))

    expect(first.id).toBe("scope-1")
    expect(cache.has("thread-1")).toBe(true)
    expect(cache.has("thread-2")).toBe(false)
    expect(cache.has("thread-3")).toBe(true)
  })

  it("disposes resources when a terminal scope is evicted", () => {
    const cache = new RetainedThreadScopeCache<FakeScope>(1)
    const dispose = vi.fn()
    cache.acquire("thread-1", () => ({ dispose, id: "scope-1", status: "ready" }))

    cache.acquire("thread-2", () => scope("scope-2"))

    expect(dispose).toHaveBeenCalledOnce()
  })

  it("does not evict mounted or running scopes, then prunes them after completion", () => {
    const cache = new RetainedThreadScopeCache<FakeScope>(1)
    const running = cache.acquire("thread-running", () => scope("running", "streaming"))
    const release = cache.mount(running)
    cache.acquire("thread-ready", () => scope("ready"))

    expect(cache.size).toBe(2)
    expect(cache.has("thread-running")).toBe(true)

    release()
    running.status = "ready"
    cache.notifyStatusChanged(running)

    expect(cache.size).toBe(1)
    expect(cache.has("thread-running")).toBe(true)
    expect(cache.has("thread-ready")).toBe(false)
  })

  it("keeps composer text when a new chat adopts its durable thread id", () => {
    const retained = acquireCodexChatThreadScope("draft-scope-client", {
      initialComposerText: "Initial prompt",
      options: { model: "gpt-5.4", provider: "openai" },
    })
    retained.setComposerText("Unsent follow-up")
    retained.addComposerAlias("draft-scope-thread")

    const restored = acquireCodexChatThreadScope("draft-scope-thread", {
      options: { model: "gpt-5.4", provider: "openai" },
    })

    expect(restored).toBe(retained)
    expect(restored.composerText).toBe("Unsent follow-up")
  })

  it("keeps session attachments when a new chat adopts its durable thread id", () => {
    const retained = acquireCodexChatThreadScope("attachment-scope-client", {
      options: { model: "gpt-5.4", provider: "openai" },
    })
    retained.setComposerAttachments([
      {
        filename: "reference.png",
        id: "attachment-1",
        mediaType: "image/png",
        type: "file",
        url: "data:image/png;base64,AA==",
      },
    ])
    retained.addComposerAlias("attachment-scope-thread")

    const restored = acquireCodexChatThreadScope("attachment-scope-thread", {
      options: { model: "gpt-5.4", provider: "openai" },
    })

    expect(restored).toBe(retained)
    expect(restored.composerAttachments).toEqual([
      expect.objectContaining({ filename: "reference.png", id: "attachment-1" }),
    ])
  })

  it("revokes blob-backed attachments when its chat scope is disposed", () => {
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    const retained = acquireCodexChatThreadScope("attachment-disposal-scope", {
      options: { model: "gpt-5.4", provider: "openai" },
    })
    retained.setComposerAttachments([
      {
        filename: "temporary.png",
        id: "attachment-disposal-1",
        mediaType: "image/png",
        type: "file",
        url: "blob:temporary-attachment",
      },
    ])

    retained.dispose()

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:temporary-attachment")
    expect(retained.composerAttachments).toEqual([])
    revokeObjectURL.mockRestore()
  })
})
