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
  CodexInteractionEvent,
  ConnectionProxySettings,
  ConnectionProxyTestResult,
  CypheriaPreloadApi,
  HarnessEvent,
  LanguageSettings,
  RuntimeInfo,
  WorkspaceTerminalEvent,
} from "../../ipc/src/index.js"
import {
  AppearanceSettingsWriteSchema,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  CYPHERIA_IPC_CHANNELS,
  CYPHERIA_LANGUAGE_ARGUMENT_PREFIX,
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

const invoke = <T>(channel: string): Promise<T> => ipcRenderer.invoke(channel) as Promise<T>

const cypheriaApi: CypheriaPreloadApi = {
  bootstrap: {
    appearance: readBootstrapAppearance(),
    language: readBootstrapLanguage(),
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
    addMarketplace: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexMarketplaceAdd, input),
    cancelLogin: (loginId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAccountLoginCancel, { loginId }),
    getAccount: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAccountRead),
    getModelSettings: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexModelSettingsRead),
    getPermissionDefaults: () =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPermissionDefaultsRead),
    getPermissionsCatalog: (cwd) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPermissionsCatalogRead, {
        ...(cwd ? { cwd } : {}),
      }),
    interruptChat: (requestId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexChatInterrupt, { requestId }),
    steerChat: (requestId, input) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexChatSteer, { ...input, requestId }),
    listModels: (includeHidden) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexModelList, {
        ...(includeHidden === undefined ? {} : { includeHidden }),
      }),
    listPlugins: (options = {}) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPluginList, options),
    listProjects: (options = {}) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexProjectList, options),
    createProject: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexProjectCreate, input),
    updateProject: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexProjectUpdate, input),
    deleteProject: (id) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexProjectDelete, { id }),
    pickProjectRoot: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexProjectRootPick, {}),
    listApps: (forceRefetch = false) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAppList, { forceRefetch }),
    setAppEnabled: (appId, enabled) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAppEnabled, { appId, enabled }),
    connectApp: (appId) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAppConnect, { appId }),
    listMcp: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexMcpList, {}),
    addMcp: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexMcpAdd, input),
    setMcpEnabled: (name, enabled) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexMcpEnabled, { name, enabled }),
    loginMcp: (name) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexMcpLogin, { name }),
    readPlugin: (plugin) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPluginRead, plugin),
    listSkills: (options = {}) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexSkillList, options),
    listThreads: (options = {}) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadList, options),
    forkThread: (threadId, lastTurnId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadFork, {
        ...(lastTurnId ? { lastTurnId } : {}),
        threadId,
      }),
    readThread: (threadId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadRead, { threadId }),
    queueThreadMessage: (threadId, clientUserMessageId, input) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadQueueAdd, {
        ...input,
        clientUserMessageId,
        threadId,
      }),
    listThreadSections: (options = {}) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadSectionList, options),
    createThreadSection: (input) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadSectionCreate, input),
    updateThreadSection: (input) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadSectionUpdate, input),
    deleteThreadSection: (id) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadSectionDelete, { id }),
    moveThreadToSection: (input) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexThreadSectionMove, input),
    login: (request) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAccountLoginStart, request),
    retryAutoReviewDenial: (threadId, event) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexAutoReviewRetry, { event, threadId }),
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
    onInteraction: (handler) => {
      const listener = (_event: IpcRendererEvent, interaction: CodexInteractionEvent): void => {
        handler(interaction)
      }
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.codexInteractionEvent, listener)
      return () => {
        ipcRenderer.off(CYPHERIA_IPC_CHANNELS.codexInteractionEvent, listener)
      }
    },
    respondToInteraction: (response) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexInteractionRespond, response),
    setModelSettings: (settings) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexModelSettingsWrite, settings),
    setPermissionDefaults: (settings) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPermissionDefaultsWrite, settings),
    setShowFullAccess: (enabled) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPermissionsShowFullAccessWrite, { enabled }),
    openPermissionsConfig: () =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPermissionsConfigOpen),
    setPluginEnabled: (pluginId, enabled) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPluginEnabledWrite, { enabled, pluginId }),
    setSkillEnabled: (path, enabled) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexSkillEnabledWrite, { enabled, path }),
    installPlugin: (plugin) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPluginInstall, plugin),
    startChat: (request) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexChatStart, request),
    uninstallPlugin: (pluginId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexPluginUninstall, { pluginId }),
    removeMarketplace: (marketplaceName) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexMarketplaceRemove, { marketplaceName }),
    upgradeMarketplaces: (marketplaceName) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.codexMarketplaceUpgrade, {
        ...(marketplaceName ? { marketplaceName } : {}),
      }),
  },
  harnesses: {
    checkUpdate: (id) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessCheckUpdate, { id }),
    closeAllTerminals: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessTerminalCloseAll),
    closeTerminal: (terminalId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessTerminalClose, { terminalId }),
    install: (id) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessInstall, { id }),
    list: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessList),
    onEvent: (handler) => {
      const listener = (_event: IpcRendererEvent, harnessEvent: HarnessEvent): void =>
        handler(harnessEvent)
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.harnessEvent, listener)
      return () => ipcRenderer.off(CYPHERIA_IPC_CHANNELS.harnessEvent, listener)
    },
    openTerminal: (id, cwd) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessTerminalOpen, {
        ...(cwd ? { cwd } : {}),
        id,
      }),
    resizeTerminal: (terminalId, cols, rows) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessTerminalResize, { cols, rows, terminalId }),
    setEnabled: (id, enabled) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessEnabledWrite, { enabled, id }),
    update: (id) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessUpdate, { id }),
    writeTerminal: (terminalId, data) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.harnessTerminalWrite, { data, terminalId }),
  },
  workspaceTerminal: {
    closeAll: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.workspaceTerminalCloseAll),
    close: (terminalId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.workspaceTerminalClose, { terminalId }),
    onEvent: (handler) => {
      const listener = (_event: IpcRendererEvent, terminalEvent: WorkspaceTerminalEvent): void =>
        handler(terminalEvent)
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.workspaceTerminalEvent, listener)
      return () => ipcRenderer.off(CYPHERIA_IPC_CHANNELS.workspaceTerminalEvent, listener)
    },
    open: (projectId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.workspaceTerminalOpen, {
        ...(projectId ? { projectId } : {}),
      }),
    resize: (terminalId, cols, rows) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.workspaceTerminalResize, {
        cols,
        rows,
        terminalId,
      }),
    write: (terminalId, data) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.workspaceTerminalWrite, { data, terminalId }),
  },
  runtime: {
    getInfo: () => invoke<RuntimeInfo>(CYPHERIA_IPC_CHANNELS.runtimeInfoRead),
  },
  network: {
    addEndpoint: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkEndpointAdd, input),
    create: (input) => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkCreate, input),
    list: () => ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkList),
    probeEndpoint: (endpointId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkEndpointProbe, { endpointId }),
    remove: (networkId, confirmed) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkRemove, { confirmed, networkId }),
    removeEndpoint: (endpointId) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkEndpointRemove, { endpointId }),
    reorder: (networkIds) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkReorder, { networkIds }),
    reorderEndpoints: (networkId, endpointIds) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkEndpointReorder, {
        endpointIds,
        networkId,
      }),
    setEnabled: (networkId, enabled, expectedRevision) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkSetEnabled, {
        enabled,
        expectedRevision,
        networkId,
      }),
    setEndpointEnabled: (endpointId, enabled, expectedRevision) =>
      ipcRenderer.invoke(CYPHERIA_IPC_CHANNELS.networkEndpointSetEnabled, {
        enabled,
        endpointId,
        expectedRevision,
      }),
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
    getConnectionProxy: () =>
      invoke<ConnectionProxySettings>(CYPHERIA_IPC_CHANNELS.settingsConnectionProxyRead),
    getLanguage: () => invoke<LanguageSettings>(CYPHERIA_IPC_CHANNELS.settingsLanguageRead),
    listAppearanceFonts: () =>
      invoke<AppearanceFontOption[]>(CYPHERIA_IPC_CHANNELS.settingsAppearanceFontsList),
    onLanguageChanged: (handler) => {
      const listener = (_event: IpcRendererEvent, settings: LanguageSettings): void => {
        handler(LanguageSettingsSchema.parse(settings))
      }
      ipcRenderer.on(CYPHERIA_IPC_CHANNELS.settingsLanguageChanged, listener)
      return () => ipcRenderer.off(CYPHERIA_IPC_CHANNELS.settingsLanguageChanged, listener)
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
    testConnectionProxy: (settings) =>
      ipcRenderer.invoke(
        CYPHERIA_IPC_CHANNELS.settingsConnectionProxyTest,
        settings
      ) as Promise<ConnectionProxyTestResult>,
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
