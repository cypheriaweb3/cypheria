import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { v2 } from "@cypheria/codex-bridge"
import { buildRuntimePaths, type EthereumNetworkApproval } from "@cypheria/runtime"
import {
  type WalletProviderResponse,
  walletProviderResponseSchema,
} from "@cypheria/wallet-provider"
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from "electron"
import {
  type AppearanceSettings,
  type AppearanceSettingsWrite,
  type AppHealthStatus,
  type AppMetadata,
  appHealthCheckContract,
  appMetadataReadContract,
  approvalRequestDecideContract,
  approvalRequestsListContract,
  auditLogListContract,
  automationRunGetContract,
  automationRunListContract,
  automationRunStartContract,
  automationTaskCreateContract,
  automationTaskGetContract,
  automationTaskListContract,
  automationTaskPauseContract,
  automationTaskResumeContract,
  browserSessionOpenContract,
  CYPHERIA_APPEARANCE_ARGUMENT_PREFIX,
  CYPHERIA_IPC_CHANNELS,
  CYPHERIA_LANGUAGE_ARGUMENT_PREFIX,
  codexAccountLoginCancelContract,
  codexAccountLoginStartContract,
  codexAccountLogoutContract,
  codexAccountReadContract,
  codexAppConnectContract,
  codexAppEnabledContract,
  codexAppListContract,
  codexAutoReviewRetryContract,
  codexChatInterruptContract,
  codexChatStartContract,
  codexChatSteerContract,
  codexInteractionRespondContract,
  codexMarketplaceAddContract,
  codexMarketplaceRemoveContract,
  codexMarketplaceUpgradeContract,
  codexMcpAddContract,
  codexMcpEnabledContract,
  codexMcpListContract,
  codexMcpLoginContract,
  codexModelListContract,
  codexModelSettingsReadContract,
  codexModelSettingsWriteContract,
  codexPermissionDefaultsReadContract,
  codexPermissionDefaultsWriteContract,
  codexPermissionsCatalogReadContract,
  codexPermissionsConfigOpenContract,
  codexPermissionsShowFullAccessWriteContract,
  codexPluginEnabledWriteContract,
  codexPluginInstallContract,
  codexPluginListContract,
  codexPluginReadContract,
  codexPluginUninstallContract,
  codexProjectCreateContract,
  codexProjectDeleteContract,
  codexProjectListContract,
  codexProjectRevealContract,
  codexProjectRootPickContract,
  codexProjectUpdateContract,
  codexSkillEnabledWriteContract,
  codexSkillListContract,
  codexThreadArchiveContract,
  codexThreadDeleteContract,
  codexThreadForkContract,
  codexThreadListContract,
  codexThreadProjectMoveContract,
  codexThreadQueueAddContract,
  codexThreadReadContract,
  codexThreadRenameContract,
  codexThreadSectionCreateContract,
  codexThreadSectionDeleteContract,
  codexThreadSectionListContract,
  codexThreadSectionMoveContract,
  codexThreadSectionUpdateContract,
  dappProviderRequestContract,
  harnessCheckUpdateContract,
  harnessEnabledWriteContract,
  harnessInstallContract,
  harnessListContract,
  harnessTerminalCloseAllContract,
  harnessTerminalCloseContract,
  harnessTerminalOpenContract,
  harnessTerminalResizeContract,
  harnessTerminalWriteContract,
  harnessUpdateContract,
  IPC_PROTOCOL_VERSION,
  networkCreateContract,
  networkEndpointAddContract,
  networkEndpointProbeContract,
  networkEndpointRemoveContract,
  networkEndpointReorderContract,
  networkEndpointSetEnabledContract,
  networkListContract,
  networkRemoveContract,
  networkReorderContract,
  networkSetEnabledContract,
  policyCreateContract,
  policyDisableContract,
  policyListContract,
  policyUpdateContract,
  type RuntimeInfo,
  runtimeInfoReadContract,
  settingsAppearanceFontsListContract,
  settingsAppearanceReadContract,
  settingsAppearanceWriteContract,
  settingsConnectionProxyReadContract,
  settingsConnectionProxyTestContract,
  settingsConnectionProxyWriteContract,
  settingsLanguageReadContract,
  settingsLanguageWriteContract,
  walletActiveClearContract,
  walletActiveReadContract,
  walletActiveWriteContract,
  walletAddWatchContract,
  walletDeleteContract,
  walletDeriveHdAccountContract,
  walletGenerateHdContract,
  walletImportHdContract,
  walletImportPrivateKeyContract,
  walletListContract,
  walletLockContract,
  walletRenameContract,
  walletReorderAccountsContract,
  walletReorderContract,
  walletUnlockContract,
  workspaceTerminalCloseAllContract,
  workspaceTerminalCloseContract,
  workspaceTerminalOpenContract,
  workspaceTerminalResizeContract,
  workspaceTerminalWriteContract,
} from "../../ipc/src/index.js"
import { readAppearanceSettings, writeAppearanceSettings } from "./appearance-config.js"
import { configureChromiumFeatures } from "./chromium-features.js"
import { resolveCodexCommand } from "./codex-command.js"
import {
  archiveCodexThread,
  cancelCodexLogin,
  createCodexProject,
  createCodexThreadSection,
  deleteCodexProject,
  deleteCodexThread,
  deleteCodexThreadSection,
  forkCodexThread,
  interruptCodexChat,
  listCodexModels,
  listCodexProjects,
  listCodexThreadSections,
  listCodexThreads,
  logoutCodexAccount,
  moveCodexThreadToProject,
  moveCodexThreadToSection,
  queueCodexThreadMessage,
  readCodexAccount,
  readCodexModelSettings,
  readCodexThread,
  renameCodexThread,
  startCodexChat,
  startCodexLogin,
  steerCodexChat,
  updateCodexProject,
  updateCodexThreadSection,
  validateOpenAiApiKey,
  writeCodexModelSettings,
} from "./codex-desktop.js"
import {
  addCodexMcp,
  listCodexApps,
  listCodexMcp,
  loginCodexMcp,
  openCodexAppConnection,
  setCodexAppEnabled,
  setCodexMcpEnabled,
} from "./codex-integrations.js"
import {
  listCodexPermissions,
  readCodexPermissionDefaults,
  writeCodexPermissionDefaults,
  writeShowFullAccess,
} from "./codex-permissions.js"
import {
  addCodexMarketplace,
  installCodexPlugin,
  listCodexPlugins,
  listCodexSkills,
  readCodexPlugin,
  removeCodexMarketplace,
  setCodexPluginEnabled,
  setCodexSkillEnabled,
  uninstallCodexPlugin,
  upgradeCodexMarketplaces,
} from "./codex-plugins.js"
import {
  applyConnectionProxyToSession,
  readConnectionProxySettings,
  testConnectionProxy,
  writeConnectionProxySettings,
} from "./connection-proxy.js"
import {
  createDappBrowserController,
  createElectronDappWebContentsFactory,
  type DappBrowserController,
} from "./dapp-browser.js"
import { createHarnessManager, type HarnessManager } from "./harness-manager.js"
import { registerIpcRoute } from "./ipc.js"
import { readLanguageSettings, writeLanguageSettings } from "./language-config.js"
import {
  type DesktopRuntimeContext,
  initializeDesktopRuntime,
  shutdownDesktopRuntime,
} from "./runtime.js"
import { listSystemFonts } from "./system-fonts.js"
import {
  createWorkspaceTerminalManager,
  type WorkspaceTerminalManager,
} from "./workspace-terminal-manager.js"

