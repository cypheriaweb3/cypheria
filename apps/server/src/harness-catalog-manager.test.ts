import { describe, expect, it, vi } from "vitest"

import { HarnessCatalogManager } from "./harness-catalog-manager.js"

const discovered = (label = "Model") => ({
  models: [
    {
      agentId: "codex" as const,
      aliases: [],
      contextWindowMaxTokens: null,
      defaultThinkingOptionId: null,
      description: null,
      id: "model",
      isDefault: true,
      isSelectable: true,
      label,
      metadata: {},
      providerId: "openai",
      providerLabel: "OpenAI",
      thinkingOptions: [],
    },
  ],
  settingSections: [],
})

describe("HarnessCatalogManager", () => {
  it("loads lazily, merges concurrent reads, and reuses its snapshot", async () => {
    let resolveDiscovery: ((value: ReturnType<typeof discovered>) => void) | undefined
    const discover = vi.fn(
      () =>
        new Promise<ReturnType<typeof discovered>>((resolve) => {
          resolveDiscovery = resolve
        })
    )
    const manager = new HarnessCatalogManager(discover)

    expect(discover).not.toHaveBeenCalled()
    const first = manager.get("codex")
    const second = manager.get("codex")
    expect(discover).toHaveBeenCalledTimes(1)
    resolveDiscovery?.(discovered())
    expect(await first).toEqual(await second)
    expect((await manager.get("codex")).status).toBe("ready")
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it("refreshes explicitly and preserves the last snapshot when refresh fails", async () => {
    const discover = vi
      .fn()
      .mockResolvedValueOnce(discovered("First"))
      .mockRejectedValueOnce(new Error("offline"))
    const manager = new HarnessCatalogManager(discover)

    const first = await manager.get("codex")
    const failed = await manager.get("codex", true)
    expect(first.models[0]?.label).toBe("First")
    expect(failed.models[0]?.label).toBe("First")
    expect(failed).toMatchObject({ error: "offline", stale: true, status: "ready" })
  })

  it("preserves authentication-required as a non-error catalog state", async () => {
    const manager = new HarnessCatalogManager(async () => ({
      models: [],
      settingSections: [],
      status: "authentication-required",
    }))

    await expect(manager.get("cline")).resolves.toMatchObject({
      error: null,
      stale: false,
      status: "authentication-required",
    })
  })

  it("reloads after invalidation and aborts active discovery on stop", async () => {
    const signals: AbortSignal[] = []
    const discover = vi.fn(async (_agentId, signal: AbortSignal) => {
      signals.push(signal)
      return discovered(String(signals.length))
    })
    const manager = new HarnessCatalogManager(discover)
    await manager.get("codex")
    manager.invalidate("codex")
    expect((await manager.get("codex")).models[0]?.label).toBe("2")

    const waiting = new HarnessCatalogManager(
      (_agentId, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
    )
    const request = waiting.get("codex")
    waiting.stop()
    await expect(request).rejects.toBeDefined()
  })
})
