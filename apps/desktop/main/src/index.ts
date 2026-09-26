import { type ChildProcess, execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { copyFile, mkdir, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { type CypheriaClient, createCypheriaClient } from "@cypheria/client"
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  net,
  powerSaveBlocker,
  protocol,
  shell,
  Tray,
} from "electron"
import {
  type AppearanceSettingsWrite,
  type AppHealthStatus,
  type AppMetadata,
  appConfigOpenContract,
  appDirectoryPickContract,
  appExternalOpenContract,
  appGitFileActionContract,
  appHealthCheckContract,
  appMetadataReadContract,
  appProjectOpenContract,
  appProjectRevealContract,
  appSoundPickContract,
  browserSessionOpenContract,
  type ClientPreferencesSnapshot,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX,
  CYPHERIA_IPC_CHANNELS,
  CYPHERIA_LANGUAGE_ARGUMENT_PREFIX,
  CYPHERIA_WINDOW_ROLE_ARGUMENT_PREFIX,
  dappProviderRequestContract,
  IPC_PROTOCOL_VERSION,
  settingsAppearanceFontsListContract,
  settingsNotificationSoundPreviewContract,
  settingsNotificationSoundsListContract,
  settingsOpenTargetsListContract,
  storageAttachmentCopyFileContract,
  storageAttachmentDeleteContract,
  storageAttachmentListContract,
  storageAttachmentListPageContract,
  storageAttachmentReadContract,
  storageAttachmentStatContract,
  storageAttachmentWriteContract,
  storageKeyValueGetContract,
  storageKeyValueListPageContract,
  storageKeyValueRemoveContract,
  storageKeyValueSetContract,
  storageReplicaApplyContract,
  storageReplicaClearContract,
  storageReplicaDeleteScopeContract,
  storageReplicaListPageContract,
  storageReplicaOpenContract,
  storageReplicaReadAllContract,
  storageReplicaReadContract,
  storageReplicaRenameScopeContract,
} from "../../ipc/src/index.js"
import { buildDesktopAppPaths, type DesktopAppPaths } from "./app-paths.js"
import { configureChromiumFeatures } from "./chromium-features.js"
import {
  copyDesktopAttachmentFile,
  deleteDesktopAttachment,
  listDesktopAttachmentPage,
  listDesktopAttachments,
  readDesktopAttachment,
  statDesktopAttachment,
  writeDesktopAttachment,
} from "./client-attachment-store.js"
import {
  clientSettingHasMainSideEffect,
  readAppearance,
  readClientPreferences,
  readLocaleBootstrap,
} from "./client-settings.js"
import {
  createDesktopClientStorageDatabase,
  type DesktopClientStorageDatabase,
} from "./client-storage-database.js"
import {
  createDappBrowserController,
  createElectronDappWebContentsFactory,
  type DappBrowserController,
} from "./dapp-browser.js"
import { registerIpcRoute } from "./ipc.js"
import { getOpenTargetApplication, listOpenTargets } from "./open-targets.js"
import { resolveGeneratedImageProtocolPath } from "./renderer-protocol.js"
import { DesktopServerManager } from "./server-manager.js"
import { listSystemFonts } from "./system-fonts.js"
import { findSystemNotificationSoundFile, listSystemNotificationSounds } from "./system-sounds.js"

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
let desktopStorageDatabase: DesktopClientStorageDatabase | null = null
let currentAppearanceSettings: AppearanceSettingsWrite | null = null
let currentPreferences: ClientPreferencesSnapshot | null = null
let menuBarTray: Tray | null = null
let popoutWindow: BrowserWindow | null = null
let registeredPopoutHotkey: string | null = null
let sleepBlockerId: number | null = null
let currentSoundPreview: ChildProcess | null = null
const runningThreadIds = new Set<string>()
const notificationSounds = {
  default: "cypheria-notification",
  classic: "cypheria-classic",
} as const
const customSoundName = (path: string): string =>
  `cypheria-custom-${createHash("sha256").update(path).digest("hex").slice(0, 16)}`

const selectedNotificationSound = (
  preferences: ClientPreferencesSnapshot | null
): string | undefined => {
  const sound = preferences?.notificationSound
  if (!sound || sound.type === "none") return undefined
  if (sound.type === "bundled") return notificationSounds[sound.sound]
  if (sound.type === "custom") return customSoundName(sound.path)
  return sound.name
}

const stageNotificationSounds = async (preferences: ClientPreferencesSnapshot): Promise<void> => {
  if (process.platform !== "darwin") return
  const sourceDirectory = isPackagedRuntime
    ? join(process.resourcesPath, "sounds")
    : join(currentDir, "../../resources/sounds")
  const destinationDirectory = join(homedir(), "Library", "Sounds")
  await mkdir(destinationDirectory, { recursive: true })
  await Promise.all(
    Object.values(notificationSounds).map((name) =>
      copyFile(join(sourceDirectory, `${name}.wav`), join(destinationDirectory, `${name}.wav`))
    )
  )
  if (preferences.notificationSound.type === "custom") {
    const path = preferences.notificationSound.path
    if (
      !path ||
      !isAbsolute(path) ||
      ![".wav", ".aiff", ".aif", ".caf"].includes(extname(path).toLowerCase())
    ) {
      throw new Error("Choose a WAV, AIFF, or CAF sound file")
    }
    await copyFile(
      path,
      join(destinationDirectory, `${customSoundName(path)}${extname(path).toLowerCase()}`)
    )
  }
}

const previewNotificationSound = async (): Promise<{ played: boolean }> => {
  currentSoundPreview?.kill()
  currentSoundPreview = null
  const preferences = currentPreferences
  if (
    process.platform !== "darwin" ||
    !preferences ||
    preferences.notificationSound.type === "none"
  ) {
    return { played: false }
  }

  const sound = preferences.notificationSound
  const file =
    sound.type === "bundled"
      ? join(homedir(), "Library", "Sounds", `${notificationSounds[sound.sound]}.wav`)
      : sound.type === "custom"
        ? sound.path
        : await findSystemNotificationSoundFile(sound.name)
  if (!file || !existsSync(file)) throw new Error("Notification sound file is unavailable")

  await new Promise<void>((resolve, reject) => {
    const preview = execFile("afplay", [file], () => {})
    currentSoundPreview = preview
    preview.once("spawn", resolve)
    preview.once("error", reject)
    preview.once("close", () => {
      if (currentSoundPreview === preview) currentSoundPreview = null
    })
  })
  return { played: true }
}
const execFileAsync = promisify(execFile)
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

const focusMainWindow = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const openPopoutWindow = async (): Promise<void> => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.focus()
    return
  }
  if (!desktopStorageDatabase) throw new Error("Desktop storage is unavailable")
  const appearance = await readAppearance(desktopStorageDatabase.keyValue)
  const language = await readLocaleBootstrap(
    desktopStorageDatabase.keyValue,
    app.getPreferredSystemLanguages()
  )
  const url = new URL("/", getRendererUrl() ?? "cypheria://app/")
  if (!currentPreferences?.hotkeyWindowProjectlessDefaultEnabled && mainWindow) {
    const projectId = new URL(mainWindow.webContents.getURL()).searchParams.get("project")
    if (projectId) url.searchParams.set("project", projectId)
  }
  const window = new BrowserWindow({
    width: 520,
    height: 680,
    minWidth: 400,
    minHeight: 450,
    title: "Cypheria",
    backgroundColor: getActiveChromeTheme(appearance).surface,
    webPreferences: {
      additionalArguments: [
        `${CYPHERIA_APPEARANCE_ARGUMENT_PREFIX}${encodeURIComponent(JSON.stringify(appearance))}`,
        `${CYPHERIA_LANGUAGE_ARGUMENT_PREFIX}${encodeURIComponent(JSON.stringify(language))}`,
        `${CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX}${isDevelopmentShell ? "1" : "0"}`,
        `${CYPHERIA_WINDOW_ROLE_ARGUMENT_PREFIX}popout`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
  })
  popoutWindow = window
  window.on("closed", () => {
    if (popoutWindow === window) popoutWindow = null
  })
  await window.loadURL(url.toString())
  window.show()
}

const syncSleepBlocker = (): void => {
  if (currentPreferences?.preventSleepWhileRunning && runningThreadIds.size > 0) {
    sleepBlockerId ??= powerSaveBlocker.start("prevent-app-suspension")
  } else if (sleepBlockerId !== null) {
    powerSaveBlocker.stop(sleepBlockerId)
    sleepBlockerId = null
  }
}

const applyDesktopPreferences = (preferences: ClientPreferencesSnapshot): void => {
  const nextHotkey = preferences.hotkeyWindowHotkey
  if (nextHotkey !== registeredPopoutHotkey) {
    if (registeredPopoutHotkey) globalShortcut.unregister(registeredPopoutHotkey)
    registeredPopoutHotkey = null
    if (nextHotkey) {
      if (
        !globalShortcut.register(nextHotkey, () => void openPopoutWindow().catch(logFatalError))
      ) {
        throw new Error(`Could not register the Popout Window hotkey: ${nextHotkey}`)
      }
      registeredPopoutHotkey = nextHotkey
    }
  }
  currentPreferences = preferences
  if (process.platform === "darwin") {
    if (preferences.macMenuBarEnabled && !menuBarTray) {
      const icon = nativeImage.createFromPath(applicationIconPath).resize({ width: 18, height: 18 })
      menuBarTray = new Tray(icon)
      menuBarTray.setToolTip("Cypheria")
      menuBarTray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Open Cypheria", click: focusMainWindow },
          { type: "separator" },
          { label: "Quit Cypheria", click: () => app.quit() },
        ])
      )
      menuBarTray.on("click", focusMainWindow)
    } else if (!preferences.macMenuBarEnabled && menuBarTray) {
      menuBarTray.destroy()
      menuBarTray = null
    }
  }
  syncSleepBlocker()
}