app.setName("Cypheria")

const isDevelopmentShell = process.env.CYPHERIA_DEVELOPMENT_SHELL === "1"
const isPackagedRuntime = app.isPackaged && !isDevelopmentShell

let mainWindow: BrowserWindow | null = null
let desktopRuntimeContext: DesktopRuntimeContext | null = null
let currentAppearanceSettings: AppearanceSettings | null = null
let proxySettingsUnderTest: import("../../ipc/src/index.js").ConnectionProxySettings | null = null
let harnessManager: HarnessManager | null = null
let workspaceTerminalManager: WorkspaceTerminalManager | null = null

const getCodexCommand = (): string =>
  resolveCodexCommand({
    isPackaged: isPackagedRuntime,
    override: process.env.CYPHERIA_CODEX_PATH,
    resourcesPath: process.resourcesPath,
  })
let dappBrowserController: DappBrowserController | null = null

const currentDir = dirname(fileURLToPath(import.meta.url))
const preloadPath = join(currentDir, "../preload/index.cjs")
const dappPreloadPath = join(currentDir, "../dapp-preload/index.cjs")
const rendererShellPath = join(currentDir, "../client/_shell.html")
const rendererClientDir = dirname(rendererShellPath)
const applicationIconPath = isPackagedRuntime
  ? join(process.resourcesPath, "icons/icon.png")
  : join(currentDir, "../../resources/icons/icon.png")

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
    scheme: "cypheria",
  },
])

const logFatalError = (error: unknown): void => {
  console.error("[cypheria:desktop] fatal error", error)
}

