import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { type AppMetadata, CYPHERIA_IPC_CHANNELS, type RuntimeInfo } from "@cypheria/ipc"
import { app, BrowserWindow, ipcMain } from "electron"
import { type DesktopRuntimeContext, initializeDesktopRuntime } from "./runtime.js"

let mainWindow: BrowserWindow | null = null

const currentDir = dirname(fileURLToPath(import.meta.url))
const preloadPath = join(currentDir, "../preload/index.cjs")

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

const toRuntimeInfo = (context: DesktopRuntimeContext): RuntimeInfo => ({
  codexHome: context.paths.codexHome,
  cypheriaHome: context.paths.cypheriaHome,
  directories: {
    automation: context.paths.automationDir,
    browser: context.paths.browserDir,
    cache: context.paths.cacheDir,
    config: context.paths.configDir,
    db: context.paths.dbDir,
    logs: context.paths.logsDir,
    vault: context.paths.vaultDir,
  },
})

const registerIpcHandlers = (context: DesktopRuntimeContext): void => {
  const appMetadata: AppMetadata = {
    name: app.getName(),
    version: app.getVersion(),
  }

  ipcMain.handle(CYPHERIA_IPC_CHANNELS.appMetadataRead, () => appMetadata)
  ipcMain.handle(CYPHERIA_IPC_CHANNELS.runtimeInfoRead, () => toRuntimeInfo(context))
}

const createMainWindow = async (context: DesktopRuntimeContext): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    backgroundColor: "#101113",
    height: 860,
    minHeight: 640,
    minWidth: 960,
    show: false,
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

  window.once("ready-to-show", () => {
    window.show()
  })

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null
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
      const context = await initializeDesktopRuntime()
      mainWindow = await createMainWindow(context)
    }
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })
}

const startDesktopApp = async (): Promise<void> => {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  registerLifecycleHandlers()

  await app.whenReady()
  const context = await initializeDesktopRuntime()
  registerIpcHandlers(context)
  mainWindow = await createMainWindow(context)
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
