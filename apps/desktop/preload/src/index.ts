import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"
import type {
  AppearanceFontOption,
  AppearanceSettings,
  AppHealthStatus,
  AppMetadata,
  AutomationTaskView,
  BrowserSessionOpenResult,
  CodexEventEnvelope,
  CypheriaPreloadApi,
  RuntimeInfo,
} from "../../ipc/src/index.js"
import {
  AppearanceSettingsWriteSchema,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  CYPHERIA_IPC_CHANNELS,
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

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  bootstrap: {
    appearance: readBootstrapAppearance(),
  },
  app: {
    platform: process.platform,
    getHealth: () => invoke<AppHealthStatus>(CYPHERIA_IPC_CHANNELS.appHealthCheck),
    getMetadata: () => invoke<AppMetadata>(CYPHERIA_IPC_CHANNELS.appMetadataRead),
  },
  automation: {
    createTask: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.automationTaskCreate, input),
    getRun: (runId) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.automationRunGet, { runId }),
    getTask: (taskId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.automationTaskGet, {
        taskId,
      }) as Promise<AutomationTaskView | undefined>,
    listRuns: (taskId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.automationRunList, {
        ...(taskId ? { taskId } : {}),
      }),
    listTasks: (status) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.automationTaskList, {
        ...(status ? { status } : {}),
      }),
    pauseTask: (taskId, expectedRevision) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.automationTaskPause, {
        ...(expectedRevision ? { expectedRevision } : {}),
        taskId,
      }),
    resumeTask: (taskId, expectedRevision) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.automationTaskResume, {
        ...(expectedRevision ? { expectedRevision } : {}),
        taskId,
      }),
    runTask: (taskId) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.automationRunStart, { taskId }),
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
    setAppearance: (settings) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsAppearanceWrite,
        settings
      ) as Promise<AppearanceSettings>,
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
