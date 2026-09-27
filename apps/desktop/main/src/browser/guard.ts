// Webview hardening and window-open routing adapted from Paseo (Apache-2.0),
// https://github.com/getpaseo/paseo, packages/desktop/src/main.ts.
import { type BrowserWindow, clipboard, Menu, type MenuItemConstructorOptions } from "electron"

import { CYPHERIA_BROWSER_CHANNELS } from "../../../ipc/src/browser-channels.js"
import { kindForPartition } from "./profile.js"
import {
  getBrowserIdForWebContents,
  prepareBrowserWebContents,
  registerBrowserNavigationGuards,
} from "./webviews.js"
import {
  decideBrowserWindowOpenRequest,
  isAllowedBrowserWebviewUrl,
  PendingBrowserWindowOpenRequests,
} from "./window-open.js"

export type BrowserGuardOptions = {
  readonly browserPreloadPath: string
  readonly dappPreloadPath: string
  readonly developerTools: boolean
  readonly onGuestAttached?: (contents: Electron.WebContents) => void
}

export const pendingBrowserWindowOpenRequests = new PendingBrowserWindowOpenRequests()

const popupWindowOptions = (
  window: BrowserWindow,
  session: Electron.Session
): Electron.BrowserWindowConstructorOptions => ({
  autoHideMenuBar: true,
  parent: window,
  show: true,
  webPreferences: {
    allowRunningInsecureContent: false,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    session,
    webSecurity: true,
    webviewTag: false,
  },
})

const showContextMenu = (
  window: BrowserWindow,
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
  developerTools: boolean,
  openInNewTab: (url: string) => void
): void => {
  const items: MenuItemConstructorOptions[] = []
  if (params.linkURL && isAllowedBrowserWebviewUrl(params.linkURL)) {
    items.push(
      { click: () => openInNewTab(params.linkURL), label: "Open Link in New Tab" },
      { click: () => clipboard.writeText(params.linkURL), label: "Copy Link Address" },
      { type: "separator" }
    )
  }
  if (params.isEditable) {
    items.push(
      { enabled: params.editFlags.canUndo, role: "undo" },
      { enabled: params.editFlags.canRedo, role: "redo" },
      { type: "separator" },
      { enabled: params.editFlags.canCut, role: "cut" },
      { enabled: params.editFlags.canCopy, role: "copy" },
      { enabled: params.editFlags.canPaste, role: "paste" },
      { enabled: params.editFlags.canSelectAll, role: "selectAll" }
    )
  } else if (params.selectionText) {
    items.push({ enabled: params.editFlags.canCopy, role: "copy" })
  } else {
    items.push(
      {
        click: () => contents.navigationHistory.goBack(),
        enabled: contents.navigationHistory.canGoBack(),
        label: "Back",
      },
      {
        click: () => contents.navigationHistory.goForward(),
        enabled: contents.navigationHistory.canGoForward(),
        label: "Forward",
      },
      { click: () => contents.reload(), label: "Reload" }
    )
  }
  if (developerTools) {
    items.push(
      { type: "separator" },
      {
        click: () => {
          contents.openDevTools({ mode: "detach" })
          contents.inspectElement(params.x, params.y)
        },
        label: "Inspect Element",
      }
    )
  }
  Menu.buildFromTemplate(items).popup({ window })
}

const installWindowOpenHandler = (input: {
  contents: Electron.WebContents
  sourceContents: Electron.WebContents
  window: BrowserWindow
  developerTools: boolean
}): void => {
  const { contents, developerTools, sourceContents, window } = input
  const requestTab = (url: string) => {
    const sourceBrowserId = getBrowserIdForWebContents(sourceContents)
    if (sourceBrowserId) {
      window.webContents.send(CYPHERIA_BROWSER_CHANNELS.newTabRequested, { sourceBrowserId, url })
    } else {
      pendingBrowserWindowOpenRequests.add(sourceContents.id, url)
    }
  }
  contents.setWindowOpenHandler(({ url, disposition, frameName, features, postBody }) => {
    const decision = decideBrowserWindowOpenRequest({
      disposition,
      features,
      frameName,
      hasPostBody: postBody !== undefined && postBody !== null,
      url,
    })
    if (decision.kind === "deny") return { action: "deny" }
    // Popups keep window.opener for OAuth and payment flows. They share the tab's profile but
    // never receive a preload, so a popup page cannot reach the wallet provider.
    if (decision.kind === "popup") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: popupWindowOptions(window, contents.session),
      }
    }
    requestTab(decision.url)
    return { action: "deny" }
  })
  contents.on("did-create-window", (popup) => {
    const popupContents = popup.webContents
    registerBrowserNavigationGuards(popupContents)
    popupContents.on("context-menu", (_event, params) =>
      showContextMenu(popup, popupContents, params, developerTools, requestTab)
    )
    installWindowOpenHandler({ contents: popupContents, developerTools, sourceContents, window })
  })
  contents.on("context-menu", (_event, params) =>
    showContextMenu(window, contents, params, developerTools, requestTab)
  )
}

/**
 * Makes `<webview>` safe to use in the main window renderer. Only the two Cypheria browser
 * partitions may attach; every guest is sandboxed and receives a preload chosen here, never one
 * supplied by the renderer.
 */
export const installBrowserGuards = (window: BrowserWindow, options: BrowserGuardOptions): void => {
  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    const kind = kindForPartition(params.partition)
    if (!kind || !isAllowedBrowserWebviewUrl(params.src)) {
      event.preventDefault()
      return
    }
    webPreferences.nodeIntegration = false
    // The sandboxed keyboard preload must run in every frame so focused iframes keep the same
    // page-first shortcut boundary. Node integration remains disabled.
    webPreferences.nodeIntegrationInSubFrames = true
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.webviewTag = false
    webPreferences.allowRunningInsecureContent = false
    delete webPreferences.preload
    delete (params as { preload?: string }).preload
    delete (webPreferences as { preloadURL?: string }).preloadURL
    delete (params as { preloadURL?: string }).preloadURL
    webPreferences.preload = kind === "dapp" ? options.dappPreloadPath : options.browserPreloadPath
  })
  window.webContents.on("did-attach-webview", (_event, contents) => {
    prepareBrowserWebContents(contents)
    contents.once("destroyed", () => pendingBrowserWindowOpenRequests.delete(contents.id))
    registerBrowserNavigationGuards(contents)
    installWindowOpenHandler({
      contents,
      developerTools: options.developerTools,
      sourceContents: contents,
      window,
    })
    options.onGuestAttached?.(contents)
  })
}
