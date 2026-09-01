import { createDappSession } from "@cypheria/web3-browser"
import { describe, expect, it, vi } from "vitest"

import { createDappBrowserController, DAPP_WEB_PREFERENCES } from "./dapp-browser.js"

describe("desktop dApp browser controller", () => {
  it("creates origin-isolated views and verifies the trusted WebContents sender", async () => {
    let nextId = 1
    const created: Array<{ partition: string; webPreferences: typeof DAPP_WEB_PREFERENCES }> = []
    const runtime = vi.fn(async (request) => ({ id: request.id, result: "0x1" }))
    const controller = createDappBrowserController({
      createWebContents: async (input) => {
        created.push({ partition: input.partition, webPreferences: input.webPreferences })
        const id = nextId++
        return { destroy: vi.fn(), getUrl: () => input.url, id }
      },
      preloadPath: "/app/dapp-preload.cjs",
      requestRuntime: runtime,
      sessions: { open: async (url) => createDappSession(url, "2026-09-01T08:00:00.000Z") },
    })
    const one = await controller.open("https://one.example/swap")
    const two = await controller.open("https://two.example/market")

    expect(one.session.partition).not.toBe(two.session.partition)
    expect(created).toEqual([
      { partition: one.session.partition, webPreferences: DAPP_WEB_PREFERENCES },
      { partition: two.session.partition, webPreferences: DAPP_WEB_PREFERENCES },
    ])
    await expect(
      controller.routeProviderRequest(one.webContentsId, "https://one.example/swap", {
        id: "provider_1",
        method: "eth_chainId",
        origin: one.session.origin,
        sessionKey: one.session.key,
      })
    ).resolves.toEqual({ id: "provider_1", result: "0x1" })
    await expect(
      controller.routeProviderRequest(one.webContentsId, "https://one.example/swap", {
        id: "provider_2",
        method: "eth_chainId",
        origin: two.session.origin,
        sessionKey: two.session.key,
      })
    ).rejects.toMatchObject({ code: "DAPP_SCOPE_MISMATCH" })
    expect(runtime).toHaveBeenCalledTimes(1)
  })
})
