import type {
  AppHealthStatus,
  AppMetadata,
  CodexEventEnvelope,
  CypheriaPreloadApi,
  RuntimeInfo,
} from "@cypheria/ipc"
import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"

const preloadChannels = {
  appHealthCheck: "app.health.check",
  appMetadataRead: "app.metadata.read",
  codexEvent: "codex.event",
  runtimeInfoRead: "runtime.info.read",
} as const

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  app: {
    getHealth: () => invoke<AppHealthStatus>(preloadChannels.appHealthCheck),
    getMetadata: () => invoke<AppMetadata>(preloadChannels.appMetadataRead),
  },
  codex: {
    onEvent: (handler) => {
      const listener = (_event: IpcRendererEvent, envelope: CodexEventEnvelope): void => {
        handler(envelope)
      }
      ipcRenderer.on(preloadChannels.codexEvent, listener)
      return () => {
        ipcRenderer.off(preloadChannels.codexEvent, listener)
      }
    },
  },
  runtime: {
    getInfo: () => invoke<RuntimeInfo>(preloadChannels.runtimeInfoRead),
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