const authorizeEthereumNetwork = async (approval: EthereumNetworkApproval): Promise<boolean> => {
  const current = approval.currentNetwork
    ? `${approval.currentNetwork.name} (${approval.currentNetwork.chain.reference})`
    : "No current network"
  const target = approval.kind === "switch" ? approval.targetNetwork : approval.proposal.network
  const endpointHosts =
    approval.kind === "add"
      ? approval.proposal.endpoints.map(({ connection }) => new URL(connection.displayUrl).host)
      : []
  const details = [
    `Site: ${approval.origin}`,
    `Current: ${current}`,
    `Requested: ${target.name} (eip155:${target.chain.reference})`,
    ...(approval.kind === "add"
      ? [
          `Changed fields: ${approval.metadataChanges.join(", ") || "none"}`,
          `Verified RPC hosts: ${endpointHosts.join(", ") || "existing configuration"}`,
        ]
      : []),
  ]
  const result = await dialog.showMessageBox({
    buttons: ["Reject", approval.kind === "switch" ? "Switch network" : "Add network"],
    cancelId: 0,
    defaultId: 0,
    detail: details.join("\n"),
    message:
      approval.kind === "switch"
        ? "A dApp wants to switch its Ethereum network"
        : "A dApp wants to add an Ethereum network",
    noLink: true,
    title: "Cypheria network approval",
    type: "question",
  })
  return result.response === 1
}

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const buildPlaceholderHtml = (context: DesktopRuntimeContext): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cypheria</title>
    <style>
      :root {
        color-scheme: dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #101113;
        color: #ececec;
      }

      body {
        align-items: center;
        display: grid;
        min-height: 100vh;
        margin: 0;
        place-items: center;
      }

      main {
        display: grid;
        gap: 10px;
        max-width: 620px;
        padding: 24px;
      }

      h1 {
        font-size: 28px;
        font-weight: 650;
        letter-spacing: 0;
        margin: 0;
      }

      p {
        color: #b8b8b8;
        line-height: 1.6;
        margin: 0;
      }

      code {
        color: #d7e6ff;
        font-family: "SFMono-Regular", Consolas, monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Cypheria</h1>
      <p>Desktop runtime initialized.</p>
      <p>Cypheria home: <code>${escapeHtml(context.paths.cypheriaHome)}</code></p>
      <p>Codex home: <code>${escapeHtml(context.paths.codexHome)}</code></p>
    </main>
  </body>
</html>`

const getRendererUrl = (): string | undefined => {
  const rendererUrl = process.env.CYPHERIA_RENDERER_URL?.trim()
  return rendererUrl ? rendererUrl : undefined
}

const registerRendererProtocol = (): void => {
  protocol.handle("cypheria", (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const requestedPath = pathname === "/" ? "_shell.html" : pathname.replace(/^\/+/, "")
    const candidate = resolve(rendererClientDir, requestedPath)
    const isWithinRenderer = !relative(rendererClientDir, candidate).startsWith("..")
    const target = isWithinRenderer && existsSync(candidate) ? candidate : rendererShellPath
    return net.fetch(pathToFileURL(target).toString())
  })
}

const toRuntimeInfo = async (context: DesktopRuntimeContext): Promise<RuntimeInfo> => {
  const info = await context.runtime.request("runtime.info")
  const runtimeInfo = info as RuntimeInfo

  return {
    codex: context.codexAppServer
      ? {
          listenUrl: context.codexAppServer.listenUrl,
          state: context.codexAppServer.state,
        }
      : undefined,
    codexHome: runtimeInfo.codexHome,
    cypheriaHome: runtimeInfo.cypheriaHome,
    directories: runtimeInfo.directories,
  }
}

const registerIpcHandlers = (
  context: DesktopRuntimeContext,
  harnesses: HarnessManager,
  workspaceTerminals: WorkspaceTerminalManager
): void => {
  const appMetadata: AppMetadata = {
    name: app.getName(),
    version: app.getVersion(),
  }

  registerIpcRoute(appHealthCheckContract, (): AppHealthStatus => {
    return {
      checkedAt: new Date().toISOString(),
      protocolVersion: IPC_PROTOCOL_VERSION,
      status: "ok",
    }
  })
  registerIpcRoute(appMetadataReadContract, () => appMetadata)
  registerIpcRoute(auditLogListContract, ({ limit }) => context.audit.list({ limit }))
  registerIpcRoute(approvalRequestsListContract, ({ status }) =>
    context.signingIntents.listApprovals(status)
  )
  registerIpcRoute(
    approvalRequestDecideContract,
    ({ approvalId, decision, expectedRevision, reviewer }) =>
      context.signingIntents.decide(approvalId, { decision, expectedRevision, reviewer })
  )
  registerIpcRoute(walletListContract, () => context.wallets.listWallets())
  registerIpcRoute(networkListContract, () => context.networks.list())
  registerIpcRoute(networkCreateContract, (input) => context.networks.create(input))
  registerIpcRoute(networkSetEnabledContract, ({ enabled, expectedRevision, networkId }) =>
    context.networks.setEnabled(networkId, enabled, expectedRevision)
  )
  registerIpcRoute(networkRemoveContract, async ({ confirmed, networkId }) => {
    await context.networks.removeCustomNetwork(networkId, confirmed)
    return { completed: true }
  })
  registerIpcRoute(networkReorderContract, async ({ networkIds }) => {
    await context.networks.reorderNetworks(networkIds)
    return { completed: true }
  })
  registerIpcRoute(networkEndpointAddContract, ({ endpoint, networkId }) =>
    context.networks.addEndpoint(networkId, endpoint)
  )
  registerIpcRoute(networkEndpointProbeContract, ({ endpointId }) =>
    context.networks.probeEndpoint(endpointId)
  )
  registerIpcRoute(networkEndpointSetEnabledContract, ({ enabled, endpointId, expectedRevision }) =>
    context.networks.setEndpointEnabled(endpointId, enabled, expectedRevision)
  )
  registerIpcRoute(networkEndpointRemoveContract, async ({ endpointId }) => {
    await context.networks.removeEndpoint(endpointId)
    return { completed: true }
  })
  registerIpcRoute(networkEndpointReorderContract, async ({ endpointIds, networkId }) => {
    await context.networks.reorderEndpoints(networkId, endpointIds)
    return { completed: true }
  })
  registerIpcRoute(walletActiveReadContract, () => context.wallets.getActiveContext())
  registerIpcRoute(walletActiveWriteContract, (input) => context.wallets.setActiveContext(input))
  registerIpcRoute(walletActiveClearContract, async () => {
    await context.wallets.clearActiveContext()
    return { cleared: true }
  })
  registerIpcRoute(walletGenerateHdContract, (input) => context.wallets.generateHdWallet(input))
  registerIpcRoute(walletDeriveHdAccountContract, (input) => context.wallets.deriveHdAccount(input))
  registerIpcRoute(walletImportHdContract, (input) => context.wallets.importHdWallet(input))
  registerIpcRoute(walletImportPrivateKeyContract, (input) =>
    context.wallets.importPrivateKeyWallet(input)
  )
  registerIpcRoute(walletAddWatchContract, (input) => context.wallets.addWatchWallet(input))
  registerIpcRoute(walletRenameContract, ({ name, walletId }) =>
    context.wallets.renameWallet(walletId, name)
  )
  registerIpcRoute(walletReorderContract, async ({ walletIds }) => {
    await context.wallets.reorderWallets(walletIds)
    return { reordered: true }
  })
  registerIpcRoute(walletReorderAccountsContract, async ({ walletAccountIds, walletId }) => {
    await context.wallets.reorderWalletAccounts(walletId, walletAccountIds)
    return { reordered: true }
  })
  registerIpcRoute(walletDeleteContract, async ({ walletId }) => {
    await context.wallets.deleteWallet(walletId)
    return { deleted: true }
  })
  registerIpcRoute(walletLockContract, async ({ walletId }) => {
    const wallet = await context.wallets.getWallet(walletId)
    if (!wallet || !("vaultId" in wallet.wallet))
      throw new Error("The wallet does not have a local vault.")
    context.vault.lock(wallet.wallet.vaultId)
    return { unlocked: false, walletId }
  })
  registerIpcRoute(walletUnlockContract, async ({ walletId }) => {
    const wallet = await context.wallets.getWallet(walletId)
    if (!wallet || !("vaultId" in wallet.wallet))
      throw new Error("The wallet does not have a local vault.")
    await context.vault.unlock(wallet.wallet.vaultId)
    return { unlocked: true, walletId }
  })
  registerIpcRoute(policyListContract, (input) => context.policies.list(input))
  registerIpcRoute(policyCreateContract, (input) => context.policies.create(input))
  registerIpcRoute(policyUpdateContract, ({ policyId, ...input }) =>
    context.policies.update(policyId, input)
  )
  registerIpcRoute(policyDisableContract, ({ expectedRevision, policyId }) =>
    context.policies.disable(policyId, expectedRevision)
  )
  const codexBridge = () => {
    const bridge = context.codexAppServer?.bridge
    if (!bridge) throw new Error("Codex App Server is unavailable.")
    return bridge
  }
  registerIpcRoute(codexAccountReadContract, () => readCodexAccount(codexBridge()))
  registerIpcRoute(codexAutoReviewRetryContract, async ({ event, threadId }) => {
    await codexBridge().request<
      "thread/approveGuardianDeniedAction",
      v2.ThreadApproveGuardianDeniedActionResponse
    >("thread/approveGuardianDeniedAction", { event, threadId })
    return { accepted: true }
  })
  registerIpcRoute(codexAccountLoginStartContract, async (request) => {
    const result = await startCodexLogin(codexBridge(), request, (apiKey) =>
      validateOpenAiApiKey(apiKey, session.defaultSession.fetch.bind(session.defaultSession))
    )
    const loginUrl = result.type === "chatgpt" ? result.authUrl : undefined
    if (loginUrl) await shell.openExternal(loginUrl)
    return result
  })
  registerIpcRoute(codexAccountLoginCancelContract, async ({ loginId }) => ({
    cancelled: await cancelCodexLogin(codexBridge(), loginId),
  }))
  registerIpcRoute(codexAccountLogoutContract, async () => {
    await logoutCodexAccount(codexBridge())
    return { loggedOut: true }
  })
  registerIpcRoute(codexModelListContract, ({ includeHidden }) =>
    listCodexModels(codexBridge(), includeHidden)
  )
  registerIpcRoute(codexModelSettingsReadContract, () => readCodexModelSettings(codexBridge()))
  registerIpcRoute(codexModelSettingsWriteContract, (settings) =>
    writeCodexModelSettings(codexBridge(), settings)
  )
  registerIpcRoute(codexPermissionDefaultsReadContract, () =>
    readCodexPermissionDefaults(codexBridge(), context.paths.codexHome)
  )
  registerIpcRoute(codexPermissionDefaultsWriteContract, (settings) =>
    writeCodexPermissionDefaults(codexBridge(), context.paths.codexHome, settings)
  )
  registerIpcRoute(codexPermissionsCatalogReadContract, ({ cwd }) =>
    listCodexPermissions(codexBridge(), context.paths.codexHome, cwd)
  )
  registerIpcRoute(codexPermissionsConfigOpenContract, async () => {
    const configPath = join(context.paths.codexHome, "config.toml")
    await mkdir(context.paths.codexHome, { recursive: true })
    await writeFile(configPath, "", { flag: "a" })
    const result = await shell.openPath(configPath)
    if (result) throw new Error(result)
    return { opened: true }
  })
  registerIpcRoute(codexPermissionsShowFullAccessWriteContract, async ({ enabled }) => {
    await writeShowFullAccess(codexBridge(), enabled)
    return listCodexPermissions(codexBridge(), context.paths.codexHome)
  })
  registerIpcRoute(codexThreadListContract, (options) => listCodexThreads(codexBridge(), options))
  registerIpcRoute(codexThreadArchiveContract, ({ threadId }) =>
    archiveCodexThread(codexBridge(), threadId)
  )
  registerIpcRoute(codexThreadDeleteContract, ({ threadId }) =>
    deleteCodexThread(codexBridge(), threadId)
  )
  registerIpcRoute(codexThreadForkContract, ({ lastTurnId, threadId }) =>
    forkCodexThread(codexBridge(), threadId, lastTurnId)
  )
  registerIpcRoute(codexThreadReadContract, ({ threadId }) =>
    readCodexThread(codexBridge(), threadId)
  )
  registerIpcRoute(codexThreadRenameContract, ({ name, threadId }) =>
    renameCodexThread(codexBridge(), threadId, name)
  )
  registerIpcRoute(codexThreadProjectMoveContract, ({ projectId, threadId }) =>
    moveCodexThreadToProject(codexBridge(), threadId, projectId)
  )
  registerIpcRoute(codexThreadSectionListContract, (options) =>
    listCodexThreadSections(codexBridge(), options)
  )
  registerIpcRoute(codexThreadSectionCreateContract, ({ name }) =>
    createCodexThreadSection(codexBridge(), name)
  )
  registerIpcRoute(codexThreadSectionUpdateContract, (input) =>
    updateCodexThreadSection(codexBridge(), input)
  )
  registerIpcRoute(codexThreadSectionDeleteContract, ({ id }) =>
    deleteCodexThreadSection(codexBridge(), id)
  )
  registerIpcRoute(codexThreadSectionMoveContract, (input) =>
    moveCodexThreadToSection(codexBridge(), input)
  )
  registerIpcRoute(codexProjectListContract, (options) => listCodexProjects(codexBridge(), options))
  registerIpcRoute(codexProjectCreateContract, (input) => createCodexProject(codexBridge(), input))
  registerIpcRoute(codexProjectUpdateContract, (input) => updateCodexProject(codexBridge(), input))
  registerIpcRoute(codexProjectDeleteContract, ({ id }) => deleteCodexProject(codexBridge(), id))
  registerIpcRoute(codexProjectRevealContract, async ({ id }) => {
    const page = await listCodexProjects(codexBridge(), { limit: 100 })
    const project = page.data.find((candidate) => candidate.id === id)
    const root = project?.roots[0]
    if (!root) throw new Error("Project folder is unavailable.")
    shell.showItemInFolder(root)
    return { revealed: true }
  })
  registerIpcRoute(codexProjectRootPickContract, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose a project folder",
    })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
  registerIpcRoute(codexPluginListContract, (options) => listCodexPlugins(codexBridge(), options))
  registerIpcRoute(codexPluginReadContract, (options) => readCodexPlugin(codexBridge(), options))
  registerIpcRoute(codexAppListContract, ({ forceRefetch }) =>
    listCodexApps(codexBridge(), forceRefetch)
  )
  registerIpcRoute(codexAppEnabledContract, ({ appId, enabled }) =>
    setCodexAppEnabled(codexBridge(), appId, enabled)
  )
  registerIpcRoute(codexAppConnectContract, ({ appId }) =>
    openCodexAppConnection(codexBridge(), appId, (url) => shell.openExternal(url))
  )
  registerIpcRoute(codexMcpListContract, () => listCodexMcp(codexBridge()))
  registerIpcRoute(codexMcpEnabledContract, ({ name, enabled }) =>
    setCodexMcpEnabled(codexBridge(), name, enabled)
  )
  registerIpcRoute(codexMcpLoginContract, ({ name }) =>
    loginCodexMcp(codexBridge(), name, (url) => shell.openExternal(url))
  )
  registerIpcRoute(codexMcpAddContract, (input) => addCodexMcp(codexBridge(), input))
  registerIpcRoute(codexPluginInstallContract, (plugin) =>
    installCodexPlugin(codexBridge(), plugin)
  )
  registerIpcRoute(codexPluginUninstallContract, ({ pluginId }) =>
    uninstallCodexPlugin(codexBridge(), pluginId)
  )
  registerIpcRoute(codexPluginEnabledWriteContract, ({ enabled, pluginId }) =>
    setCodexPluginEnabled(codexBridge(), pluginId, enabled)
  )
  registerIpcRoute(codexSkillListContract, (options) => listCodexSkills(codexBridge(), options))
  registerIpcRoute(codexSkillEnabledWriteContract, ({ enabled, path }) =>
    setCodexSkillEnabled(codexBridge(), path, enabled)
  )
  registerIpcRoute(codexMarketplaceAddContract, (input) =>
    addCodexMarketplace(codexBridge(), input)
  )
  registerIpcRoute(codexMarketplaceUpgradeContract, ({ marketplaceName }) =>
    upgradeCodexMarketplaces(codexBridge(), marketplaceName)
  )
  registerIpcRoute(codexMarketplaceRemoveContract, ({ marketplaceName }) =>
    removeCodexMarketplace(codexBridge(), marketplaceName)
  )
  registerIpcRoute(codexChatStartContract, (request, event) => {
    const server = context.codexAppServer
    if (!server) throw new Error("Codex app-server is unavailable")
    return {
      requestId: startCodexChat(
        server.bridge,
        event.sender,
        request,
        server.dynamicTools.getSpecs()
      ),
    }
  })
  registerIpcRoute(codexChatInterruptContract, async ({ requestId }) => ({
    interrupted: await interruptCodexChat(requestId),
  }))
  registerIpcRoute(codexChatSteerContract, async ({ files, requestId, text }) => ({
    steered: await steerCodexChat(requestId, { files, text }),
  }))
  registerIpcRoute(
    codexThreadQueueAddContract,
    async ({ clientUserMessageId, files, text, threadId }) => ({
      queuedSubmissionId: await queueCodexThreadMessage(
        codexBridge(),
        threadId,
        clientUserMessageId,
        { files, text }
      ),
    })
  )
  registerIpcRoute(codexInteractionRespondContract, async (response) => {
    const server = context.codexAppServer
    if (!server) throw new Error("Codex app-server is unavailable")
    await server.interactions.respond(response)
    await context.audit.append({
      actor: "user",
      correlationId: response.interactionId,
      eventType: "codex.interaction.resolved",
      payloadSummary: `Codex interaction resolved with ${response.action}.`,
      source: "desktop",
    })
    return { resolved: true }
  })
  registerIpcRoute(automationTaskCreateContract, (input) => context.automation.createTask(input))
  registerIpcRoute(automationTaskListContract, ({ status }) => context.automation.listTasks(status))
  registerIpcRoute(automationTaskGetContract, ({ taskId }) => context.automation.getTask(taskId))
  registerIpcRoute(automationTaskPauseContract, ({ expectedRevision, taskId }) =>
    context.automation.pauseTask(taskId, expectedRevision)
  )
  registerIpcRoute(automationTaskResumeContract, ({ expectedRevision, taskId }) =>
    context.automation.resumeTask(taskId, expectedRevision)
  )
  registerIpcRoute(automationRunStartContract, ({ taskId }) => context.automation.runTask(taskId))
  registerIpcRoute(automationRunGetContract, ({ runId }) => context.automation.getRun(runId))
  registerIpcRoute(automationRunListContract, ({ taskId }) => context.automation.listRuns(taskId))
  registerIpcRoute(browserSessionOpenContract, ({ url }) => {
    if (!dappBrowserController) throw new Error("The dApp browser is unavailable.")
    return dappBrowserController.open(url)
  })
  registerIpcRoute(dappProviderRequestContract, async (request, event) => {
    if (!dappBrowserController) throw new Error("The dApp browser is unavailable.")
    return dappBrowserController.routeProviderRequest(
      event.sender.id,
      event.sender.getURL(),
      request
    )
  })
  registerIpcRoute(runtimeInfoReadContract, () => toRuntimeInfo(context))
  registerIpcRoute(settingsAppearanceReadContract, () =>
    readAppearanceSettings(context.paths.codexHome)
  )
  registerIpcRoute(settingsAppearanceFontsListContract, () => listSystemFonts())
  registerIpcRoute(settingsAppearanceWriteContract, async (settings) => {
    const savedSettings = await writeAppearanceSettings(context.paths.codexHome, settings)
    currentAppearanceSettings = savedSettings
    applyNativeAppearance(mainWindow, savedSettings)
    return savedSettings
  })
  registerIpcRoute(settingsLanguageReadContract, () =>
    readLanguageSettings(context.paths.codexHome, app.getPreferredSystemLanguages())
  )
  registerIpcRoute(settingsLanguageWriteContract, async (settings) => {
    const savedSettings = await writeLanguageSettings(
      context.paths.codexHome,
      settings,
      app.getPreferredSystemLanguages()
    )
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(CYPHERIA_IPC_CHANNELS.settingsLanguageChanged, savedSettings)
    }
    return savedSettings
  })
  registerIpcRoute(settingsConnectionProxyReadContract, () => context.connectionProxySettings)
  registerIpcRoute(settingsConnectionProxyTestContract, async (settings) => {
    const testSession = session.fromPartition(`proxy-test-${randomUUID()}`, { cache: false })
    proxySettingsUnderTest = settings
    try {
      return await testConnectionProxy(testSession, settings)
    } finally {
      proxySettingsUnderTest = null
      await testSession.clearStorageData()
    }
  })
  registerIpcRoute(settingsConnectionProxyWriteContract, async (settings) => {
    const saved = await writeConnectionProxySettings(context.paths.configDir, settings)
    await applyConnectionProxyToSession(session.defaultSession, saved)
    await context.restartCodexAppServer(saved)
    return saved
  })
  registerIpcRoute(harnessListContract, () => harnesses.list())
  registerIpcRoute(harnessCheckUpdateContract, ({ id }) => harnesses.checkUpdate(id))
  registerIpcRoute(harnessInstallContract, ({ id }) => harnesses.install(id))
  registerIpcRoute(harnessUpdateContract, ({ id }) => harnesses.install(id))
  registerIpcRoute(harnessEnabledWriteContract, ({ enabled, id }) =>
    harnesses.setEnabled(id, enabled)
  )
  registerIpcRoute(harnessTerminalOpenContract, ({ cwd, id }) => harnesses.openTerminal(id, cwd))
  registerIpcRoute(harnessTerminalWriteContract, ({ data, terminalId }) =>
    harnesses.writeTerminal(terminalId, data)
  )
  registerIpcRoute(harnessTerminalResizeContract, ({ cols, rows, terminalId }) =>
    harnesses.resizeTerminal(terminalId, cols, rows)
  )
  registerIpcRoute(harnessTerminalCloseContract, ({ terminalId }) =>
    harnesses.closeTerminal(terminalId)
  )
  registerIpcRoute(harnessTerminalCloseAllContract, () => harnesses.closeAllTerminals())
  registerIpcRoute(workspaceTerminalOpenContract, async ({ projectId }) => {
    let cwd: string | undefined
    if (projectId) {
      const projects = await listCodexProjects(codexBridge(), { limit: 100 })
      const project = projects.data.find((candidate) => candidate.id === projectId)
      if (!project?.roots[0]) throw new Error("The selected project is unavailable.")
      cwd = project.roots[0]
    }
    return workspaceTerminals.openTerminal(cwd)
  })
  registerIpcRoute(workspaceTerminalWriteContract, ({ data, terminalId }) =>
    workspaceTerminals.writeTerminal(terminalId, data)
  )
  registerIpcRoute(workspaceTerminalResizeContract, ({ cols, rows, terminalId }) =>
    workspaceTerminals.resizeTerminal(terminalId, cols, rows)
  )
  registerIpcRoute(workspaceTerminalCloseContract, ({ terminalId }) =>
    workspaceTerminals.closeTerminal(terminalId)
  )
  registerIpcRoute(workspaceTerminalCloseAllContract, () => workspaceTerminals.closeAllTerminals())
}

const toAppearanceBootstrap = (settings: AppearanceSettings): AppearanceSettingsWrite => {
  const { configPath: _, ...appearance } = settings
  return appearance
}

const resolveNativeThemeMode = (settings: AppearanceSettings): "dark" | "light" => {
  if (settings.theme !== "system") {
    return settings.theme
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

const getActiveChromeTheme = (settings: AppearanceSettings) =>
  resolveNativeThemeMode(settings) === "dark" ? settings.darkTheme : settings.lightTheme

const applyNativeAppearance = (
  window: BrowserWindow | null,
  settings: AppearanceSettings
): void => {
  nativeTheme.themeSource = settings.theme
  if (!window || window.isDestroyed()) {
    return
  }

  const activeTheme = getActiveChromeTheme(settings)
  window.setBackgroundColor(activeTheme.surface)
  if (process.platform === "win32") {
    window.setTitleBarOverlay({ color: activeTheme.surface, symbolColor: activeTheme.ink })
  }
}

const refreshNativeWindowChrome = (): void => {
  if (!currentAppearanceSettings || !mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const activeTheme = getActiveChromeTheme(currentAppearanceSettings)
  mainWindow.setBackgroundColor(activeTheme.surface)
  if (process.platform === "win32") {
    mainWindow.setTitleBarOverlay({ color: activeTheme.surface, symbolColor: activeTheme.ink })
  }
}

const registerDeveloperContextMenu = (window: BrowserWindow): void => {
  if (isPackagedRuntime) {
    return
  }

  window.webContents.on("context-menu", (_event, params) => {
    const inspectElement = (): void => {
      if (!window.isDestroyed()) {
        window.webContents.inspectElement(params.x, params.y)
      }
    }

    Menu.buildFromTemplate([
      {
        click: () => {
          if (window.webContents.isDevToolsOpened()) {
            inspectElement()
            return
          }

          window.webContents.once("devtools-opened", inspectElement)
          window.webContents.openDevTools({ activate: true, mode: "detach" })
        },
        label: "Inspect",
      },
    ]).popup({ window })
  })
}

const createMainWindow = async (context: DesktopRuntimeContext): Promise<BrowserWindow> => {
  const appearance = await readAppearanceSettings(context.paths.codexHome)
  const language = await readLanguageSettings(
    context.paths.codexHome,
    app.getPreferredSystemLanguages()
  )
  currentAppearanceSettings = appearance
  nativeTheme.themeSource = appearance.theme
  const activeTheme = getActiveChromeTheme(appearance)
  const appearanceArgument = `${CYPHERIA_APPEARANCE_ARGUMENT_PREFIX}${encodeURIComponent(
    JSON.stringify(toAppearanceBootstrap(appearance))
  )}`
  const languageArgument = `${CYPHERIA_LANGUAGE_ARGUMENT_PREFIX}${encodeURIComponent(
    JSON.stringify({ locale: language.locale, preference: language.preference })
  )}`
  const window = new BrowserWindow({
    backgroundColor: activeTheme.surface,
    ...(process.platform === "linux"
      ? { darkTheme: resolveNativeThemeMode(appearance) === "dark" }
      : {}),
    height: 860,
    icon: applicationIconPath,
    minHeight: 640,
    minWidth: 960,
    show: false,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 15 },
        }
      : process.platform === "win32"
        ? {
            titleBarOverlay: {
              color: activeTheme.surface,
              symbolColor: activeTheme.ink,
            },
            titleBarStyle: "hidden" as const,
          }
        : {}),
    title: "Cypheria",
    webPreferences: {
      additionalArguments: [appearanceArgument, languageArgument],
      contextIsolation: true,
      defaultFontSize: appearance.uiFontSize,
      defaultMonospaceFontSize: appearance.codeFontSize,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
    width: 1280,
  })

  registerDeveloperContextMenu(window)

  dappBrowserController = createDappBrowserController({
    createWebContents: createElectronDappWebContentsFactory(window),
    preloadPath: dappPreloadPath,
    requestRuntime: async (request) => {
      try {
        const runtimeMethod =
          request.method.startsWith("solana:") || request.method.startsWith("standard:")
            ? "dapp.solana-provider-request"
            : "dapp.provider-request"
        return walletProviderResponseSchema.parse(
          await context.runtime.request(runtimeMethod, request)
        ) as WalletProviderResponse
      } catch {
        return {
          error: { code: 4900, message: "The wallet provider runtime is unavailable." },
          id: request.id,
        }
      }
    },
    sessions: context.dappSessions,
  })

  window.once("ready-to-show", () => {
    window.show()
  })

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null
      dappBrowserController = null
    }
  })

  const rendererUrl = getRendererUrl()
  if (rendererUrl) {
    await window.loadURL(rendererUrl)
  } else if (existsSync(rendererShellPath)) {
    await window.loadURL("cypheria://app/")
  } else {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildPlaceholderHtml(context))}`
    )
  }

  if (!window.isVisible()) {
    window.show()
  }

  return window
}

