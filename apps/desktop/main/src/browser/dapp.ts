import { evmChainIdentityFromHex, evmChainIdentityToHex } from "@cypheria/web3/network"
import type {
  DappSession,
  WalletProviderEvent,
  WalletProviderRequest,
  WalletProviderResponse,
} from "@cypheria/web3/provider"
import {
  createDappSessionKey,
  normalizeDappOrigin,
  walletProviderEventSchema,
  walletProviderRequestSchema,
} from "@cypheria/web3/provider"

import { CYPHERIA_IPC_CHANNELS } from "../../../ipc/src/index.js"

/** A dApp tab guest as seen by the provider controller. */
export type DappGuest = {
  readonly id: number
  getURL(): string
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export type DappProviderControllerOptions = {
  readonly findGuest: (webContentsId: number) => DappGuest | null
  readonly openSession: (origin: string) => Promise<DappSession>
  readonly requestRuntime: (request: WalletProviderRequest) => Promise<WalletProviderResponse>
}

/** The frame that sent a provider request, captured from the IPC event before any await. */
export type DappRequestSender = {
  readonly frameOrigin: string
  readonly isMainFrame: boolean
  readonly webContentsId: number
}

export class DappBrowserError extends Error {
  readonly code: "DAPP_SCOPE_MISMATCH" | "DAPP_VIEW_NOT_FOUND"

  constructor(code: DappBrowserError["code"], message: string) {
    super(message)
    this.name = "DappBrowserError"
    this.code = code
  }
}

const originOf = (value: string): string | null => {
  try {
    return normalizeDappOrigin(value)
  } catch {
    return null
  }
}

/**
 * Routes wallet provider requests from dApp tabs. All dApp tabs share one browser profile, so the
 * permission scope is derived from the sending frame's origin on every request rather than from
 * the tab. A session is opened on the Server the first time an origin uses the provider.
 */
export class DappProviderController {
  readonly #guests = new Set<number>()
  readonly #options: DappProviderControllerOptions
  readonly #sessions = new Map<string, Promise<DappSession>>()

  constructor(options: DappProviderControllerOptions) {
    this.#options = options
  }

  registerGuest(webContentsId: number): void {
    this.#guests.add(webContentsId)
  }

  unregisterGuest(webContentsId: number): void {
    this.#guests.delete(webContentsId)
  }

  isGuest(webContentsId: number): boolean {
    return this.#guests.has(webContentsId)
  }

  async routeProviderRequest(
    sender: DappRequestSender,
    requestValue: unknown
  ): Promise<WalletProviderResponse> {
    const guest = this.#guests.has(sender.webContentsId)
      ? this.#options.findGuest(sender.webContentsId)
      : null
    if (!guest || guest.isDestroyed()) {
      throw new DappBrowserError("DAPP_VIEW_NOT_FOUND", "The dApp tab is not registered.")
    }
    const request = walletProviderRequestSchema.parse(requestValue) as WalletProviderRequest
    const origin = originOf(sender.frameOrigin)
    if (
      !sender.isMainFrame ||
      !origin ||
      originOf(guest.getURL()) !== origin ||
      request.origin !== origin ||
      request.sessionKey !== createDappSessionKey(origin)
    ) {
      throw new DappBrowserError(
        "DAPP_SCOPE_MISMATCH",
        "The provider request does not match the dApp page that sent it."
      )
    }
    const session = await this.#session(origin)
    const response = await this.#options.requestRuntime(request)
    if (!("error" in response)) this.#emitFollowUpEvents(session, request, response)
    return response
  }

  /** Sends an event to every dApp tab currently showing the event's origin. */
  emitProviderEvent(eventValue: unknown): void {
    const event = walletProviderEventSchema.parse(eventValue) as WalletProviderEvent
    if (event.sessionKey !== createDappSessionKey(event.origin)) {
      throw new DappBrowserError("DAPP_SCOPE_MISMATCH", "The provider event scope is invalid.")
    }
    for (const webContentsId of this.#guests) {
      const guest = this.#options.findGuest(webContentsId)
      if (!guest || guest.isDestroyed()) {
        this.#guests.delete(webContentsId)
        continue
      }
      if (originOf(guest.getURL()) === event.origin) {
        guest.send(CYPHERIA_IPC_CHANNELS.dappProviderEvent, event)
      }
    }
  }

  #session(origin: string): Promise<DappSession> {
    const existing = this.#sessions.get(origin)
    if (existing) return existing
    const opened = this.#options.openSession(origin)
    this.#sessions.set(origin, opened)
    opened.catch(() => {
      if (this.#sessions.get(origin) === opened) this.#sessions.delete(origin)
    })
    return opened
  }

  #emitFollowUpEvents(
    session: DappSession,
    request: WalletProviderRequest,
    response: WalletProviderResponse
  ): void {
    const scope = { origin: session.origin, sessionKey: session.key }
    const result = (response as { result?: unknown }).result
    if (
      (request.method === "eth_accounts" || request.method === "eth_requestAccounts") &&
      Array.isArray(result)
    ) {
      this.emitProviderEvent({ ...scope, event: "ethereum.accountsChanged", payload: result })
    } else if (request.method === "wallet_switchEthereumChain") {
      const chainId = Array.isArray(request.params)
        ? (request.params[0] as { readonly chainId?: unknown } | undefined)?.chainId
        : undefined
      if (typeof chainId === "string") {
        this.emitProviderEvent({
          ...scope,
          event: "ethereum.chainChanged",
          payload: evmChainIdentityToHex(evmChainIdentityFromHex(chainId)),
        })
      }
    } else if (request.method === "standard:connect") {
      const accounts =
        result &&
        typeof result === "object" &&
        "accounts" in result &&
        Array.isArray(result.accounts)
          ? result.accounts
          : []
      this.emitProviderEvent({ ...scope, event: "solana.accountsChanged", payload: accounts })
    } else if (request.method === "standard:disconnect") {
      this.emitProviderEvent({ ...scope, event: "solana.accountsChanged", payload: [] })
    }
  }
}
