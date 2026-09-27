import { createDappSession, createDappSessionKey } from "@cypheria/web3/provider"
import { describe, expect, it, vi } from "vitest"

import { type DappGuest, DappProviderController } from "./dapp.js"

const now = "2026-09-01T08:00:00.000Z"
const one = "https://one.example"
const two = "https://two.example"

const setup = (
  runtime: (request: { id: string }) => Promise<unknown> = vi.fn(
    async (request: { id: string }) => ({
      id: request.id,
      result: "0x1",
    })
  )
) => {
  const urls = new Map<number, string>([
    [1, `${one}/swap`],
    [2, `${one}/pool`],
    [3, `${two}/market`],
  ])
  const sent: Array<{ id: number; payload: unknown }> = []
  const openSession = vi.fn(async (origin: string) => createDappSession(origin, now))
  const controller = new DappProviderController({
    findGuest: (id): DappGuest | null => {
      const url = urls.get(id)
      return url
        ? {
            getURL: () => url,
            id,
            isDestroyed: () => false,
            send: (_c, payload) => sent.push({ id, payload }),
          }
        : null
    },
    openSession,
    requestRuntime: runtime as never,
  })
  for (const id of urls.keys()) controller.registerGuest(id)
  return { controller, openSession, runtime, sent, urls }
}

const request = (origin: string, method = "eth_chainId", id = "provider_1") => ({
  id,
  method,
  origin,
  sessionKey: createDappSessionKey(origin),
})

describe("dApp provider controller", () => {
  it("scopes each request to the sending frame and opens a session once per origin", async () => {
    const { controller, openSession, runtime } = setup()
    const sender = { frameOrigin: one, isMainFrame: true, webContentsId: 1 }
    await expect(controller.routeProviderRequest(sender, request(one))).resolves.toEqual({
      id: "provider_1",
      result: "0x1",
    })
    await controller.routeProviderRequest(sender, request(one, "eth_chainId", "provider_2"))
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(one)
    expect(runtime).toHaveBeenCalledTimes(2)
  })

  it("rejects subframes, foreign scopes, and unregistered guests", async () => {
    const { controller, runtime } = setup()
    await expect(
      controller.routeProviderRequest(
        { frameOrigin: one, isMainFrame: false, webContentsId: 1 },
        request(one)
      )
    ).rejects.toMatchObject({ code: "DAPP_SCOPE_MISMATCH" })
    await expect(
      controller.routeProviderRequest(
        { frameOrigin: one, isMainFrame: true, webContentsId: 1 },
        request(two)
      )
    ).rejects.toMatchObject({ code: "DAPP_SCOPE_MISMATCH" })
    await expect(
      controller.routeProviderRequest(
        { frameOrigin: two, isMainFrame: true, webContentsId: 1 },
        request(two)
      )
    ).rejects.toMatchObject({ code: "DAPP_SCOPE_MISMATCH" })
    await expect(
      controller.routeProviderRequest(
        { frameOrigin: one, isMainFrame: true, webContentsId: 9 },
        request(one)
      )
    ).rejects.toMatchObject({ code: "DAPP_VIEW_NOT_FOUND" })
    expect(runtime).not.toHaveBeenCalled()
  })

  it("rejects insecure remote origins", async () => {
    const { controller, urls } = setup()
    urls.set(1, "http://one.example/swap")
    await expect(
      controller.routeProviderRequest(
        { frameOrigin: "http://one.example", isMainFrame: true, webContentsId: 1 },
        request("http://localhost:3000")
      )
    ).rejects.toMatchObject({ code: "DAPP_SCOPE_MISMATCH" })
  })

  it("sends account changes to every tab currently on the same origin only", async () => {
    const { controller, sent, urls } = setup(
      vi.fn(async (req: { id: string }) => ({
        id: req.id,
        result: ["0x0000000000000000000000000000000000000001"],
      }))
    )
    await controller.routeProviderRequest(
      { frameOrigin: one, isMainFrame: true, webContentsId: 1 },
      request(one, "eth_requestAccounts")
    )
    expect(sent.map(({ id }) => id).sort()).toEqual([1, 2])
    expect(sent[0]?.payload).toEqual({
      event: "ethereum.accountsChanged",
      origin: one,
      payload: ["0x0000000000000000000000000000000000000001"],
      sessionKey: createDappSessionKey(one),
    })
    sent.length = 0
    urls.set(2, `${two}/elsewhere`)
    await controller.routeProviderRequest(
      { frameOrigin: one, isMainFrame: true, webContentsId: 1 },
      request(one, "eth_accounts")
    )
    expect(sent.map(({ id }) => id)).toEqual([1])
  })

  it("emits chainChanged only after a successful switch", async () => {
    let approved = false
    const { controller, sent } = setup(
      vi.fn(async (req: { id: string }) =>
        approved
          ? { id: req.id, result: null }
          : { error: { code: 4001, message: "Rejected" }, id: req.id }
      ) as never
    )
    const switchRequest = {
      ...request(one, "wallet_switchEthereumChain"),
      params: [{ chainId: "0xAA36A7" }],
    }
    const sender = { frameOrigin: one, isMainFrame: true, webContentsId: 1 }
    await controller.routeProviderRequest(sender, switchRequest)
    expect(sent).toEqual([])
    approved = true
    await controller.routeProviderRequest(sender, switchRequest)
    expect(sent.find(({ id }) => id === 1)?.payload).toMatchObject({
      event: "ethereum.chainChanged",
      payload: "0xaa36a7",
    })
  })

  it("retries opening a session after a failure", async () => {
    const { controller, openSession } = setup()
    openSession.mockRejectedValueOnce(new Error("server unavailable"))
    const sender = { frameOrigin: one, isMainFrame: true, webContentsId: 1 }
    await expect(controller.routeProviderRequest(sender, request(one))).rejects.toThrow(
      "server unavailable"
    )
    await expect(controller.routeProviderRequest(sender, request(one))).resolves.toMatchObject({
      result: "0x1",
    })
    expect(openSession).toHaveBeenCalledTimes(2)
  })
})
