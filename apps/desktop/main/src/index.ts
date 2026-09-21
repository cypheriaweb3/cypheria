import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { type CypheriaClient, createCypheriaClient } from "@cypheria/client"
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron"
import {
  type AppearanceSettings,
  type AppearanceSettingsWrite,
  type AppHealthStatus,
  type AppMetadata,
  appConfigOpenContract,
  appDirectoryPickContract,
  appExternalOpenContract,
  appHealthCheckContract,
  appMetadataReadContract,
  appProjectRevealContract,
  browserSessionOpenContract,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX,
  CYPHERIA_IPC_CHANNELS,
  CYPHERIA_LANGUAGE_ARGUMENT_PREFIX,
  dappProviderRequestContract,
  IPC_PROTOCOL_VERSION,
  settingsAppearanceFontsListContract,
  settingsAppearanceReadContract,
  settingsAppearanceWriteContract,
  settingsConnectionProxyReadContract,
  settingsConnectionProxyTestContract,
  settingsConnectionProxyWriteContract,
  settingsLanguageReadContract,
  settingsLanguageWriteContract,
  settingsWorkspaceLayoutReadContract,
  settingsWorkspaceLayoutWriteContract,
} from "../../ipc/src/index.js"
import { buildDesktopAppPaths, type DesktopAppPaths } from "./app-paths.js"
import { readAppearanceSettings, writeAppearanceSettings } from "./appearance-config.js"
import { configureChromiumFeatures } from "./chromium-features.js"
import {
  applyConnectionProxyToSession,
  readConnectionProxySettings,
  testConnectionProxy,
  writeConnectionProxySettings,
} from "./connection-proxy.js"
import {
  createDappBrowserController,
  createElectronDappWebContentsFactory,
  type DappBrowserController,
} from "./dapp-browser.js"
import { registerIpcRoute } from "./ipc.js"
import { readLanguageSettings, writeLanguageSettings } from "./language-config.js"
import { resolveGeneratedImageProtocolPath } from "./renderer-protocol.js"
import { DesktopServerManager } from "./server-manager.js"
import { listSystemFonts } from "./system-fonts.js"
import {
  readWorkspaceLayoutSettings,
  writeWorkspaceLayoutSettings,
} from "./workspace-layout-config.js"

app.setName("Cypheria")

const isDevelopmentShell = process.env.CYPHERIA_DEVELOPMENT_SHELL === "1"
const isPackagedRuntime = app.isPackaged && !isDevelopmentShell

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let shutdownComplete = false
let shutdownPromise: Promise<void> | null = null
let desktopClient: CypheriaClient | null = null
let desktopRuntimePaths: DesktopAppPaths | null = null
let desktopServerManager: DesktopServerManager | null = null
let currentAppearanceSettings: AppearanceSettings | null = null
let currentConnectionProxySettings: import("../../ipc/src/index.js").ConnectionProxySettings = {
  mode: "system",
}
let proxySettingsUnderTest: import("../../ipc/src/index.js").ConnectionProxySettings | null = null

let dappBrowserController: DappBrowserController | null = null

const currentDir = dirname(fileURLToPath(import.meta.url))
const preloadPath = join(currentDir, "../preload/index.cjs")
const dappPreloadPath = join(currentDir, "../dapp-preload/index.cjs")
const rendererShellPath = join(currentDir, "../client/_shell.html")
const rendererClientDir = dirname(rendererShellPath)
const applicationIconPath = isPackagedRuntime
  ? join(process.resourcesPath, "icons/icon.png")
  : join(currentDir, "../../resources/icons/icon.png")

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

const buildPlaceholderHtml = (paths: DesktopAppPaths): string => `<!doctype html>
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
      <p>Cypheria home: <code>${escapeHtml(paths.cypheriaHome)}</code></p>
      <p>Codex home: <code>${escapeHtml(paths.codexHome)}</code></p>
    </main>
  </body>
</html>`

const getRendererUrl = (): string | undefined => {
  const rendererUrl = process.env.CYPHERIA_RENDERER_URL?.trim()
  return rendererUrl ? rendererUrl : undefined
}

