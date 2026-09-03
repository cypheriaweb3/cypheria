import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { buildRuntimePaths } from "@cypheria/runtime"
import {
  type WalletProviderResponse,
  walletProviderResponseSchema,
} from "@cypheria/wallet-provider"
import { app, BrowserWindow, Menu, nativeTheme, net, protocol, shell } from "electron"
import {
  type AppearanceSettings,
  type AppearanceSettingsWrite,
  type AppHealthStatus,
  type AppMetadata,
  appHealthCheckContract,
  appMetadataReadContract,
  approvalRequestDecideContract,
  approvalRequestsListContract,
  auditLogListContract,
  automationRunGetContract,
  automationRunListContract,
  automationRunStartContract,
  automationTaskCreateContract,
  automationTaskGetContract,
  automationTaskListContract,
  automationTaskPauseContract,
  automationTaskResumeContract,
  browserSessionOpenContract,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  codexAccountLoginCancelContract,
  codexAccountLoginStartContract,
  codexAccountLogoutContract,
  codexAccountReadContract,
  codexChatInterruptContract,
  codexChatStartContract,
  codexModelListContract,
  codexModelSettingsReadContract,
  codexModelSettingsWriteContract,
  codexThreadListContract,
  dappProviderRequestContract,
  IPC_PROTOCOL_VERSION,
  policyCreateContract,
  policyDisableContract,
  policyListContract,
  policyUpdateContract,
  type RuntimeInfo,
  runtimeInfoReadContract,
  settingsAppearanceFontsListContract,
  settingsAppearanceReadContract,
  settingsAppearanceWriteContract,
  walletActiveClearContract,
  walletActiveReadContract,
  walletActiveWriteContract,
  walletAddWatchContract,
  walletDeleteContract,
  walletGenerateHdContract,
  walletImportHdContract,
  walletImportPrivateKeyContract,
  walletListContract,
  walletLockContract,
  walletRenameContract,
  walletUnlockContract,
} from "../../ipc/src/index.js"
import { readAppearanceSettings, writeAppearanceSettings } from "./appearance-config.js"
import { resolveCodexCommand } from "./codex-command.js"
import {
  cancelCodexLogin,
  interruptCodexChat,
  listCodexModels,
  listCodexThreads,
  logoutCodexAccount,
  readCodexAccount,
  readCodexModelSettings,
  startCodexChat,
  startCodexLogin,
  writeCodexModelSettings,
} from "./codex-desktop.js"
import {
  createDappBrowserController,
  createElectronDappWebContentsFactory,
  type DappBrowserController,
} from "./dapp-browser.js"
import { registerIpcRoute } from "./ipc.js"
import {
  type DesktopRuntimeContext,
  initializeDesktopRuntime,
  shutdownDesktopRuntime,
} from "./runtime.js"
import { listSystemFonts } from "./system-fonts.js"

let mainWindow: BrowserWindow | null = null
let desktopRuntimeContext: DesktopRuntimeContext | null = null
let currentAppearanceSettings: AppearanceSettings | null = null

const getCodexCommand = (): string =>
  resolveCodexCommand({
    isPackaged: app.isPackaged,
    override: process.env.CYPHERIA_CODEX_PATH,
    resourcesPath: process.resourcesPath,
  })
let dappBrowserController: DappBrowserController | null = null

const currentDir = dirname(fileURLToPath(import.meta.url))
const preloadPath = join(currentDir, "../preload/index.cjs")
const dappPreloadPath = join(currentDir, "../dapp-preload/index.cjs")
const rendererShellPath = join(currentDir, "../client/_shell.html")
const rendererClientDir = dirname(rendererShellPath)

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
    scheme: "cypheria",
  },
])