const registerLifecycleHandlers = (): void => {
  nativeTheme.on("updated", refreshNativeWindowChrome)

  app.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return
    const settings = proxySettingsUnderTest ?? desktopRuntimeContext?.connectionProxySettings
    if (settings?.mode !== "manual" || (!settings.username && !settings.password)) return
    event.preventDefault()
    callback(settings.username, settings.password)
  })

  app.on("second-instance", () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
  })

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      desktopRuntimeContext ??= await initializeDesktopRuntime({
        clientVersion: app.getVersion(),
        codexAppServer: {
          codexCommand: getCodexCommand(),
          windows: () => BrowserWindow.getAllWindows(),
        },
        ethereumProvider: { networkAuthorizer: authorizeEthereumNetwork },
      })
      mainWindow = await createMainWindow(desktopRuntimeContext)
    }
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.on("before-quit", () => {
    harnessManager?.closeAllTerminals()
    workspaceTerminalManager?.closeAllTerminals()
    if (!desktopRuntimeContext) {
      return
    }

    void shutdownDesktopRuntime(desktopRuntimeContext).catch(logFatalError)
  })
}

const startDesktopApp = async (): Promise<void> => {
  configureChromiumFeatures(app.commandLine)
  const runtimePaths = buildRuntimePaths()
  await mkdir(runtimePaths.browserDir, { recursive: true })
  app.setPath("userData", runtimePaths.browserDir)

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  registerLifecycleHandlers()

  await app.whenReady()
  if (process.platform === "darwin") {
    app.dock?.setIcon(applicationIconPath)
  }
  registerRendererProtocol()
  const proxySettings = await readConnectionProxySettings(runtimePaths.configDir)
  await applyConnectionProxyToSession(session.defaultSession, proxySettings)
  desktopRuntimeContext = await initializeDesktopRuntime({
    clientVersion: app.getVersion(),
    codexAppServer: {
      codexCommand: getCodexCommand(),
      windows: () => BrowserWindow.getAllWindows(),
    },
    ethereumProvider: { networkAuthorizer: authorizeEthereumNetwork },
  })
  harnessManager = createHarnessManager({
    cypheriaHome: desktopRuntimeContext.paths.cypheriaHome,
    getProxySettings: () => desktopRuntimeContext?.connectionProxySettings ?? { mode: "system" },
    onEvent: (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(CYPHERIA_IPC_CHANNELS.harnessEvent, event)
      }
    },
  })
  workspaceTerminalManager = createWorkspaceTerminalManager({
    onEvent: (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(CYPHERIA_IPC_CHANNELS.workspaceTerminalEvent, event)
      }
    },
  })
  await harnessManager.readState()
  registerIpcHandlers(desktopRuntimeContext, harnessManager, workspaceTerminalManager)
  mainWindow = await createMainWindow(desktopRuntimeContext)
}

process.on("uncaughtException", logFatalError)
process.on("unhandledRejection", logFatalError)

void startDesktopApp().catch((error: unknown) => {
  logFatalError(error)
  if (app.isReady()) {
    app.quit()
  } else {
    app.exit(1)
  }
})