const registerRendererProtocol = (codexHome: string): void => {
  const generatedImagesDir = join(codexHome, "generated_images")
  protocol.handle("cypheria", (request) => {
    const generatedImagePath = resolveGeneratedImageProtocolPath(request.url, generatedImagesDir)
    if (generatedImagePath) {
      return existsSync(generatedImagePath)
        ? net.fetch(pathToFileURL(generatedImagePath).toString())
        : new Response(null, { status: 404 })
    }

    const url = new URL(request.url)
    if (url.hostname !== "app") return new Response(null, { status: 404 })
    const pathname = decodeURIComponent(url.pathname)
    const requestedPath = pathname === "/" ? "_shell.html" : pathname.replace(/^\/+/, "")
    const candidate = resolve(rendererClientDir, requestedPath)
    const isWithinRenderer = !relative(rendererClientDir, candidate).startsWith("..")
    const target = isWithinRenderer && existsSync(candidate) ? candidate : rendererShellPath
    return net.fetch(pathToFileURL(target).toString())
  })
}

const registerIpcHandlers = (paths: DesktopAppPaths, client: CypheriaClient): void => {
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
  registerIpcRoute(appExternalOpenContract, async ({ url }) => {
    await shell.openExternal(url)
    return { opened: true }
  })
  registerIpcRoute(appDirectoryPickContract, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose a project folder",
    })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
  registerIpcRoute(appConfigOpenContract, async () => {
    const result = await shell.openPath(join(paths.configDir, "config.json"))
    if (result) throw new Error(result)
    return { opened: true }
  })
  registerIpcRoute(appProjectRevealContract, async ({ projectId }) => {
    const project = await client.projects.get(projectId)
    const root = project.roots[0]
    if (!root) throw new Error("Project folder is unavailable.")
    shell.showItemInFolder(root)
    return { revealed: true }
  })
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
  registerIpcRoute(settingsAppearanceReadContract, () =>
    readAppearanceSettings(app.getPath("userData"))
  )
  registerIpcRoute(settingsAppearanceFontsListContract, () => listSystemFonts())
  registerIpcRoute(settingsAppearanceWriteContract, async (settings) => {
    const savedSettings = await writeAppearanceSettings(app.getPath("userData"), settings)
    currentAppearanceSettings = savedSettings
    applyNativeAppearance(mainWindow, savedSettings)
    return savedSettings
  })
  registerIpcRoute(settingsLanguageReadContract, () =>
    readLanguageSettings(app.getPath("userData"), app.getPreferredSystemLanguages())
  )
  registerIpcRoute(settingsLanguageWriteContract, async (settings) => {
    const savedSettings = await writeLanguageSettings(
      app.getPath("userData"),
      settings,
      app.getPreferredSystemLanguages()
    )
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(CYPHERIA_IPC_CHANNELS.settingsLanguageChanged, savedSettings)
    }
    return savedSettings
  })
  registerIpcRoute(settingsWorkspaceLayoutReadContract, () =>
    readWorkspaceLayoutSettings(app.getPath("userData"))
  )
  registerIpcRoute(settingsWorkspaceLayoutWriteContract, (settings) =>
    writeWorkspaceLayoutSettings(app.getPath("userData"), settings)
  )
  registerIpcRoute(settingsConnectionProxyReadContract, () => currentConnectionProxySettings)
  registerIpcRoute(settingsConnectionProxyTestContract, async (settings) => {
    const testSession = session.fromPartition(`proxy-test-${randomUUID()}`, { cache: false })
    proxySettingsUnderTest = settings
    try {
      return await testConnectionProxy(testSession, settings)
    } finally {
      proxySettingsUnderTest = null
      await testSession.clearStorageData()
    }
  })
  registerIpcRoute(settingsConnectionProxyWriteContract, async (settings) => {
    const saved = await writeConnectionProxySettings(paths.configDir, settings)
    await applyConnectionProxyToSession(session.defaultSession, saved)
    currentConnectionProxySettings = saved
    return saved
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
  if (isPackagedRuntime) {
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

const createMainWindow = async (
  client: CypheriaClient,
  paths: DesktopAppPaths
): Promise<BrowserWindow> => {
  const appearance = await readAppearanceSettings(app.getPath("userData"))
  const language = await readLanguageSettings(
    app.getPath("userData"),
    app.getPreferredSystemLanguages()
  )
  currentAppearanceSettings = appearance
  nativeTheme.themeSource = appearance.theme
  const activeTheme = getActiveChromeTheme(appearance)
  const appearanceArgument = `${CYPHERIA_APPEARANCE_ARGUMENT_PREFIX}${encodeURIComponent(
    JSON.stringify(toAppearanceBootstrap(appearance))
  )}`
  const languageArgument = `${CYPHERIA_LANGUAGE_ARGUMENT_PREFIX}${encodeURIComponent(
    JSON.stringify({ locale: language.locale, preference: language.preference })
  )}`
  const developmentArgument = `${CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX}${isDevelopmentShell ? "1" : "0"}`
  const window = new BrowserWindow({
    backgroundColor: activeTheme.surface,
    ...(process.platform === "linux"
      ? { darkTheme: resolveNativeThemeMode(appearance) === "dark" }
      : {}),
    height: 860,
    icon: applicationIconPath,
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
      // Keep Chromium's 16px rem baseline; renderer typography is controlled by CSS tokens.
      additionalArguments: [appearanceArgument, developmentArgument, languageArgument],
      contextIsolation: true,
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
        return await client.web3.dapps.request(request)
      } catch {
        return {
          error: { code: 4900, message: "The wallet provider runtime is unavailable." },
          id: request.id,
        }
      }
    },
    sessions: { open: (url) => client.web3.dapps.openSession(url) },
  })

  window.once("ready-to-show", () => {
    window.show()
  })

  window.on("close", (event) => {
    if (process.platform !== "darwin" || isQuitting) return
    event.preventDefault()
    window.hide()
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
      `data:text/html;charset=utf-8,${encodeURIComponent(buildPlaceholderHtml(paths))}`
    )
  }

  if (!window.isVisible()) {
    window.show()
  }

  return window
}

const registerLifecycleHandlers = (): void => {
  nativeTheme.on("updated", refreshNativeWindowChrome)

  app.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return
    const settings = proxySettingsUnderTest ?? currentConnectionProxySettings
    if (settings?.mode !== "manual" || (!settings.username && !settings.password)) return
    event.preventDefault()
    callback(settings.username, settings.password)
  })

  app.on("second-instance", () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow.focus()
  })

  app.on("activate", async () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
      return
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!desktopClient || !desktopRuntimePaths) throw new Error("Desktop client is unavailable")
      await desktopClient.ensureConnected()
      mainWindow = await createMainWindow(desktopClient, desktopRuntimePaths)
    }
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.on("before-quit", (event) => {
    isQuitting = true
    if (shutdownComplete) return
    event.preventDefault()
    if (shutdownPromise) return
    shutdownPromise = (async () => {
      await desktopClient?.close()
      await desktopServerManager?.stopOwned()
    })()
      .catch(logFatalError)
      .finally(() => {
        shutdownComplete = true
        app.quit()
      })
  })
}

