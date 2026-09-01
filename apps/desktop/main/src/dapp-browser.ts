import type { DappSessionManager, ProviderRequest, ProviderResponse } from "@cypheria/web3-browser"
import { normalizeDappOrigin, providerRequestSchema } from "@cypheria/web3-browser"
import { type BrowserWindow, session, WebContentsView } from "electron"

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
  readonly requestRuntime: (request: ProviderRequest) => Promise<ProviderResponse>
  readonly sessions: Pick<DappSessionManager, "open">
}

export type DappBrowserController = {
  readonly close: (webContentsId: number) => boolean
  readonly open: (url: string) => Promise<{
    readonly session: Awaited<ReturnType<DappSessionManager["open"]>>
    readonly webContentsId: number
  }>
  readonly routeProviderRequest: (
    webContentsId: number,
    senderUrl: string,
    request: unknown
  ) => Promise<ProviderResponse>
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
    routeProviderRequest: async (webContentsId, senderUrl, requestValue) => {
      const registered = views.get(webContentsId)
      if (!registered) {
        throw new DappBrowserError("DAPP_VIEW_NOT_FOUND", "The dApp view is not registered.")
      }
      const request = providerRequestSchema.parse(requestValue) as ProviderRequest
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
      return options.requestRuntime(request)
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
    }
  }