const logFatalError = (error: unknown): void => {
  console.error("[cypheria:desktop] fatal error", error)
}

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const buildPlaceholderHtml = (context: DesktopRuntimeContext): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cypheria</title>
    <style>
      :root {
        color-scheme: dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #101113;
        color: #ececec;
      }

      body {
        align-items: center;
        display: grid;
        min-height: 100vh;
        margin: 0;
        place-items: center;
      }

      main {
        display: grid;
        gap: 10px;
        max-width: 620px;
        padding: 24px;
      }

      h1 {
        font-size: 28px;
        font-weight: 650;
        letter-spacing: 0;
        margin: 0;
      }

      p {
        color: #b8b8b8;
        line-height: 1.6;
        margin: 0;
      }

      code {
        color: #d7e6ff;
        font-family: "SFMono-Regular", Consolas, monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Cypheria</h1>
      <p>Desktop runtime initialized.</p>
      <p>Cypheria home: <code>${escapeHtml(context.paths.cypheriaHome)}</code></p>
      <p>Codex home: <code>${escapeHtml(context.paths.codexHome)}</code></p>
    </main>
  </body>
</html>`

const getRendererUrl = (): string | undefined => {
  const rendererUrl = process.env.CYPHERIA_RENDERER_URL?.trim()
  return rendererUrl ? rendererUrl : undefined
}

const registerRendererProtocol = (): void => {
  protocol.handle("cypheria", (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const requestedPath = pathname === "/" ? "_shell.html" : pathname.replace(/^\/+/, "")
    const candidate = resolve(rendererClientDir, requestedPath)
    const isWithinRenderer = !relative(rendererClientDir, candidate).startsWith("..")
    const target = isWithinRenderer && existsSync(candidate) ? candidate : rendererShellPath
    return net.fetch(pathToFileURL(target).toString())
  })
}

const toRuntimeInfo = async (context: DesktopRuntimeContext): Promise<RuntimeInfo> => {
  const info = await context.runtime.request("runtime.info")
  const runtimeInfo = info as RuntimeInfo

  return {
    codex: context.codexAppServer
      ? {
          listenUrl: context.codexAppServer.listenUrl,
          state: context.codexAppServer.state,
        }
      : undefined,
    codexHome: runtimeInfo.codexHome,
    cypheriaHome: runtimeInfo.cypheriaHome,
    directories: runtimeInfo.directories,
  }
}

const registerIpcHandlers = (context: DesktopRuntimeContext): void => {
  const appMetadata: AppMetadata = {
    name: app.getName(),
    version: app.getVersion(),
  }

  registerIpcRoute(appHealthCheckContract, (): AppHealthStatus => {
    return {
      checkedAt: new Date().toISOString(),
      protocolVersion: IPC_PROTOCOL_VERSION,
      status: "ok",
    }
  })
  registerIpcRoute(appMetadataReadContract, () => appMetadata)
  registerIpcRoute(auditLogListContract, ({ limit }) => context.audit.list({ limit }))
  registerIpcRoute(approvalRequestsListContract, ({ status }) =>
    context.signingIntents.listApprovals(status)
  )
  registerIpcRoute(
    approvalRequestDecideContract,
    ({ approvalId, decision, expectedRevision, reviewer }) =>
      context.signingIntents.decide(approvalId, { decision, expectedRevision, reviewer })
  )
  registerIpcRoute(walletListContract, () => context.wallets.listWallets())
  registerIpcRoute(walletActiveReadContract, () => context.wallets.getActiveContext())
  registerIpcRoute(walletActiveWriteContract, (input) => context.wallets.setActiveContext(input))
  registerIpcRoute(walletActiveClearContract, async () => {
    await context.wallets.clearActiveContext()
    return { cleared: true }
  })
  registerIpcRoute(walletGenerateHdContract, (input) => context.wallets.generateHdWallet(input))
  registerIpcRoute(walletImportHdContract, (input) => context.wallets.importHdWallet(input))
  registerIpcRoute(walletImportPrivateKeyContract, (input) =>
    context.wallets.importPrivateKeyWallet(input)
  )
  registerIpcRoute(walletAddWatchContract, (input) => context.wallets.addWatchWallet(input))
  registerIpcRoute(walletRenameContract, ({ name, walletId }) =>
    context.wallets.renameWallet(walletId, name)
  )
  registerIpcRoute(walletDeleteContract, async ({ walletId }) => {
    await context.wallets.deleteWallet(walletId)
    return { deleted: true }
  })
  registerIpcRoute(walletLockContract, async ({ walletId }) => {
    const wallet = await context.wallets.getWallet(walletId)
    if (!wallet || !("vaultId" in wallet.wallet))
      throw new Error("The wallet does not have a local vault.")
    context.vault.lock(wallet.wallet.vaultId)
    return { unlocked: false, walletId }
  })
  registerIpcRoute(walletUnlockContract, async ({ walletId }) => {
    const wallet = await context.wallets.getWallet(walletId)
    if (!wallet || !("vaultId" in wallet.wallet))
      throw new Error("The wallet does not have a local vault.")
    await context.vault.unlock(wallet.wallet.vaultId)
    return { unlocked: true, walletId }
  })
  registerIpcRoute(policyListContract, (input) => context.policies.list(input))
  registerIpcRoute(policyCreateContract, (input) => context.policies.create(input))
  registerIpcRoute(policyUpdateContract, ({ policyId, ...input }) =>
    context.policies.update(policyId, input)
  )
  registerIpcRoute(policyDisableContract, ({ expectedRevision, policyId }) =>
    context.policies.disable(policyId, expectedRevision)
  )
  const codexBridge = () => {
    const bridge = context.codexAppServer?.bridge
    if (!bridge) throw new Error("Codex App Server is unavailable.")
    return bridge
  }
  registerIpcRoute(codexAccountReadContract, () => readCodexAccount(codexBridge()))
  registerIpcRoute(codexAccountLoginStartContract, async (request) => {
    const result = await startCodexLogin(codexBridge(), request)
    const loginUrl =
      result.type === "chatgpt"
        ? result.authUrl
        : result.type === "chatgptDeviceCode"
          ? result.verificationUrl
          : undefined
    if (loginUrl) await shell.openExternal(loginUrl)
    return result
  })
  registerIpcRoute(codexAccountLoginCancelContract, async ({ loginId }) => ({
    cancelled: await cancelCodexLogin(codexBridge(), loginId),
  }))
  registerIpcRoute(codexAccountLogoutContract, async () => {
    await logoutCodexAccount(codexBridge())
    return { loggedOut: true }
  })
  registerIpcRoute(codexModelListContract, ({ includeHidden }) =>
    listCodexModels(codexBridge(), includeHidden)
  )
  registerIpcRoute(codexModelSettingsReadContract, () => readCodexModelSettings(codexBridge()))
  registerIpcRoute(codexModelSettingsWriteContract, (settings) =>
    writeCodexModelSettings(codexBridge(), settings)
  )
  registerIpcRoute(codexThreadListContract, (options) => listCodexThreads(codexBridge(), options))
  registerIpcRoute(codexChatStartContract, (request, event) => ({
    requestId: startCodexChat(codexBridge(), event.sender, request),
  }))
  registerIpcRoute(codexChatInterruptContract, async ({ requestId }) => ({
    interrupted: await interruptCodexChat(requestId),
  }))
  registerIpcRoute(automationTaskCreateContract, (input) => context.automation.createTask(input))
  registerIpcRoute(automationTaskListContract, ({ status }) => context.automation.listTasks(status))
  registerIpcRoute(automationTaskGetContract, ({ taskId }) => context.automation.getTask(taskId))
  registerIpcRoute(automationTaskPauseContract, ({ expectedRevision, taskId }) =>
    context.automation.pauseTask(taskId, expectedRevision)
  )
  registerIpcRoute(automationTaskResumeContract, ({ expectedRevision, taskId }) =>
    context.automation.resumeTask(taskId, expectedRevision)
  )
  registerIpcRoute(automationRunStartContract, ({ taskId }) => context.automation.runTask(taskId))
  registerIpcRoute(automationRunGetContract, ({ runId }) => context.automation.getRun(runId))
  registerIpcRoute(automationRunListContract, ({ taskId }) => context.automation.listRuns(taskId))
  registerIpcRoute(browserSessionOpenContract, ({ url }) => {
    if (!dappBrowserController) throw new Error("The dApp browser is unavailable.")
    return dappBrowserController.open(url)
  })
  registerIpcRoute(dappProviderRequestContract, async (request, event) => {
    if (!dappBrowserController) throw new Error("The dApp browser is unavailable.")
    return dappBrowserController.routeProviderRequest(
      event.sender.id,
      event.sender.getURL(),
      request
    )
  })
  registerIpcRoute(runtimeInfoReadContract, () => toRuntimeInfo(context))
  registerIpcRoute(settingsAppearanceReadContract, () =>
    readAppearanceSettings(context.paths.codexHome)
  )
  registerIpcRoute(settingsAppearanceFontsListContract, () => listSystemFonts())
  registerIpcRoute(settingsAppearanceWriteContract, async (settings) => {
    const savedSettings = await writeAppearanceSettings(context.paths.codexHome, settings)
    currentAppearanceSettings = savedSettings
    applyNativeAppearance(mainWindow, savedSettings)
    return savedSettings
  })
}

const toAppearanceBootstrap = (settings: AppearanceSettings): AppearanceSettingsWrite => {
  const { configPath: _, ...appearance } = settings
  return appearance
}

const resolveNativeThemeMode = (settings: AppearanceSettings): "dark" | "light" => {
  if (settings.theme !== "system") {
    return settings.theme
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

const getActiveChromeTheme = (settings: AppearanceSettings) =>
  resolveNativeThemeMode(settings) === "dark" ? settings.darkTheme : settings.lightTheme

const applyNativeAppearance = (
  window: BrowserWindow | null,
  settings: AppearanceSettings
): void => {
  nativeTheme.themeSource = settings.theme
  if (!window || window.isDestroyed()) {
    return
  }

  const activeTheme = getActiveChromeTheme(settings)
  window.setBackgroundColor(activeTheme.surface)
  if (process.platform === "win32") {
    window.setTitleBarOverlay({ color: activeTheme.surface, symbolColor: activeTheme.ink })
  }
}

const refreshNativeWindowChrome = (): void => {
  if (!currentAppearanceSettings || !mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const activeTheme = getActiveChromeTheme(currentAppearanceSettings)
  mainWindow.setBackgroundColor(activeTheme.surface)
  if (process.platform === "win32") {
    mainWindow.setTitleBarOverlay({ color: activeTheme.surface, symbolColor: activeTheme.ink })
  }
}

const registerDeveloperContextMenu = (window: BrowserWindow): void => {
  if (app.isPackaged) {
    return
  }

  window.webContents.on("context-menu", (_event, params) => {
    const inspectElement = (): void => {
      if (!window.isDestroyed()) {
        window.webContents.inspectElement(params.x, params.y)
      }
    }

    Menu.buildFromTemplate([
      {
        click: () => {
          if (window.webContents.isDevToolsOpened()) {
            inspectElement()
            return
          }

          window.webContents.once("devtools-opened", inspectElement)
          window.webContents.openDevTools({ activate: true, mode: "detach" })
        },
        label: "Inspect",
      },
    ]).popup({ window })
  })
}

const createMainWindow = async (context: DesktopRuntimeContext): Promise<BrowserWindow> => {
  const appearance = await readAppearanceSettings(context.paths.codexHome)
  currentAppearanceSettings = appearance
  nativeTheme.themeSource = appearance.theme
  const activeTheme = getActiveChromeTheme(appearance)
  const appearanceArgument = `${CYPHERIA_APPEARANCE_ARGUMENT_PREFIX}${encodeURIComponent(
    JSON.stringify(toAppearanceBootstrap(appearance))
  )}`
  const window = new BrowserWindow({
    backgroundColor: activeTheme.surface,
    ...(process.platform === "linux"
      ? { darkTheme: resolveNativeThemeMode(appearance) === "dark" }
      : {}),
    height: 860,
    minHeight: 640,
    minWidth: 960,
    show: false,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 15 },
        }
      : process.platform === "win32"
        ? {
            titleBarOverlay: {
              color: activeTheme.surface,
              symbolColor: activeTheme.ink,
            },
            titleBarStyle: "hidden" as const,
          }
        : {}),
    title: "Cypheria",
    webPreferences: {
      additionalArguments: [appearanceArgument],
      contextIsolation: true,
      defaultFontSize: appearance.uiFontSize,
      defaultMonospaceFontSize: appearance.codeFontSize,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
    width: 1280,
  })

  registerDeveloperContextMenu(window)

  dappBrowserController = createDappBrowserController({
    createWebContents: createElectronDappWebContentsFactory(window),
    preloadPath: dappPreloadPath,
    requestRuntime: async (request) => {
      try {
        const runtimeMethod =
          request.method.startsWith("solana:") || request.method.startsWith("standard:")
            ? "dapp.solana-provider-request"
            : "dapp.provider-request"
        return walletProviderResponseSchema.parse(
          await context.runtime.request(runtimeMethod, request)
        ) as WalletProviderResponse
      } catch {
        return {
          error: { code: 4900, message: "The wallet provider runtime is unavailable." },
          id: request.id,
        }
      }
    },
    sessions: context.dappSessions,
  })

  window.once("ready-to-show", () => {
    window.show()
  })

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null
      dappBrowserController = null
    }
  })

  const rendererUrl = getRendererUrl()
  if (rendererUrl) {
    await window.loadURL(rendererUrl)
  } else if (existsSync(rendererShellPath)) {
    await window.loadURL("cypheria://app/")
  } else {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildPlaceholderHtml(context))}`
    )
  }

  if (!window.isVisible()) {
    window.show()
  }

  return window
}

