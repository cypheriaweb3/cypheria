import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import type {
  AppearanceFontOption,
  AppHealthStatus,
  AppMetadata,
  CypheriaPreloadApi,
  OpenTarget,
} from "../../ipc/src/index.js"
import {
  AppearanceSettingsWriteSchema,
  BrowserNewTabRequestSchema,
  BrowserReservedShortcutSchema,
  BrowserShortcutInputSchema,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  CYPHERIA_BROWSER_CHANNELS,
  CYPHERIA_CLIENT_ID_ARGUMENT_PREFIX,
  CYPHERIA_COMPUTER_USE_CHANNELS,
  CYPHERIA_DAPP_BROWSER_PARTITION,
  CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX,
  CYPHERIA_IPC_CHANNELS,
  CYPHERIA_LANGUAGE_ARGUMENT_PREFIX,
  CYPHERIA_WEB_BROWSER_PARTITION,
  CYPHERIA_WINDOW_LAYOUT_ARGUMENT_PREFIX,
  DesktopClientIdSchema,
  LanguageBootstrapSchema,
  StorageKeyValueChangeSchema,
} from "../../ipc/src/index.js"

const readBootstrapAppearance = () => {
  const argument = process.argv.find((value) =>
    value.startsWith(CYPHERIA_APPEARANCE_ARGUMENT_PREFIX)
  )
  if (!argument) {
    throw new Error("Cypheria appearance bootstrap argument is missing")
  }

  const encodedAppearance = argument.slice(CYPHERIA_APPEARANCE_ARGUMENT_PREFIX.length)
  return AppearanceSettingsWriteSchema.parse(JSON.parse(decodeURIComponent(encodedAppearance)))
}

const readBootstrapLanguage = () => {
  const argument = process.argv.find((value) => value.startsWith(CYPHERIA_LANGUAGE_ARGUMENT_PREFIX))
  if (!argument) {
    throw new Error("Cypheria language bootstrap argument is missing")
  }

  const encodedLanguage = argument.slice(CYPHERIA_LANGUAGE_ARGUMENT_PREFIX.length)
  return LanguageBootstrapSchema.parse(JSON.parse(decodeURIComponent(encodedLanguage)))
}

const readBootstrapDevelopment = () =>
  process.argv.some((value) => value === `${CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX}1`)

const readClientId = (): string | null => {
  const argument = process.argv.find((value) =>
    value.startsWith(CYPHERIA_CLIENT_ID_ARGUMENT_PREFIX)
  )
  const parsed = DesktopClientIdSchema.safeParse(
    argument?.slice(CYPHERIA_CLIENT_ID_ARGUMENT_PREFIX.length)
  )
  return parsed.success ? parsed.data : null
}

const readPersistLayout = (): boolean =>
  process.argv.some((value) => value === `${CYPHERIA_WINDOW_LAYOUT_ARGUMENT_PREFIX}persistent`)

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const subscribe =
  <T>(channel: string, parse: (value: unknown) => T) =>
  (handler: (value: T) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, value: unknown): void => {
      const parsed = (() => {
        try {
          return parse(value)
        } catch {
          return undefined
        }
      })()
      if (parsed !== undefined) handler(parsed)
    }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  }

const browserApi: NonNullable<CypheriaPreloadApi["browser"]> = {
  dappPartition: CYPHERIA_DAPP_BROWSER_PARTITION,
  webPartition: CYPHERIA_WEB_BROWSER_PARTITION,
  registerAttached: (input) =>
    ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.attachedRegister, input),
  unregister: (browserId) =>
    ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.unregister, { browserId }),
  setActive: (input) => ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.activeSet, input),
  focus: (browserId) => ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.focus, { browserId }),
  openDevTools: (browserId) =>
    ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.devToolsOpen, { browserId }),
  listLive: () => ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.liveList, {}),
  executeAutomation: (request) =>
    ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.automationExecute, request),
  executeMcpApp: (input) => ipcRenderer.invoke(CYPHERIA_COMPUTER_USE_CHANNELS.mcpAppExecute, input),
  setShortcutPolicy: (policy) =>
    ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.shortcutPolicySet, policy),
  clearData: (input) => ipcRenderer.invoke(CYPHERIA_BROWSER_CHANNELS.dataClear, input),
  onNewTabRequest: subscribe(CYPHERIA_BROWSER_CHANNELS.newTabRequested, (value) =>
    BrowserNewTabRequestSchema.parse(value)
  ),
  onShortcutInput: subscribe(CYPHERIA_BROWSER_CHANNELS.shortcutInput, (value) =>
    BrowserShortcutInputSchema.parse(value)
  ),
  onReservedShortcut: subscribe(CYPHERIA_BROWSER_CHANNELS.reservedShortcut, (value) =>
    BrowserReservedShortcutSchema.parse(value)
  ),
}