const startDesktopApp = async (): Promise<void> => {
  configureChromiumFeatures(app.commandLine)
  const runtimePaths = buildDesktopAppPaths()
  desktopRuntimePaths = runtimePaths
  const desktopUserDataDir = join(runtimePaths.cypheriaHome, "desktop")
  await Promise.all([
    mkdir(desktopUserDataDir, { recursive: true }),
    mkdir(runtimePaths.browserDir, { recursive: true }),
  ])
  app.setPath("userData", desktopUserDataDir)
  app.setPath("sessionData", runtimePaths.browserDir)

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  registerLifecycleHandlers()

  await app.whenReady()
  desktopServerManager = new DesktopServerManager({
    cliCandidates: [
      process.env.CYPHERIA_SERVER_CLI_PATH ?? "",
      join(app.getAppPath(), "..", "server", "dist", "cli.mjs"),
      join(app.getAppPath(), "dist", "cypheria-server", "cli.mjs"),
      join(process.resourcesPath, "cypheria-server", "cli.mjs"),
    ],
    supervisorCandidates: [
      process.env.CYPHERIA_SERVER_SUPERVISOR_PATH ?? "",
      join(app.getAppPath(), "..", "server", "dist", "supervisor.mjs"),
      join(app.getAppPath(), "dist", "cypheria-server", "supervisor.mjs"),
      join(process.resourcesPath, "cypheria-server", "supervisor.mjs"),
    ],
  })
  const server = await desktopServerManager.ensureRunning()
  desktopClient = createCypheriaClient({
    appVersion: app.getVersion(),
    clientType: "desktop",
    reconnect: { enabled: true },
    url: server.url,
  })
  await desktopClient.ensureConnected()
  if (process.platform === "darwin") {
    app.dock?.setIcon(applicationIconPath)
  }
  registerRendererProtocol(runtimePaths.codexHome)
  currentConnectionProxySettings = await readConnectionProxySettings(runtimePaths.configDir)
  await applyConnectionProxyToSession(session.defaultSession, currentConnectionProxySettings)
  registerIpcHandlers(runtimePaths, desktopClient)
  mainWindow = await createMainWindow(desktopClient, runtimePaths)
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
