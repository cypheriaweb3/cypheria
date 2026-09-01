import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"
import type {
  AppearanceFontOption,
  AppearanceSettings,
  AppHealthStatus,
  AppMetadata,
  BrowserSessionOpenResult,
  CodexEventEnvelope,
  CypheriaPreloadApi,
  RuntimeInfo,
} from "../../ipc/src/index.js"
import { CYPHERIA_IPC_CHANNELS } from "../../ipc/src/index.js"

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  app: {
    platform: process.platform,
    getHealth: () => invoke<AppHealthStatus>(CYPHERIA_IPC_CHANNELS.appHealthCheck),
    getMetadata: () => invoke<AppMetadata>(CYPHERIA_IPC_CHANNELS.appMetadataRead),
  },
  browser: {
    openDapp: (url) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.browserSessionOpen, {
        url,
      }) as Promise<BrowserSessionOpenResult>,
  },
  codex: {
    onEvent: (handler) => {
      const listener = (_event: IpcRendererEvent, envelope: CodexEventEnvelope): void => {
        handler(envelope)
      }
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.codexEvent, listener)
      return () => {
        ipcRenderer.off(CYPHERIA_IPC_CHANNELS.codexEvent, listener)
      }
    },
  },
  runtime: {
    getInfo: () => invoke<RuntimeInfo>(CYPHERIA_IPC_CHANNELS.runtimeInfoRead),
  },
  settings: {
    getAppearance: () => invoke<AppearanceSettings>(CYPHERIA_IPC_CHANNELS.settingsAppearanceRead),
    listAppearanceFonts: () =>
      invoke<AppearanceFontOption[]>(CYPHERIA_IPC_CHANNELS.settingsAppearanceFontsList),
    setAppearance: (themes) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsAppearanceWrite,
        themes
      ) as Promise<AppearanceSettings>,
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
