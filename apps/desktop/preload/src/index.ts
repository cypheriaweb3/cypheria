import type { AppMetadata, CypheriaPreloadApi, RuntimeInfo } from "@cypheria/ipc"
import { contextBridge, ipcRenderer } from "electron"

const preloadChannels = {
  appMetadataRead: "app.metadata.read",
  runtimeInfoRead: "runtime.info.read",
} as const

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  app: {
    getMetadata: () => invoke<AppMetadata>(preloadChannels.appMetadataRead),
  },
  runtime: {
    getInfo: () => invoke<RuntimeInfo>(preloadChannels.runtimeInfoRead),
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