const subscribeToDesktopThreadEvents = (client: CypheriaClient): void => {
  const showNotification = (title: string, body: string): void => {
    if (!Notification.isSupported()) return
    const notification = new Notification({
      title,
      body,
      silent: currentPreferences?.notificationSound.type === "none",
      sound: selectedNotificationSound(currentPreferences),
    })
    notification.on("click", focusMainWindow)
    notification.show()
  }
  client.on("thread.updated.notification", ({ payload }) => {
    const wasRunning = runningThreadIds.has(payload.id)
    const isRunning = payload.state === "running" || payload.state === "starting"
    if (isRunning) runningThreadIds.add(payload.id)
    else runningThreadIds.delete(payload.id)
    syncSleepBlocker()
    if (
      wasRunning &&
      !isRunning &&
      payload.state === "idle" &&
      currentPreferences?.notificationsTurnMode !== "off" &&
      (currentPreferences?.notificationsTurnMode === "always" || !BrowserWindow.getFocusedWindow())
    ) {
      showNotification("Task complete", payload.title ?? "Your task is ready")
    }
  })
  client.on("thread.interaction.requested.notification", ({ payload }) => {
    if (
      payload.interaction.kind === "permission" &&
      currentPreferences?.notificationsPermissionsEnabled
    ) {
      showNotification("Permission required", "A task is waiting for your approval")
    } else if (
      payload.interaction.kind !== "permission" &&
      currentPreferences?.notificationsQuestionsEnabled
    ) {
      showNotification("Input needed", "A task is waiting for your response")
    }
  })
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

const registerIpcHandlers = (
  paths: DesktopAppPaths,
  client: CypheriaClient,
  storageDatabase: DesktopClientStorageDatabase
): void => {
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
  registerIpcRoute(appSoundPickContract, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "Sound files", extensions: ["wav", "aiff", "aif", "caf"] }],
      properties: ["openFile"],
      title: "Choose custom sound",
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
  registerIpcRoute(appProjectOpenContract, async ({ projectId }) => {
    const project = await client.projects.get(projectId)
    const root = project.roots[0]
    if (!root) throw new Error("Project folder is unavailable.")
    const destination = currentPreferences?.openInTargetPreference ?? "system"
    if (destination === "reveal") shell.showItemInFolder(root)
    else if (destination === "system") {
      const error = await shell.openPath(root)
      if (error) throw new Error(error)
    } else {
      const appName = getOpenTargetApplication(destination)
      if (!appName || !(await listOpenTargets()).some((target) => target.id === destination)) {
        throw new Error(`The selected file open destination is unavailable: ${destination}`)
      }
      await execFileAsync("open", ["-a", appName, root])
    }
    return { opened: true }
  })
  registerIpcRoute(appGitFileActionContract, async ({ cwd, path, action }) => {
    const repository = await client.git.discover(cwd)
    const candidate = resolve(repository.root, path)
    const relativePath = relative(repository.root, candidate)
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error("Git file is outside the repository")
    }
    const source = await realpath(candidate)
    const resolvedRelative = relative(repository.root, source)
    if (
      !resolvedRelative ||
      resolvedRelative === ".." ||
      resolvedRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(resolvedRelative) ||
      !(await stat(source)).isFile()
    ) {
      throw new Error("Git file is unavailable")
    }
    if (action === "open") {
      const error = await shell.openPath(source)
      if (error) throw new Error(error)
      return { completed: true }
    }
    const destination = await dialog.showSaveDialog({ defaultPath: source })
    if (destination.canceled || !destination.filePath) return { completed: false }
    await copyFile(source, destination.filePath)
    return { completed: true }
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
  registerIpcRoute(storageAttachmentWriteContract, ({ storageKey, bytes }) =>
    writeDesktopAttachment(app.getPath("userData"), storageKey, bytes)
  )
  registerIpcRoute(storageAttachmentCopyFileContract, ({ storageKey, uri }) =>
    copyDesktopAttachmentFile(app.getPath("userData"), storageKey, uri)
  )
  registerIpcRoute(storageAttachmentReadContract, ({ storageKey }) =>
    readDesktopAttachment(app.getPath("userData"), storageKey)
  )
  registerIpcRoute(storageAttachmentStatContract, ({ storageKey }) =>
    statDesktopAttachment(app.getPath("userData"), storageKey)
  )
  registerIpcRoute(storageAttachmentDeleteContract, ({ storageKey }) =>
    deleteDesktopAttachment(app.getPath("userData"), storageKey)
  )
  registerIpcRoute(storageAttachmentListContract, () =>
    listDesktopAttachments(app.getPath("userData"))
  )
  registerIpcRoute(storageAttachmentListPageContract, (request) =>
    listDesktopAttachmentPage(app.getPath("userData"), request)
  )
  registerIpcRoute(storageKeyValueGetContract, async ({ key }) => ({
    value: await storageDatabase.keyValue.getItem(key),
  }))
  registerIpcRoute(storageKeyValueSetContract, async ({ key, value }) => {
    await storageDatabase.keyValue.setItem(key, value)
    if (clientSettingHasMainSideEffect(key)) {
      const previous = currentPreferences
      try {
        const nextAppearance = await readAppearance(storageDatabase.keyValue)
        const nextPreferences = await readClientPreferences(storageDatabase.keyValue)
        if (nextPreferences.projectlessWorkspaceRoot) {
          await mkdir(nextPreferences.projectlessWorkspaceRoot, { recursive: true })
        }
        await stageNotificationSounds(nextPreferences)
        currentAppearanceSettings = nextAppearance
        applyNativeAppearance(mainWindow, nextAppearance)
        applyDesktopPreferences(nextPreferences)
      } catch (error) {
        if (previous) applyDesktopPreferences(previous)
        throw error
      }
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CYPHERIA_IPC_CHANNELS.storageKeyValueChanged, { key, value })
    }
    return { saved: true }
  })
  registerIpcRoute(storageKeyValueRemoveContract, async ({ key }) => {
    await storageDatabase.keyValue.removeItem(key)
    if (clientSettingHasMainSideEffect(key)) {
      const appearance = await readAppearance(storageDatabase.keyValue)
      const preferences = await readClientPreferences(storageDatabase.keyValue)
      currentAppearanceSettings = appearance
      applyNativeAppearance(mainWindow, appearance)
      applyDesktopPreferences(preferences)
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CYPHERIA_IPC_CHANNELS.storageKeyValueChanged, { key, value: null })
    }
    return { removed: true }
  })
  registerIpcRoute(storageKeyValueListPageContract, (request) =>
    storageDatabase.keyValue.listPage(request)
  )
  registerIpcRoute(storageReplicaOpenContract, async () => {
    await storageDatabase.replica.open()
    return { opened: true }
  })
  registerIpcRoute(storageReplicaReadContract, async ({ scopeId, entityTypes, entityIds }) => ({
    rows: await storageDatabase.replica.read(scopeId, entityTypes, entityIds),
  }))
  registerIpcRoute(storageReplicaReadAllContract, async () => ({
    scopes: await storageDatabase.replica.readAll(),
  }))
  registerIpcRoute(storageReplicaListPageContract, (request) =>
    storageDatabase.replica.listPage(request)
  )
  registerIpcRoute(storageReplicaApplyContract, async (changes) => {
    await storageDatabase.replica.apply(changes)
    return { applied: true }
  })
  registerIpcRoute(storageReplicaDeleteScopeContract, async ({ scopeId }) => {
    await storageDatabase.replica.deleteScope(scopeId)
    return { deleted: true }
  })
  registerIpcRoute(storageReplicaRenameScopeContract, async ({ oldScopeId, newScopeId }) => {
    await storageDatabase.replica.renameScope(oldScopeId, newScopeId)
    return { renamed: true }
  })
  registerIpcRoute(storageReplicaClearContract, async () => {
    await storageDatabase.replica.clear()
    return { cleared: true }
  })
  registerIpcRoute(settingsAppearanceFontsListContract, () => listSystemFonts())
  registerIpcRoute(settingsOpenTargetsListContract, () => listOpenTargets())
  registerIpcRoute(settingsNotificationSoundsListContract, () => listSystemNotificationSounds())
  registerIpcRoute(settingsNotificationSoundPreviewContract, previewNotificationSound)
}

