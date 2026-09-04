import { createDappSession } from "@cypheria/wallet-provider"
import { describe, expect, it, vi } from "vitest"

import { createDappBrowserController, DAPP_WEB_PREFERENCES } from "./dapp-browser.js"

describe("desktop dApp browser controller", () => {
  it("creates origin-isolated views and verifies the trusted WebContents sender", async () => {
    let nextId = 1
    const created: Array<{ partition: string; webPreferences: typeof DAPP_WEB_PREFERENCES }> = []
    const runtime = vi.fn(async (request) => ({ id: request.id, result: "0x1" }))
    const sent: unknown[] = []
    const controller = createDappBrowserController({
      createWebContents: async (input) => {
        created.push({ partition: input.partition, webPreferences: input.webPreferences })
        const id = nextId++
        return {
          destroy: vi.fn(),
          getUrl: () => input.url,
          id,
          send: (_channel: string, payload: unknown) => sent.push(payload),
        }
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
    expect(sent).toEqual([])
  })

  it("delivers successful account changes only to the matching dApp view", async () => {
    const sent: unknown[] = []
    const controller = createDappBrowserController({
      createWebContents: async (input) => ({
        destroy: vi.fn(),
        getUrl: () => input.url,
        id: 9,
        send: (channel, payload) => sent.push({ channel, payload }),
      }),
      preloadPath: "/app/dapp-preload.cjs",
      requestRuntime: async (request) => ({
        id: request.id,
        result: ["0x0000000000000000000000000000000000000001"],
      }),
      sessions: { open: async (url) => createDappSession(url, "2026-09-01T08:00:00.000Z") },
    })
    const opened = await controller.open("https://one.example/swap")
    await controller.routeProviderRequest(opened.webContentsId, opened.session.origin, {
      id: "provider_accounts",
      method: "eth_requestAccounts",
      origin: opened.session.origin,
      sessionKey: opened.session.key,
    })
    expect(sent).toEqual([
      {
        channel: "dapp.provider.event",
        payload: {
          event: "ethereum.accountsChanged",
          origin: opened.session.origin,
          payload: ["0x0000000000000000000000000000000000000001"],
          sessionKey: opened.session.key,
        },
      },
    ])
  })

  it("emits a canonical chainChanged event only after a successful switch", async () => {
    const sent: unknown[] = []
    let approved = false
    const controller = createDappBrowserController({
      createWebContents: async (input) => ({
        destroy: vi.fn(),
        getUrl: () => input.url,
        id: 10,
        send: (_channel, payload) => sent.push(payload),
      }),
      preloadPath: "/app/dapp-preload.cjs",
      requestRuntime: async (request) =>
        approved
          ? { id: request.id, result: null }
          : { error: { code: 4001, message: "Rejected" }, id: request.id },
      sessions: { open: async (url) => createDappSession(url, "2026-09-01T08:00:00.000Z") },
    })
    const opened = await controller.open("https://one.example/swap")
    const request = {
      id: "provider_switch",
      method: "wallet_switchEthereumChain",
      origin: opened.session.origin,
      params: [{ chainId: "0xAA36A7" }],
      sessionKey: opened.session.key,
    }
    await controller.routeProviderRequest(opened.webContentsId, opened.session.origin, request)
    expect(sent).toEqual([])
    approved = true
    await controller.routeProviderRequest(opened.webContentsId, opened.session.origin, request)
    expect(sent).toEqual([
      {
        event: "ethereum.chainChanged",
        origin: opened.session.origin,
        payload: "0xaa36a7",
        sessionKey: opened.session.key,
      },
    ])
  })
})
