import type {
  DappSessionManager,
  WalletProviderEvent,
  WalletProviderRequest,
  WalletProviderResponse,
} from "@cypheria/wallet-provider"
import {
  normalizeDappOrigin,
  walletProviderEventSchema,
  walletProviderRequestSchema,
} from "@cypheria/wallet-provider"
import { type BrowserWindow, session, WebContentsView } from "electron"
import { CYPHERIA_IPC_CHANNELS } from "../../ipc/src/index.js"

export const DAPP_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
} as const

export type DappWebContents = {
  readonly destroy: () => void
  readonly getUrl: () => string
  readonly id: number
  readonly send: (channel: string, payload: unknown) => void
}

export type DappWebContentsFactory = (input: {
  readonly partition: string
  readonly preloadPath: string
  readonly url: string
  readonly webPreferences: typeof DAPP_WEB_PREFERENCES
}) => Promise<DappWebContents>

export type DappBrowserControllerOptions = {
  readonly createWebContents: DappWebContentsFactory
  readonly preloadPath: string
  readonly requestRuntime: (request: WalletProviderRequest) => Promise<WalletProviderResponse>
  readonly sessions: Pick<DappSessionManager, "open">
}

export type DappBrowserController = {
  readonly close: (webContentsId: number) => boolean
  readonly open: (url: string) => Promise<{
    readonly session: Awaited<ReturnType<DappSessionManager["open"]>>
    readonly webContentsId: number
  }>
  readonly emitProviderEvent: (webContentsId: number, event: unknown) => void
  readonly routeProviderRequest: (
    webContentsId: number,
    senderUrl: string,
    request: unknown
  ) => Promise<WalletProviderResponse>
}

export class DappBrowserError extends Error {
  readonly code: "DAPP_SCOPE_MISMATCH" | "DAPP_VIEW_NOT_FOUND"

  constructor(code: DappBrowserError["code"], message: string) {
    super(message)
    this.name = "DappBrowserError"
    this.code = code
  }
}

export const createDappBrowserController = (
  options: DappBrowserControllerOptions
): DappBrowserController => {
  const views = new Map<
    number,
    { readonly origin: string; readonly sessionKey: string; readonly view: DappWebContents }
  >()
  const emitProviderEvent = (webContentsId: number, eventValue: unknown): void => {
    const registered = views.get(webContentsId)
    if (!registered) {
      throw new DappBrowserError("DAPP_VIEW_NOT_FOUND", "The dApp view is not registered.")
    }
    const event = walletProviderEventSchema.parse(eventValue) as WalletProviderEvent
    if (event.origin !== registered.origin || event.sessionKey !== registered.sessionKey) {
      throw new DappBrowserError(
        "DAPP_SCOPE_MISMATCH",
        "The provider event does not match its isolated dApp session."
      )
    }
    registered.view.send(CYPHERIA_IPC_CHANNELS.dappProviderEvent, event)
  }
  return {
    close: (webContentsId) => {
      const registered = views.get(webContentsId)
      if (!registered) return false
      registered.view.destroy()
      views.delete(webContentsId)
      return true
    },
    open: async (url) => {
      const dappSession = await options.sessions.open(url)
      const view = await options.createWebContents({
        partition: dappSession.partition,
        preloadPath: options.preloadPath,
        url,
        webPreferences: DAPP_WEB_PREFERENCES,
      })
      views.set(view.id, {
        origin: dappSession.origin,
        sessionKey: dappSession.key,
        view,
      })
      return { session: dappSession, webContentsId: view.id }
    },
    emitProviderEvent,
    routeProviderRequest: async (webContentsId, senderUrl, requestValue) => {
      const registered = views.get(webContentsId)
      if (!registered) {
        throw new DappBrowserError("DAPP_VIEW_NOT_FOUND", "The dApp view is not registered.")
      }
      const request = walletProviderRequestSchema.parse(requestValue) as WalletProviderRequest
      if (
        normalizeDappOrigin(senderUrl) !== registered.origin ||
        normalizeDappOrigin(registered.view.getUrl()) !== registered.origin ||
        request.origin !== registered.origin ||
        request.sessionKey !== registered.sessionKey
      ) {
        throw new DappBrowserError(
          "DAPP_SCOPE_MISMATCH",
          "The provider request sender does not match its isolated dApp session."
        )
      }
      const response = await options.requestRuntime(request)
      if (!("error" in response)) {
        const scope = { origin: registered.origin, sessionKey: registered.sessionKey }
        if (
          (request.method === "eth_accounts" || request.method === "eth_requestAccounts") &&
          Array.isArray(response.result)
        ) {
          emitProviderEvent(webContentsId, {
            ...scope,
            event: "ethereum.accountsChanged",
            payload: response.result,
          })
        } else if (request.method === "wallet_switchEthereumChain") {
          const chainId = Array.isArray(request.params)
            ? (request.params[0] as { readonly chainId?: unknown } | undefined)?.chainId
            : undefined
          if (typeof chainId === "string") {
            emitProviderEvent(webContentsId, {
              ...scope,
              event: "ethereum.chainChanged",
              payload: chainId,
            })
          }
        } else if (request.method === "standard:connect") {
          const accounts =
            response.result &&
            typeof response.result === "object" &&
            "accounts" in response.result &&
            Array.isArray(response.result.accounts)
              ? response.result.accounts
              : []
          emitProviderEvent(webContentsId, {
            ...scope,
            event: "solana.accountsChanged",
            payload: accounts,
          })
        } else if (request.method === "standard:disconnect") {
          emitProviderEvent(webContentsId, {
            ...scope,
            event: "solana.accountsChanged",
            payload: [],
          })
        }
      }
      return response
    },
  }
}

export const createElectronDappWebContentsFactory =
  (window: BrowserWindow): DappWebContentsFactory =>
  async ({ partition, preloadPath, url, webPreferences }) => {
    const isolatedSession = session.fromPartition(partition, { cache: true })
    isolatedSession.setPermissionCheckHandler(() => false)
    isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    const view = new WebContentsView({
      webPreferences: { ...webPreferences, preload: preloadPath, session: isolatedSession },
    })
    const origin = normalizeDappOrigin(url)
    const keepOriginScoped = (event: Electron.Event, targetUrl: string): void => {
      try {
        if (normalizeDappOrigin(targetUrl) === origin) return
      } catch {
        // Invalid or non-web URLs are blocked below.
      }
      event.preventDefault()
    }
    view.webContents.on("will-navigate", keepOriginScoped)
    view.webContents.on("will-redirect", keepOriginScoped)
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    const resize = (): void => {
      const { height, width } = window.getContentBounds()
      view.setBounds({ height, width, x: 0, y: 0 })
    }
    window.contentView.addChildView(view)
    resize()
    window.on("resize", resize)
    await view.webContents.loadURL(url)
    return {
      destroy: () => {
        window.off("resize", resize)
        window.contentView.removeChildView(view)
        view.webContents.close()
      },
      getUrl: () => view.webContents.getURL(),
      id: view.webContents.id,
      send: (channel, payload) => view.webContents.send(channel, payload),
    }
  }
