import type { IpcRendererEvent } from "electron"
import { contextBridge, ipcRenderer } from "electron"
import type {
  AppearanceFontOption,
  AppearanceSettings,
  AppHealthStatus,
  AppMetadata,
  AutomationTaskView,
  BrowserSessionOpenResult,
  CodexChatEvent,
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
  approval: {
    decide: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.approvalRequestDecide, input),
    list: (status) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.approvalRequestsList, {
        ...(status ? { status } : {}),
      }),
  },
  audit: {
    list: (limit) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.auditLogList, { ...(limit ? { limit } : {}) }),
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
    cancelLogin: (loginId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAccountLoginCancel, { loginId }),
    getAccount: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAccountRead),
    getModelSettings: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexModelSettingsRead),
    interruptChat: (requestId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexChatInterrupt, { requestId }),
    listModels: (includeHidden) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexModelList, {
        ...(includeHidden === undefined ? {} : { includeHidden }),
      }),
    listThreads: (options = {}) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadList, options),
    login: (request) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAccountLoginStart, request),
    logout: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAccountLogout),
    onChatEvent: (handler) => {
      const listener = (_event: IpcRendererEvent, chatEvent: CodexChatEvent): void => {
        handler(chatEvent)
      }
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.codexChatEvent, listener)
      return () => {
        ipcRenderer.off(CYPHERIA_IPC_CHANNELS.codexChatEvent, listener)
      }
    },
    onEvent: (handler) => {
      const listener = (_event: IpcRendererEvent, envelope: CodexEventEnvelope): void => {
        handler(envelope)
      }
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.codexEvent, listener)
      return () => {
        ipcRenderer.off(CYPHERIA_IPC_CHANNELS.codexEvent, listener)
      }
    },
    setModelSettings: (settings) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexModelSettingsWrite, settings),
    startChat: (request) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexChatStart, request),
  },
  runtime: {
    getInfo: () => invoke<RuntimeInfo>(CYPHERIA_IPC_CHANNELS.runtimeInfoRead),
  },
  policy: {
    create: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.policyCreate, input),
    disable: (policyId, expectedRevision) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.policyDisable, { expectedRevision, policyId }),
    list: (input = {}) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.policyList, input),
    update: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.policyUpdate, input),
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
  wallet: {
    addWatch: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletAddWatch, input),
    clearActive: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletActiveClear),
    delete: (walletId) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletDelete, { walletId }),
    deriveHdAccount: (input) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletDeriveHdAccount, input),
    generateHd: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletGenerateHd, input),
    getActive: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletActiveRead),
    importHd: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletImportHd, input),
    importPrivateKey: (input) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletImportPrivateKey, input),
    list: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletList),
    lock: (walletId) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletLock, { walletId }),
    rename: (walletId, name) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletRename, { name, walletId }),
    reorder: (walletIds) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletReorder, { walletIds }),
    reorderAccounts: (walletId, walletAccountIds) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletReorderAccounts, {
        walletAccountIds,
        walletId,
      }),
    setActive: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletActiveWrite, input),
    unlock: (walletId) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.walletUnlock, { walletId }),
  },
}

contextBridge.exposeInMainWorld("cypheria", cypheriaApi)
