import type { AppHealthStatus, AppMetadata, CypheriaPreloadApi, RuntimeInfo } from "@cypheria/ipc"
import { contextBridge, ipcRenderer } from "electron"

const preloadChannels = {
  appHealthCheck: "app.health.check",
  appMetadataRead: "app.metadata.read",
  runtimeInfoRead: "runtime.info.read",
} as const

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  app: {
    getHealth: () => invoke<AppHealthStatus>(preloadChannels.appHealthCheck),
    getMetadata: () => invoke<AppMetadata>(preloadChannels.appMetadataRead),
  },
  runtime: {
    getInfo: () => invoke<RuntimeInfo>(preloadChannels.runtimeInfoRead),
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
