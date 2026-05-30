import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"
import type {
  AppHealthStatus,
  AppMetadata,
  CodexEventEnvelope,
  CypheriaPreloadApi,
  RuntimeInfo,
} from "../../ipc/src/index.js"
import { CYPHERIA_IPC_CHANNELS } from "../../ipc/src/index.js"

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  app: {
    getHealth: () => invoke<AppHealthStatus>(CYPHERIA_IPC_CHANNELS.appHealthCheck),
    getMetadata: () => invoke<AppMetadata>(CYPHERIA_IPC_CHANNELS.appMetadataRead),
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
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
