import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type WalletProviderResponse,
  walletProviderResponseSchema,
} from "@cypheria/wallet-provider"
import { app, BrowserWindow } from "electron"
import {
  type AppHealthStatus,
  type AppMetadata,
  appHealthCheckContract,
  appMetadataReadContract,
  automationRunGetContract,
  automationRunListContract,
  automationRunStartContract,
  automationTaskCreateContract,
  automationTaskGetContract,
  automationTaskListContract,
  automationTaskPauseContract,
  automationTaskResumeContract,
  browserSessionOpenContract,
  dappProviderRequestContract,
  IPC_PROTOCOL_VERSION,
  type RuntimeInfo,
  runtimeInfoReadContract,
  settingsAppearanceFontsListContract,
  settingsAppearanceReadContract,
  settingsAppearanceWriteContract,
} from "../../ipc/src/index.js"
import { readAppearanceSettings, writeAppearanceSettings } from "./appearance-config.js"
import { resolveCodexCommand } from "./codex-command.js"
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
  registerIpcRoute(settingsAppearanceWriteContract, (settings) =>
    writeAppearanceSettings(context.paths.codexHome, settings)
  )
}

const createMainWindow = async (context: DesktopRuntimeContext): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    backgroundColor: "#f8f8f7",
    height: 860,
    minHeight: 640,
    minWidth: 960,
    show: false,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 18 },
        }
      : process.platform === "win32"
        ? {
            titleBarOverlay: {
              color: "#f3f3f1",
              symbolColor: "#575757",
            },
            titleBarStyle: "hidden" as const,
          }
        : {}),
    title: "Cypheria",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
    width: 1280,
  })

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
  } else {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildPlaceholderHtml(context))}`
    )
  }

  return window
}

const registerLifecycleHandlers = (): void => {
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
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  registerLifecycleHandlers()

  await app.whenReady()
  desktopRuntimeContext = await initializeDesktopRuntime({
    clientVersion: app.getVersion(),
    codexAppServer: {
      codexCommand: getCodexCommand(),
      windows: () => BrowserWindow.getAllWindows(),
    },
  })
  app.setPath("sessionData", desktopRuntimeContext.paths.browserDir)
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