const registerLifecycleHandlers = (): void => {
  nativeTheme.on("updated", refreshNativeWindowChrome)

  app.on("second-instance", () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
  })

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      desktopRuntimeContext ??= await initializeDesktopRuntime({
        clientVersion: app.getVersion(),
        codexAppServer: {
          codexCommand: getCodexCommand(),
          windows: () => BrowserWindow.getAllWindows(),
        },
      })
      mainWindow = await createMainWindow(desktopRuntimeContext)
    }
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.on("before-quit", () => {
    if (!desktopRuntimeContext) {
      return
    }

    void shutdownDesktopRuntime(desktopRuntimeContext).catch(logFatalError)
  })
}

const startDesktopApp = async (): Promise<void> => {
  const runtimePaths = buildRuntimePaths()
  await mkdir(runtimePaths.browserDir, { recursive: true })
  app.setPath("userData", runtimePaths.browserDir)

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  registerLifecycleHandlers()

  await app.whenReady()
  registerRendererProtocol()
  desktopRuntimeContext = await initializeDesktopRuntime({
    clientVersion: app.getVersion(),
    codexAppServer: {
      codexCommand: getCodexCommand(),
      windows: () => BrowserWindow.getAllWindows(),
    },
  })
  registerIpcHandlers(desktopRuntimeContext)
  mainWindow = await createMainWindow(desktopRuntimeContext)
}

process.on("uncaughtException", logFatalError)
process.on("unhandledRejection", logFatalError)

void startDesktopApp().catch((error: unknown) => {
  logFatalError(error)
  if (app.isReady()) {
    app.quit()
  } else {
    app.exit(1)
  }
})