const resolveNativeThemeMode = (settings: AppearanceSettingsWrite): "dark" | "light" => {
  if (settings.theme !== "system") {
    return settings.theme
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

const getActiveChromeTheme = (settings: AppearanceSettingsWrite) =>
  resolveNativeThemeMode(settings) === "dark" ? settings.darkTheme : settings.lightTheme

const applyNativeAppearance = (
  window: BrowserWindow | null,
  settings: AppearanceSettingsWrite
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
  if (!desktopStorageDatabase) throw new Error("Desktop storage is unavailable")
  const appearance = await readAppearance(desktopStorageDatabase.keyValue)
  const language = await readLocaleBootstrap(
    desktopStorageDatabase.keyValue,
    app.getPreferredSystemLanguages()
  )
  currentAppearanceSettings = appearance
  nativeTheme.themeSource = appearance.theme
  const activeTheme = getActiveChromeTheme(appearance)
  const appearanceArgument = `${CYPHERIA_APPEARANCE_ARGUMENT_PREFIX}${encodeURIComponent(
    JSON.stringify(appearance)
  )}`
  const languageArgument = `${CYPHERIA_LANGUAGE_ARGUMENT_PREFIX}${encodeURIComponent(
    JSON.stringify(language)
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
      additionalArguments: [
        appearanceArgument,
        developmentArgument,
        languageArgument,
        `${CYPHERIA_WINDOW_ROLE_ARGUMENT_PREFIX}main`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
    width: 1280,
  })

  registerDeveloperContextMenu(window)

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === "http:" || target.protocol === "https:") {
        void shell.openExternal(target.href).catch((error: unknown) => {
          console.error("Failed to open external URL", error)
        })
      }
    } catch {
      // Reject malformed URLs and never create a renderer-owned browser window.
    }
    return { action: "deny" }
  })

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
    globalShortcut.unregisterAll()
    if (sleepBlockerId !== null) {
      powerSaveBlocker.stop(sleepBlockerId)
      sleepBlockerId = null
    }
    if (shutdownComplete) return
    event.preventDefault()
    if (shutdownPromise) return
    shutdownPromise = (async () => {
      await Promise.all([
        desktopStorageDatabase?.close(),
        desktopClient?.close(),
        desktopServerManager?.stopOwned(),
      ])
    })()
      .catch(logFatalError)
      .finally(() => {
        shutdownComplete = true
        app.quit()
      })
  })
}

const startDesktopApp = async (): Promise<void> => {
  const runtimePaths = buildDesktopAppPaths()
  desktopRuntimePaths = runtimePaths
  const desktopUserDataDir = join(runtimePaths.cypheriaHome, "desktop")

  // Electron can initialize Chromium services before the first awaited operation completes.
  // Create and assign its storage paths synchronously so every subprocess observes the same
  // locations from the start of application initialization.
  mkdirSync(desktopUserDataDir, { recursive: true })
  mkdirSync(runtimePaths.browserDir, { recursive: true })
  app.setPath("userData", desktopUserDataDir)
  app.setPath("sessionData", runtimePaths.browserDir)
  configureChromiumFeatures(app.commandLine)

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  registerLifecycleHandlers()

  await app.whenReady()
  desktopStorageDatabase = createDesktopClientStorageDatabase({
    keyValueFilePath: join(app.getPath("userData"), "kv.sqlite"),
    replicaFilePath: join(app.getPath("userData"), "replica.sqlite"),
  })
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
  currentPreferences = await readClientPreferences(desktopStorageDatabase.keyValue)
  if (currentPreferences.projectlessWorkspaceRoot) {
    await mkdir(currentPreferences.projectlessWorkspaceRoot, { recursive: true })
  }
  await stageNotificationSounds(currentPreferences).catch((error: unknown) => {
    console.warn("Could not stage notification sounds", error)
  })
  applyDesktopPreferences(currentPreferences)
  subscribeToDesktopThreadEvents(desktopClient)
  if (process.platform === "darwin") {
    app.dock?.setIcon(applicationIconPath)
  }
  registerRendererProtocol(runtimePaths.codexHome)
  registerIpcHandlers(runtimePaths, desktopClient, desktopStorageDatabase)
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