const cypheriaApi: CypheriaPreloadApi = {
  bootstrap: {
    appearance: readBootstrapAppearance(),
    development: readBootstrapDevelopment(),
    clientId: readClientId(),
    language: readBootstrapLanguage(),
    persistLayout: readPersistLayout(),
  },
  app: {
    platform: process.platform,
    getHealth: () => invoke<AppHealthStatus>(CYPHERIA_IPC_CHANNELS.appHealthCheck),
    getMetadata: () => invoke<AppMetadata>(CYPHERIA_IPC_CHANNELS.appMetadataRead),
    pickDirectory: () => invoke(CYPHERIA_IPC_CHANNELS.appDirectoryPick),
    pickSoundFile: () => invoke(CYPHERIA_IPC_CHANNELS.appSoundPick),
    openExternal: (url) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appExternalOpen, { url }),
    onDeepLink: (handler) => {
      const listener = (_event: IpcRendererEvent, url: unknown): void => {
        if (typeof url === "string") handler(url)
      }
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.appDeepLink, listener)
      return () => ipcRenderer.off(CYPHERIA_IPC_CHANNELS.appDeepLink, listener)
    },
    takeDeepLinks: () => invoke(CYPHERIA_IPC_CHANNELS.appDeepLinkTake),
    openConfig: () => invoke(CYPHERIA_IPC_CHANNELS.appConfigOpen),
    revealProject: (projectId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appProjectReveal, { projectId }),
    openProject: (projectId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appProjectOpen, { projectId }),
    gitFileAction: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appGitFileAction, input),
    workspaceFileAction: (input) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appWorkspaceFileAction, input),
  },
  // Every window allows <webview> and may host browser tabs.
  browser: browserApi,
  storage: {
    attachments: {
      getPathForFile: (file) => webUtils.getPathForFile(file),
      copyFileUri: (storageKey, uri) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentCopyFile, {
          storageKey,
          uri,
        }),
      delete: (storageKey) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentDelete, { storageKey }),
      list: () => invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentList),
      listPage: (request) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentListPage, request),
      read: (storageKey) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentRead, { storageKey }),
      stat: (storageKey) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentStat, { storageKey }),
      write: (storageKey, bytes) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageAttachmentWrite, {
          storageKey,
          bytes,
        }),
    },
    keyValue: {
      getItem: (key) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageKeyValueGet, { key }),
      setItem: (key, value) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageKeyValueSet, { key, value }),
      removeItem: (key) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageKeyValueRemove, { key }),
      listPage: (request) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageKeyValueListPage, request),
      onChanged: (handler) => {
        const listener = (_event: IpcRendererEvent, rawChange: unknown): void => {
          handler(StorageKeyValueChangeSchema.parse(rawChange))
        }
        ipcRenderer.on(CYPHERIA_IPC_CHANNELS.storageKeyValueChanged, listener)
        return () => ipcRenderer.off(CYPHERIA_IPC_CHANNELS.storageKeyValueChanged, listener)
      },
    },
    replica: {
      open: () => invoke(CYPHERIA_IPC_CHANNELS.storageReplicaOpen),
      read: (scopeId, entityTypes, entityIds) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaRead, {
          scopeId,
          entityTypes,
          ...(entityIds ? { entityIds } : {}),
        }),
      readAll: () => invoke(CYPHERIA_IPC_CHANNELS.storageReplicaReadAll),
      listPage: (request) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaListPage, request),
      apply: (changes) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaApply, changes),
      deleteScope: (scopeId) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaDeleteScope, { scopeId }),
      renameScope: (oldScopeId, newScopeId) =>
        ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.storageReplicaRenameScope, {
          oldScopeId,
          newScopeId,
        }),
      clear: () => invoke(CYPHERIA_IPC_CHANNELS.storageReplicaClear),
    },
  },
  computerUse: {
    requestPermission: (permission) =>
      ipcRenderer.invoke(CYPHERIA_COMPUTER_USE_CHANNELS.permissionRequest, { permission }),
    restartDriver: () => ipcRenderer.invoke(CYPHERIA_COMPUTER_USE_CHANNELS.driverRestart, {}),
    status: () => ipcRenderer.invoke(CYPHERIA_COMPUTER_USE_CHANNELS.statusRead, {}),
  },
  settings: {
    listOpenTargets: () => invoke<OpenTarget[]>(CYPHERIA_IPC_CHANNELS.settingsOpenTargetsList),
    listNotificationSounds: () =>
      invoke<string[]>(CYPHERIA_IPC_CHANNELS.settingsNotificationSoundsList),
    previewNotificationSound: () =>
      invoke<{ played: boolean }>(CYPHERIA_IPC_CHANNELS.settingsNotificationSoundPreview),
    listAppearanceFonts: () =>
      invoke<AppearanceFontOption[]>(CYPHERIA_IPC_CHANNELS.settingsAppearanceFontsList),
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
