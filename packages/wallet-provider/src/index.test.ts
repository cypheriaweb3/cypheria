import { SolanaSignMessage, SolanaSignTransaction } from "@solana/wallet-standard-features"
import { StandardConnect, StandardEvents } from "@wallet-standard/features"
import { describe, expect, it, vi } from "vitest"

import {
  type CypheriaSolanaWallet,
  createDappSession,
  createDappSessionKey,
  createDappSessionManager,
  createEip6963ProviderDetail,
  createEthereumProvider,
  createProviderBridge,
  createSolanaWallet,
  EIP6963_ANNOUNCE_PROVIDER_EVENT,
  EIP6963_REQUEST_PROVIDER_EVENT,
  type Eip6963ProviderDetail,
  installSolanaWalletInMainWorld,
  isProviderMethod,
  type ProviderRequest,
  ProviderRpcError,
  type SolanaProviderRequest,
  solanaProviderRequestSchema,
} from "./index.js"

describe("Wallet provider session model", () => {
  it("creates stable origin-scoped session keys", () => {
    expect(createDappSessionKey("https://app.uniswap.org/swap?chain=1")).toBe(
      "cypheria:dapp:https://app.uniswap.org"
    )
    expect(() => createDappSessionKey("file:///tmp/dapp.html")).toThrow()
    expect(() => createDappSessionKey("https://user:pass@app.example")).toThrow()
    expect(() => createDappSessionKey("http://app.example")).toThrow()
    expect(createDappSessionKey("http://localhost:5173/app")).toBe(
      "cypheria:dapp:http://localhost:5173"
    )
  })

  it("creates persistent Electron partition names from session keys", () => {
    expect(createDappSession("https://app.aave.com/markets", "2026-05-28T00:00:00.000Z")).toEqual({
      createdAt: "2026-05-28T00:00:00.000Z",
      key: "cypheria:dapp:https://app.aave.com",
      origin: "https://app.aave.com",
      partition: "persist:cypheria:dapp:https://app.aave.com",
    })
  })

  it("recognizes supported EIP-1193 provider methods", () => {
    expect(isProviderMethod("eth_requestAccounts")).toBe(true)
    expect(isProviderMethod("wallet_switchEthereumChain")).toBe(true)
    expect(isProviderMethod("eth_sendRawTransaction")).toBe(false)
    expect(isProviderMethod("eth_call")).toBe(true)
  })

  it("serializes provider requests to the configured transport", async () => {
    const requests: ProviderRequest[] = []
    const bridge = createProviderBridge({
      chainId: 1,
      origin: "https://app.example/swap",
      transport: (request) => {
        requests.push(request)
        return {
          id: request.id,
          result: ["0x0000000000000000000000000000000000000001"],
        }
      },
    })

    await expect(bridge.request({ method: "eth_requestAccounts" })).resolves.toEqual([
      "0x0000000000000000000000000000000000000001",
    ])
    expect(requests).toEqual([
      {
        chainId: 1,
        id: "provider_1",
        method: "eth_requestAccounts",
        origin: "https://app.example",
        params: undefined,
        sessionKey: "cypheria:dapp:https://app.example",
      },
    ])
  })

  it("throws structured provider errors", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: (request) => ({
        error: {
          code: 4001,
          message: "User rejected the request.",
        },
        id: request.id,
      }),
    })

    await expect(bridge.request({ method: "personal_sign", params: ["hello"] })).rejects.toEqual(
      expect.objectContaining({
        code: 4001,
        message: "User rejected the request.",
        name: "ProviderRpcError",
      })
    )
  })

  it("rejects unsupported provider methods before transport", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: () => {
        throw new Error("transport should not be called")
      },
    })

    await expect(bridge.request({ method: "eth_sendRawTransaction" })).rejects.toBeInstanceOf(
      ProviderRpcError
    )
  })

  it("persists session reuse and rejects cross-origin request scope", async () => {
    const sessions = new Map<string, ReturnType<typeof createDappSession>>()
    let now = "2026-09-01T08:00:00.000Z"
    const manager = createDappSessionManager({
      now: () => now,
      persistence: {
        getSession: async (origin) => sessions.get(origin),
        saveSession: async (session) => {
          sessions.set(session.origin, session)
          return session
        },
      },
    })
    const opened = await manager.open("https://app.example/path")
    now = "2026-09-01T08:01:00.000Z"
    await expect(manager.open("https://app.example/other")).resolves.toMatchObject({
      createdAt: opened.createdAt,
      lastUsedAt: now,
    })
    await expect(
      manager.validateRequest({
        id: "request_1",
        method: "eth_accounts",
        origin: "https://evil.example",
        sessionKey: opened.key,
      })
    ).rejects.toThrow()
  })

  it("rejects a transport response for another request", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: () => ({ id: "other", result: [] }),
    })
    await expect(bridge.request({ method: "eth_accounts" })).rejects.toMatchObject({
      code: -32603,
    })
  })

  it("rejects non-JSON provider parameters before transport", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: () => ({ id: "unused", result: null }),
    })
    await expect(bridge.request({ method: "personal_sign", params: [1n] })).rejects.toThrow()
  })

  it("rejects excessively deep JSON-RPC parameters", async () => {
    const bridge = createProviderBridge({
      origin: "https://app.example",
      transport: () => ({ id: "unused", result: null }),
    })
    let nested: unknown = null
    for (let depth = 0; depth < 40; depth += 1) nested = [nested]
    await expect(bridge.request({ method: "eth_call", params: [nested] })).rejects.toMatchObject({
      code: -32602,
    })
  })
})

