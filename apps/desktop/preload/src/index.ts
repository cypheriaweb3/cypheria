import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"
import type {
  AppearanceFontOption,
  AppearanceSettings,
  AppHealthStatus,
  AppMetadata,
  BrowserSessionOpenResult,
  ConnectionProxySettings,
  ConnectionProxyTestResult,
  CypheriaPreloadApi,
  DesktopPreferences,
  LanguageSettings,
  OpenTarget,
  WorkspaceLayoutSettings,
} from "../../ipc/src/index.js"
import {
  AppearanceSettingsWriteSchema,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  CYPHERIA_DEVELOPMENT_ARGUMENT_PREFIX,
  CYPHERIA_IPC_CHANNELS,
  CYPHERIA_LANGUAGE_ARGUMENT_PREFIX,
  DesktopPreferencesSchema,
  LanguageBootstrapSchema,
  LanguageSettingsSchema,
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

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  bootstrap: {
    appearance: readBootstrapAppearance(),
    development: readBootstrapDevelopment(),
    language: readBootstrapLanguage(),
  },
  app: {
    platform: process.platform,
    getHealth: () => invoke<AppHealthStatus>(CYPHERIA_IPC_CHANNELS.appHealthCheck),
    getMetadata: () => invoke<AppMetadata>(CYPHERIA_IPC_CHANNELS.appMetadataRead),
    pickDirectory: () => invoke(CYPHERIA_IPC_CHANNELS.appDirectoryPick),
    pickSoundFile: () => invoke(CYPHERIA_IPC_CHANNELS.appSoundPick),
    openExternal: (url) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appExternalOpen, { url }),
    openConfig: () => invoke(CYPHERIA_IPC_CHANNELS.appConfigOpen),
    revealProject: (projectId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appProjectReveal, { projectId }),
    openProject: (projectId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appProjectOpen, { projectId }),
    gitFileAction: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.appGitFileAction, input),
  },
  browser: {
    openDapp: (url) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.browserSessionOpen, {
        url,
      }) as Promise<BrowserSessionOpenResult>,
  },
  settings: {
    getAppearance: () => invoke<AppearanceSettings>(CYPHERIA_IPC_CHANNELS.settingsAppearanceRead),
    getConnectionProxy: () =>
      invoke<ConnectionProxySettings>(CYPHERIA_IPC_CHANNELS.settingsConnectionProxyRead),
    getLanguage: () => invoke<LanguageSettings>(CYPHERIA_IPC_CHANNELS.settingsLanguageRead),
    getWorkspaceLayout: () =>
      invoke<WorkspaceLayoutSettings>(CYPHERIA_IPC_CHANNELS.settingsWorkspaceLayoutRead),
    getPreferences: () => invoke<DesktopPreferences>(CYPHERIA_IPC_CHANNELS.settingsPreferencesRead),
    listOpenTargets: () => invoke<OpenTarget[]>(CYPHERIA_IPC_CHANNELS.settingsOpenTargetsList),
    listNotificationSounds: () =>
      invoke<string[]>(CYPHERIA_IPC_CHANNELS.settingsNotificationSoundsList),
    previewNotificationSound: () =>
      invoke<{ played: boolean }>(CYPHERIA_IPC_CHANNELS.settingsNotificationSoundPreview),
    listAppearanceFonts: () =>
      invoke<AppearanceFontOption[]>(CYPHERIA_IPC_CHANNELS.settingsAppearanceFontsList),
    onLanguageChanged: (handler) => {
      const listener = (_event: IpcRendererEvent, settings: LanguageSettings): void => {
        handler(LanguageSettingsSchema.parse(settings))
      }
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.settingsLanguageChanged, listener)
      return () => ipcRenderer.off(CYPHERIA_IPC_CHANNELS.settingsLanguageChanged, listener)
    },
    onPreferencesChanged: (handler) => {
      const listener = (_event: IpcRendererEvent, settings: DesktopPreferences): void => {
        handler(DesktopPreferencesSchema.parse(settings))
      }
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.settingsPreferencesChanged, listener)
      return () => ipcRenderer.off(CYPHERIA_IPC_CHANNELS.settingsPreferencesChanged, listener)
    },
    setAppearance: (settings) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsAppearanceWrite,
        settings
      ) as Promise<AppearanceSettings>,
    setConnectionProxy: (settings) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsConnectionProxyWrite,
        settings
      ) as Promise<ConnectionProxySettings>,
    setLanguage: (settings) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsLanguageWrite,
        settings
      ) as Promise<LanguageSettings>,
    setWorkspaceLayout: (settings) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsWorkspaceLayoutWrite,
        settings
      ) as Promise<WorkspaceLayoutSettings>,
    setPreferences: (settings) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsPreferencesWrite,
        settings
      ) as Promise<DesktopPreferences>,
    testConnectionProxy: (settings) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsConnectionProxyTest,
        settings
      ) as Promise<ConnectionProxyTestResult>,
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