describe("EIP-1193 and EIP-6963", () => {
  it("implements the required EIP-1193 event API", () => {
    const controller = createEthereumProvider({
      origin: "https://app.example",
      transport: (request) => ({ id: request.id, result: null }),
    })
    const listener = vi.fn()
    expect(controller.provider.on("chainChanged", listener)).toBe(controller.provider)
    controller.emit("chainChanged", "0x1")
    expect(listener).toHaveBeenCalledWith("0x1")
    expect(controller.provider.removeListener("chainChanged", listener)).toBe(controller.provider)
    controller.emit("chainChanged", "0xa")
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("announces immutable provider details and re-announces on request", async () => {
    const provider = createProviderBridge({
      origin: "https://app.example",
      transport: (request) => ({ id: request.id, result: null }),
    })
    const detail = createEip6963ProviderDetail(
      {
        icon: "data:image/png;base64,AA==",
        name: "Cypheria",
        rdns: "io.cypheria.wallet",
        uuid: "350670db-19fa-4704-a166-e52e178b59d2",
      },
      provider
    )
    const target = new EventTarget()
    const announcements: Eip6963ProviderDetail[] = []
    target.addEventListener(EIP6963_ANNOUNCE_PROVIDER_EVENT, (event) => {
      announcements.push((event as CustomEvent<Eip6963ProviderDetail>).detail)
    })
    const { announceEip6963Provider } = await import("./index.js")
    const dispose = announceEip6963Provider(target as Window, detail)
    target.dispatchEvent(new Event(EIP6963_REQUEST_PROVIDER_EVENT))
    expect(announcements).toEqual([detail, detail])
    expect(Object.isFrozen(detail)).toBe(true)
    expect(Object.isFrozen(detail.info)).toBe(true)
    dispose()
    target.dispatchEvent(new Event(EIP6963_REQUEST_PROVIDER_EVENT))
    expect(announcements).toHaveLength(2)
  })

  it("rejects executable SVG provider icons", () => {
    const provider = createProviderBridge({
      origin: "https://app.example",
      transport: (request) => ({ id: request.id, result: null }),
    })
    expect(() =>
      createEip6963ProviderDetail(
        {
          icon: "data:image/svg+xml;base64,PHN2Zy8+",
          name: "Unsafe",
          rdns: "example.unsafe",
          uuid: "350670db-19fa-4704-a166-e52e178b59d2",
        },
        provider
      )
    ).toThrow(/PNG/u)
  })
})

describe("Solana Wallet Standard", () => {
  const publicKey = new Uint8Array(32)
  const account = {
    address: "11111111111111111111111111111111",
    chains: ["solana:mainnet" as const],
    features: [SolanaSignMessage] as const,
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  }
  const icon = "data:image/png;base64,AA==" as const

  it("connects, emits changes, and signs messages through canonical byte envelopes", async () => {
    const requests: SolanaProviderRequest[] = []
    const controller = createSolanaWallet({
      chains: ["solana:mainnet"],
      icon,
      name: "Cypheria",
      origin: "https://app.example/path",
      transport: (request) => {
        requests.push(request)
        if (request.method === StandardConnect) {
          return { id: request.id, result: { accounts: [account] } }
        }
        if (request.method === SolanaSignMessage) {
          return {
            id: request.id,
            result: request.input.map(({ message }) => ({
              signature:
                "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
              signatureType: "ed25519",
              signedMessage: message,
            })),
          }
        }
        return { id: request.id, result: null }
      },
    })
    const onChange = vi.fn()
    controller.wallet.features[StandardEvents].on("change", onChange)
    const connected = await controller.wallet.features[StandardConnect].connect()
    expect(connected.accounts[0]?.address).toBe(account.address)
    expect(onChange).toHaveBeenCalledWith({ accounts: controller.wallet.accounts })
    const connectedAccount = connected.accounts[0]
    if (!connectedAccount) throw new Error("Expected a connected Solana account.")

    const [signed] = await controller.wallet.features[SolanaSignMessage].signMessage({
      account: connectedAccount,
      message: new Uint8Array([1, 2, 3]),
    })
    expect(signed?.signedMessage).toEqual(new Uint8Array([1, 2, 3]))
    expect(signed?.signature).toEqual(new Uint8Array(64).fill(1))
    expect(requests[1]).toMatchObject({
      input: [{ message: "AQID" }],
      origin: "https://app.example",
      sessionKey: "cypheria:dapp:https://app.example",
    })
  })

  it("rejects accounts whose base58 address does not match the public key", () => {
    expect(() =>
      createSolanaWallet({
        accounts: [{ ...account, address: "22222222222222222222222222222222" }],
        chains: ["solana:mainnet"],
        icon,
        name: "Cypheria",
        origin: "https://app.example",
        transport: () => ({ id: "unused", result: null }),
      })
    ).toThrow(/public key/u)
    expect(publicKey).toHaveLength(32)
  })

  it("rejects empty serialized transactions at the IPC boundary", () => {
    expect(() =>
      solanaProviderRequestSchema.parse({
        id: "solana_empty_transaction",
        input: [
          {
            account: { ...account, features: [SolanaSignTransaction] },
            chain: "solana:mainnet",
            transaction: "",
          },
        ],
        method: SolanaSignTransaction,
        origin: "https://app.example",
        sessionKey: "cypheria:dapp:https://app.example",
      })
    ).toThrow(/empty/u)
  })

  it("registers the context-bridged wallet in the page main world", async () => {
    const controller = createSolanaWallet({
      chains: ["solana:mainnet"],
      icon,
      name: "Cypheria",
      origin: "https://app.example",
      transport: (request) => ({
        id: request.id,
        result: request.method === StandardConnect ? { accounts: [account] } : null,
      }),
    })
    const target = new EventTarget()
    let registered: CypheriaSolanaWallet | undefined
    target.addEventListener("wallet-standard:register-wallet", (event) => {
      const callback = (
        event as Event & {
          readonly detail: (api: { register(wallet: CypheriaSolanaWallet): () => void }) => void
        }
      ).detail
      callback({
        register: (wallet) => {
          registered = wallet
          return () => undefined
        },
      })
    })
    const names = ["addEventListener", "dispatchEvent", "cypheriaSolana"] as const
    const descriptors = Object.fromEntries(
      names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
    )
    try {
      Object.defineProperties(globalThis, {
        addEventListener: {
          configurable: true,
          value: target.addEventListener.bind(target),
        },
        cypheriaSolana: { configurable: true, value: controller.wallet },
        dispatchEvent: { configurable: true, value: target.dispatchEvent.bind(target) },
      })
      installSolanaWalletInMainWorld("cypheriaSolana")
      expect(registered?.name).toBe("Cypheria")
      const output = await registered?.features[StandardConnect].connect()
      expect(output?.accounts[0]?.address).toBe(account.address)
    } finally {
      for (const name of names) {
        const descriptor = descriptors[name]
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    }
  })
})
