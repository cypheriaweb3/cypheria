import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access } from "node:fs/promises"
import type { Server as HttpServer } from "node:http"
import { homedir, hostname } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import {
  applyDatabaseMigrations,
  createAgentRegistryPersistenceService,
  createCodeReviewPersistenceService,
  createPluginMarketplacePersistenceService,
  createProjectThreadPersistenceService,
  createSchedulePersistenceService,
  createThreadAttachmentPersistenceService,
  createThreadId,
  createThreadLifecyclePersistenceService,
  createThreadMessageRequestPersistenceService,
  createThreadTimelinePersistenceService,
  type OpenDatabaseResult,
  openCypheriaDatabase,
  PINNED_SECTION_ID,
} from "@cypheria/db"
import {
  type AgentManagementClientMessage,
  type BrowserClientMessage,
  type BrowserServerMessage,
  type ClientKind,
  type ClientMessage,
  type CodeReviewClientMessage,
  type CodeReviewServerMessage,
  type CodexHarnessClientMessage,
  type CodexHarnessServerMessage,
  CYPHERIA_PROTOCOL_VERSION,
  CYPHERIA_WEBSOCKET_PROTOCOL,
  type CypheriaBinaryFrame,
  encodeFileTransferFrame,
  FILE_TRANSFER_MAX_DATA_BYTES,
  type GitClientMessage,
  type GitServerMessage,
  type HarnessClientMessage,
  type IntegrationClientMessage,
  type IntegrationServerMessage,
  type MagpieClientMessage,
  type MagpieServerMessage,
  type McpAppClientMessage,
  type McpAppServerMessage,
  type NetworkProxySettings,
  type NetworkProxySnapshot,
  type NetworkProxyTestResult,
  type PersistedServerConfigPatch,
  type ProjectThreadClientMessage,
  type RelayPairingOfferResponse,
  type ScheduleClientMessage,
  type ScheduleServerMessage,
  SERVER_CAPABILITIES,
  type ServerConfigSnapshot,
  type ServerDiagnostics,
  type ServerIdentity,
  type ServerMessage,
  type ServerOperationalState,
  type ServerStatus,
  type TerminalClientMessage,
  type TerminalServerMessage,
  type ThreadClientMessage,
  type ThreadConfig,
  ThreadConfigSchema,
  type Web3ClientMessage,
  type Web3ServerMessage,
} from "@cypheria/protocol"
import type { v2 } from "@cypheria/protocol/codex-types"
import { serve } from "@hono/node-server"
import pino, { type Logger } from "pino"
import { type WebSocket, WebSocketServer } from "ws"
import { AgentManager } from "./agent/agent-manager.js"
import { CYPHERIA_RENDERING_CAPABILITIES } from "./agent/codex-developer-instructions.js"
import { mapCodexInput } from "./agent/managed-thread-adapter.js"
import { AutomationTool } from "./app-tools/automation.js"
import { type AppToolGrant, AppToolGrants, codexCallerSessionIds } from "./app-tools/grants.js"
import { HandoffService } from "./app-tools/handoff.js"
import {
  type AppToolAgent,
  type AppToolMcpResult,
  type AppToolMcpTool,
  AppToolService,
  toMcpResult,
} from "./app-tools/service.js"
import { BrowserToolsService } from "./browser-tools/service.js"
import { browserToolSpecs } from "./browser-tools/tools.js"
import { CodeReviewBackend } from "./code-review/backend.js"
import { ChatGptSession } from "./code-review/chatgpt-session.js"
import { CodeReviewHostService } from "./code-review/host-service.js"
import { PrivateReviews } from "./code-review/private-reviews.js"
import { accountKey, CODE_REVIEW_APP_URI, CODE_REVIEW_SERVER } from "./code-review/schemas.js"
import { CodeReviewTools } from "./code-review/tools.js"
import { CodexHarnessService } from "./codex-harness-service.js"
import { type CypheriaServerConfig, loadServerConfig } from "./config.js"
import { collectDiagnostics } from "./diagnostics.js"
import { GitService } from "./git/git-service.js"
import { HarnessService } from "./harness-service.js"
import { createHttpApp, type HttpAppHost } from "./http-app.js"
import { loadOrCreateServerId } from "./identity.js"
import { bundledMarketplaceDirectory } from "./integration/plugin-utils.js"
import { IntegrationService } from "./integration-service.js"
import { MagpieManager } from "./magpie/magpie-manager.js"
import { MagpieService } from "./magpie/magpie-service.js"
import { McpAppService, readCodeReviewAppHtml } from "./mcp-apps/service.js"
import { NetworkProxyStore } from "./network-proxy-store.js"
import { ProjectThreadService } from "./project-thread-service.js"
import { RelayConnection } from "./relay-connection.js"
import { loadOrCreateRelayKeyPair } from "./relay-key.js"
import {
  CypheriaRuntime,
  type CypheriaRuntimeEvent,
  type CypheriaRuntimeMethod,
} from "./runtime/index.js"
import { ScheduleService } from "./schedule/schedule-service.js"
import { ServerConfigStore } from "./server-config-store.js"
import type { SessionTransport } from "./session/client-session.js"
import { ConnectionRegistry } from "./session/connection-registry.js"
import { TerminalManager } from "./terminal/terminal-manager.js"
import { ComposerReferenceService } from "./thread/composer-reference-service.js"
import { InputFileService } from "./thread/input-file-service.js"
import {
  isManagedProjectlessWorkspace,
  projectlessOutputsDirectory,
} from "./thread/projectless-workspace.js"
import {
  type ThreadAttachmentClientMessage,
  ThreadAttachmentService,
} from "./thread/thread-attachment-service.js"
import { ThreadManager } from "./thread/thread-manager.js"
import { WorkspaceFileError, WorkspaceFileService } from "./thread/workspace-file-service.js"
import { CYPHERIA_SERVER_VERSION } from "./version.js"
import { ServerWeb3Service } from "./web3-service.js"

export type ServerLifecycleAction = "restart" | "shutdown"

export type ServerLifecycleRequest = {
  action: ServerLifecycleAction
  reason?: string
}

export type CypheriaServerOptions = {
  config?: CypheriaServerConfig
  configStore?: ServerConfigStore
  logger?: Logger
  onLifecycleRequest?: (request: ServerLifecycleRequest) => void
  runtime?: CypheriaRuntime
  database?: OpenDatabaseResult
  agentNetworkBootstrap?: boolean
  networkProxyStore?: NetworkProxyStore
}

export type CypheriaServerAddress = {
  host: string
  port: number
  url: string
}

export class CypheriaServer implements HttpAppHost {
  readonly config: CypheriaServerConfig
  readonly configStore: ServerConfigStore
  readonly logger: Logger
  readonly registry: ConnectionRegistry
  readonly runtime: CypheriaRuntime
  readonly agentManager: AgentManager
  readonly browserTools: BrowserToolsService
  readonly projectThread: ProjectThreadService
  readonly appTools: AppToolService
  readonly appToolGrants = new AppToolGrants()
  readonly codeReviewTools: CodeReviewTools
  readonly codeReviewHost: CodeReviewHostService
  readonly privateReviews: PrivateReviews
  readonly mcpApps: McpAppService
  readonly integrations: IntegrationService
  readonly codexHarness: CodexHarnessService
  readonly harnesses: HarnessService
  readonly schedules: ScheduleService
  readonly magpieManager: MagpieManager
  readonly magpie: MagpieService
  readonly threadAttachments: ThreadAttachmentService
  readonly threadManager: ThreadManager
  readonly inputFiles: InputFileService
  readonly workspaceFiles: WorkspaceFileService
  readonly composerReferences: ComposerReferenceService
  readonly terminals: TerminalManager
  readonly git: GitService
  readonly database: OpenDatabaseResult
  readonly web3: ServerWeb3Service
  readonly networkProxy: NetworkProxyStore

  #address: CypheriaServerAddress | undefined
  #httpServer: HttpServer | undefined
  #identity: ServerIdentity | undefined
  #lifecycleHandler: ((request: ServerLifecycleRequest) => void) | undefined
  #relayConnection: RelayConnection | undefined
  #startPromise: Promise<CypheriaServerAddress> | undefined
  #stopPromise: Promise<void> | undefined
  #webSocketServer: WebSocketServer | undefined
  #webSocketHeartbeat: NodeJS.Timeout | undefined
  #resourceCleanupTimer: NodeJS.Timeout | undefined
  #configurationMutationQueue: Promise<void> = Promise.resolve()

  constructor(options: CypheriaServerOptions = {}) {
    this.logger = options.logger ?? pino({ name: "cypheria-server" })
    this.runtime = options.runtime ?? new CypheriaRuntime()
    this.configStore =
      options.configStore ??
      ServerConfigStore.fromResolved(
        this.runtime.paths.configDir,
        options.config ?? loadServerConfig()
      )
    this.config = this.configStore.effective
    this.networkProxy =
      options.networkProxyStore ?? NetworkProxyStore.empty(this.runtime.paths.configDir)
    this.database = options.database ?? openCypheriaDatabase({ dbDir: this.runtime.paths.dbDir })
    this.web3 = new ServerWeb3Service(this.database, this.runtime.paths)
    this.browserTools = new BrowserToolsService({
      audit: this.web3.audit,
      enabled: () => this.configStore.getSnapshot().config.browserTools.enabled,
    })
    this.registry = new ConnectionRegistry({
      helloTimeoutMs: this.config.sessionHelloTimeoutMs,
      host: this,
      reconnectGraceMs: this.config.sessionReconnectGraceMs,
    })
    this.agentManager = new AgentManager({
      logger: this.logger.child({ service: "agents" }),
      cacheDir: this.runtime.paths.cacheDir,
      cypheriaHome: this.runtime.paths.cypheriaHome,
      persistence: createAgentRegistryPersistenceService(this.database.db),
      publish: (message) => {
        this.registry.broadcast(message)
        // an Agent installed, removed, switched on or off changes magpie's agents file
        if (
          message.type === "agent.updated.notification" ||
          message.type === "agent.operation.completed.notification"
        ) {
          void this.magpieManager?.refreshAgents()
        }
      },
      networkBootstrap: options.agentNetworkBootstrap,
      gitSettings: () => this.configStore.getSnapshot().config.git,
      claudePluginsEnabled: () =>
        this.configStore.getSnapshot().config.agents.claude.pluginsEnabled,
      managedShellEnvironment: (cwd) => this.git.managedShellEnvironment(cwd),
      isGitWorkspace: async (cwd) =>
        await this.git.discover(cwd).then(
          () => true,
          () => false
        ),
      projectlessWorkspace: (cwd) => this.#projectlessWorkspaceFor(cwd),
      codexInstructionCapabilities: async () => {
        // App tools reach Codex only through the bundled plugin, so their sections follow it.
        const appTools = await this.codexHarness.appToolsPluginEnabled()
        return {
          ...CYPHERIA_RENDERING_CAPABILITIES,
          createdThreadDirective: appTools,
          tools: appTools ? AppToolService.toolNames : new Set<string>(),
        }
      },
      agentDefaults: () => ({}),
      agentEnvironment: (agentId, base) => {
        // Agent processes, and the commands they run, reach the Server only through app tools
        // tokens; the Server's own token stays out of their environment.
        const { CYPHERIA_SERVER_TOKEN: _serverToken, ...environment } = base
        return this.networkProxy.environment(
          agentId === "codex"
            ? {
                ...environment,
                CYPHERIA_APP_TOOLS_TOKEN: this.appToolGrants.forCodex(),
                CYPHERIA_SERVER_URL: this.#appToolsServerUrl(),
              }
            : environment
        )
      },
      prepareAppTools: (agentId) => this.integrations.ensureBundledPlugin(agentId),
      appToolsThreadEnvironment: (threadId) => ({
        CYPHERIA_APP_TOOLS_TOKEN: this.appToolGrants.forThread(threadId),
        CYPHERIA_SERVER_URL: this.#appToolsServerUrl(),
      }),
    })
    this.integrations = new IntegrationService(this.agentManager, {
      marketplaces: createPluginMarketplacePersistenceService(this.database.db),
    })
    this.inputFiles = new InputFileService(this.runtime.paths.cypheriaHome)
    this.composerReferences = new ComposerReferenceService({
      integrations: this.integrations,
      getThread: (threadId) => this.threadManager.get(threadId),
      listThreads: async () => {
        const page = await this.threadManager.list({ limit: 100 })
        return page.data.map((thread) => ({ id: thread.id, title: thread.title }))
      },
      listBrowserTabs: async (threadId) => {
        const outcome = await this.browserTools.execute({
          command: { args: {}, command: "list_tabs" },
          threadId,
        })
        return outcome.ok && outcome.result.command === "list_tabs" ? outcome.result.tabs : []
      },
    })
    const projectThreadPersistence = createProjectThreadPersistenceService(this.database.db)
    const projectlessWorkspaceRoot = resolve(
      this.configStore.getSnapshot().config.workspace.projectlessRoot ??
        join(homedir(), "Documents", "Cypheria")
    )
    this.workspaceFiles = new WorkspaceFileService({
      cypheriaHome: this.runtime.paths.cypheriaHome,
      persistence: projectThreadPersistence,
      projectlessRoot: projectlessWorkspaceRoot,
      publish: (message) => this.registry.broadcast(message),
    })
    this.terminals = new TerminalManager(projectThreadPersistence)
    this.threadAttachments = new ThreadAttachmentService({
      persistence: createThreadAttachmentPersistenceService(this.database.db),
      projects: projectThreadPersistence,
      publish: (message) => this.registry.broadcast(message),
      worktreeExists: (worktreeId) => this.git.worktreeExists(worktreeId),
    })
    this.threadManager = new ThreadManager({
      adapterFor: (agentId, threadId) => this.agentManager.adapterFor(agentId, threadId),
      assertAgentCallable: (agentId) => this.agentManager.assertCallable(agentId),
      lifecycle: createThreadLifecyclePersistenceService(this.database.db),
      messageRequests: createThreadMessageRequestPersistenceService(this.database.db),
      persistence: projectThreadPersistence,
      projectlessWorkspaceRoot,
      publish: (message) => this.registry.broadcast(message),
      resolveInitialConfig: async (agentId, requested): Promise<ThreadConfig> => {
        if (requested) {
          return ThreadConfigSchema.parse({
            ...requested,
            permissionsMode:
              agentId === "codex"
                ? (requested.permissionsMode ??
                  this.configStore.getSnapshot().config.agents.codex.permissionsMode)
                : null,
          })
        }
        const defaults = await this.agentManager.validatedDefaultsFor(agentId)
        const stringValue = (value: unknown): string | null =>
          typeof value === "string" && value.length > 0 ? value : null
        return ThreadConfigSchema.parse({
          model: stringValue(defaults.model),
          permissionsMode:
            agentId === "codex"
              ? this.configStore.getSnapshot().config.agents.codex.permissionsMode
              : null,
          speed: stringValue(defaults.serviceTier ?? defaults.speed),
          thinking: stringValue(
            defaults.reasoningEffort ?? defaults.effort ?? defaults.thinkingLevel
          ),
        })
      },
      onArchived: async (threadId, cwd) => {
        this.terminals.closeThread(threadId)
        await this.git.cleanupManagedWorktrees(cwd)
      },
      onDeleting: async (threadId) => {
        this.terminals.closeThread(threadId)
        await this.threadAttachments.deleteForThread(threadId)
        await this.inputFiles.releaseThread(threadId)
      },
      inputFiles: this.inputFiles,
      resolveReference: (reference, context) => this.composerReferences.resolve(reference, context),
      onUnarchiving: async (cwd) => {
        await this.git.restoreArchivedWorktree(cwd)
      },
      timelinePersistence: createThreadTimelinePersistenceService(this.database.db),
      turnCapture: {
        start: (threadId, cwd) => this.git.turnCaptureStart(threadId, cwd),
        complete: (captureId, turnId) => this.git.turnCaptureComplete(captureId, turnId),
        discard: (captureId) => this.git.turnCaptureDiscard(captureId),
      },
    })
    this.projectThread = new ProjectThreadService({
      persistence: projectThreadPersistence,
      publish: (message) => this.registry.broadcast(message),
      workspace: {
        deleteProject: (projectId) => this.threadManager.deleteProject(projectId),
        moveToProject: (input) => this.threadManager.moveToProject(input),
        removeFromProject: (threadId) => this.threadManager.removeFromProject(threadId),
      },
    })
    this.git = new GitService(
      this.runtime.paths.cacheDir,
      this.runtime.paths.cypheriaHome,
      {
        agents: this.agentManager,
        threads: this.threadManager,
        audit: this.web3.audit,
        publishChanged: (message) => this.registry.broadcast(message),
        threadAttachments: this.threadAttachments,
      },
      () => this.configStore.getSnapshot().config.git
    )
    const projectRequest = async (type: string, payload: unknown): Promise<unknown> => {
      let result: unknown
      await this.projectThread.handle(
        { payload, requestId: createThreadId(), type } as ProjectThreadClientMessage,
        (message) => {
          result = (message as { payload?: unknown }).payload
        }
      )
      const outcome = result as
        | { ok: true; value: unknown }
        | { error: { message: string }; ok: false }
        | undefined
      if (!outcome?.ok) throw new Error(outcome?.error.message ?? "Request failed")
      return outcome.value
    }
    this.appTools = new AppToolService({
      agents: () => this.#appToolAgents(),
      automations: new AutomationTool({
        agentOf: async (threadId) =>
          (await this.threadManager.get(threadId).catch(() => undefined))?.agentId,
        defaultAgentId: "codex",
        projectRoot: async (projectId) => {
          const project = (await projectRequest("project.read.request", { projectId })) as {
            roots: string[]
          }
          return project.roots[0] as string
        },
        schedules: {
          create: (input) => this.schedules.create(input),
          delete: (id) => this.schedules.delete(id),
          get: (id) => this.schedules.get(id),
          pause: (id) => this.schedules.pause(id),
          resume: (id) => this.schedules.resume(id),
          update: (input) => this.schedules.update(input),
        },
      }),
      handoff: new HandoffService({
        git: this.git,
        randomId: () => randomUUID(),
        threads: this.threadManager,
      }),
      attachments: this.threadAttachments,
      defaultAgentId: "codex",
      isGitRepository: (root) =>
        this.git.discover(root).then(
          () => true,
          () => false
        ),
      pinnedSectionId: PINNED_SECTION_ID,
      projectThread: projectRequest,
      randomId: () => randomUUID(),
      threads: this.threadManager,
      worktrees: {
        archive: (cwd, path) => this.git.deleteWorktree(cwd, path),
        defaultBranch: async (cwd) => (await this.git.branchContext(cwd)).defaultBranch,
        job: (id) => this.git.worktreeJob(id),
        list: (cwd) => this.git.worktrees(cwd),
        resolveRef: async (cwd, ref) => (await this.git.worktreeStartingRef(cwd, ref)).ref,
        restore: (cwd, path) => this.git.restoreWorktree(cwd, path),
        start: (input) => this.git.startWorktreeJob({ ...input }),
      },
    })
    const codexHome = join(this.runtime.paths.cypheriaHome, "agents", "codex", "home")
    const codeReviewBackend = new CodeReviewBackend(
      new ChatGptSession((refresh) =>
        this.agentManager.callCodex("getAuthStatus", { includeToken: true, refreshToken: refresh })
      )
    )
    const codeReviewSettings = () => this.configStore.getSnapshot().config.codeReview
    this.privateReviews = new PrivateReviews({
      backend: codeReviewBackend,
      codex: async (args) => {
        const spec = await this.agentManager.authTerminalSpec("codex", args, {
          CODEX_HOME: codexHome,
        })
        return {
          args: spec.args,
          command: spec.command,
          env: { ...spec.env, CODEX_HOME: codexHome },
        }
      },
      repository: createCodeReviewPersistenceService(this.database.db),
      reviewContextServer: async (runId) => ({
        args: [
          join(
            await bundledMarketplaceDirectory(".agents/plugins/marketplace.json"),
            "code-review",
            "src",
            "server",
            "relay.mjs"
          ),
          "--server",
          "review_context",
        ],
        command: "node",
        env: {
          CYPHERIA_APP_TOOLS_TOKEN: this.appToolGrants.forReview(runId),
          CYPHERIA_SERVER_URL: this.#appToolsServerUrl(),
        },
      }),
      verifyAccount: async (account) => {
        const current = await this.codeReviewTools.currentAccount(
          account.hostname,
          account.connection
        )
        if (accountKey(current.account) !== accountKey(account)) {
          throw new Error(
            "The GitHub account changed or is signed out. Reopen Code Review and try again."
          )
        }
      },
    })
    this.codeReviewTools = new CodeReviewTools({
      backend: codeReviewBackend,
      reviews: this.privateReviews,
      settings: codeReviewSettings,
    })
    this.codeReviewHost = new CodeReviewHostService({
      backend: codeReviewBackend,
      codexAccount: () => this.codexHarness.account(false),
      installedPlugins: async () => {
        const installed = (await this.agentManager.callCodex("plugin/installed", {
          cwds: null,
          installSuggestionPluginNames: null,
        })) as unknown as v2.PluginInstalledResponse
        return new Set(
          installed.marketplaces.flatMap((marketplace) =>
            marketplace.plugins.filter((plugin) => plugin.installed).map((plugin) => plugin.name)
          )
        )
      },
      settings: codeReviewSettings,
    })
    this.mcpApps = new McpAppService({
      [CODE_REVIEW_SERVER]: {
        callTool: (name, args, signal) => this.codeReviewTools.call(name, args, signal),
        listTools: () => this.codeReviewTools.list(),
        readResource: async (uri) => {
          if (uri !== CODE_REVIEW_APP_URI) throw new Error(`Unknown Code Review resource: ${uri}`)
          return [
            {
              _meta: {
                ui: {
                  csp: {
                    resourceDomains: [
                      "blob:",
                      "data:",
                      "https://github.com",
                      "https://avatars.githubusercontent.com",
                      "https://camo.githubusercontent.com",
                      "https://private-user-images.githubusercontent.com",
                      "https://raw.githubusercontent.com",
                      "https://user-images.githubusercontent.com",
                      "https://secure.gravatar.com",
                    ],
                  },
                  permissions: { clipboardWrite: {} },
                },
              },
              mimeType: "text/html;profile=mcp-app",
              text: await readCodeReviewAppHtml(),
              uri,
            },
          ]
        },
      },
    })
    this.codexHarness = new CodexHarnessService(
      this.agentManager,
      this.configStore,
      this.threadManager
    )
    this.harnesses = new HarnessService(this.agentManager, this.codexHarness, this.terminals, {
      get: () => this.configStore.getSnapshot().config.agents.claude,
      update: async (patch) => {
        await this.patchConfig({ agents: { claude: patch } })
      },
    })
    this.agentManager.setCatalogInvalidator((agentId) => this.harnesses.invalidate(agentId))
    this.agentManager.setDefaultsResolver((agentId) => this.harnesses.validatedDefaults(agentId))
    this.agentManager.setThreadCoordinator(this.threadManager)
    this.schedules = new ScheduleService({
      logger: this.logger.child({ service: "schedules" }),
      persistence: createSchedulePersistenceService(this.database.db),
      publish: (message) => this.registry.broadcast(message),
      requestRuntime: (method, params) => this.requestRuntime(method, params),
      threadManager: this.threadManager,
    })
    this.magpieManager = new MagpieManager({
      launchSpecs: () => this.agentManager.launchSpecs(),
      logger: this.logger,
      onStatusChange: () => this.magpie?.broadcastStatus(),
      paths: this.runtime.paths,
    })
    this.magpie = new MagpieService({
      logger: this.logger,
      manager: this.magpieManager,
      publish: (message) => this.registry.broadcast(message),
    })
    this.#lifecycleHandler = options.onLifecycleRequest
  }

  get address(): CypheriaServerAddress | undefined {
    return this.#address
  }

  async start(): Promise<CypheriaServerAddress> {
    if (this.#address) return this.#address
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start()
    try {
      return await this.#startPromise
    } finally {
      this.#startPromise = undefined
    }
  }

  async #start(): Promise<CypheriaServerAddress> {
    if (this.config.webAppEnabled) {
      await access(resolve(this.config.webAppDir, "index.html"))
    }
    await this.runtime.start()
    try {
      await applyDatabaseMigrations(this.database.client)
      await this.web3.initialize()
      await this.agentManager.start()
      this.agentManager.registerCodexDynamicTools(browserToolSpecs(), (request, context) =>
        this.browserTools.callCodexTool(request, context)
      )
      await this.projectThread.initialize()
      await this.threadManager.initialize()
      await this.inputFiles.cleanup()
      this.#resourceCleanupTimer = setInterval(
        () => {
          void Promise.all([
            this.projectThread.cleanupDeletedResources(),
            this.threadManager.cleanupDeletedThreads(),
            this.inputFiles.cleanup(),
          ]).catch((error) => this.logger.warn({ error }, "Deferred resource cleanup failed"))
        },
        5 * 60 * 1000
      ).unref()
      await this.schedules.start()
      await this.magpieManager.init()
      const startedAt = new Date().toISOString()
      const id = await loadOrCreateServerId(this.runtime.paths.configDir)
      this.#identity = {
        hostname: hostname(),
        id,
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        startedAt,
        version: CYPHERIA_SERVER_VERSION,
      }

      if (this.config.relayEnabled) {
        const endpoint = this.config.relayEndpoint
        const publicEndpoint = this.config.relayPublicEndpoint
        if (!endpoint || !publicEndpoint) throw new Error("Relay endpoints are not configured")
        const keyPair = await loadOrCreateRelayKeyPair(this.runtime.paths.configDir)
        this.#relayConnection = new RelayConnection({
          endpoint: { endpoint, useTls: this.config.relayUseTls },
          helloTimeoutMs: this.config.sessionHelloTimeoutMs,
          host: this,
          keyPair,
          logger: this.logger,
          publicEndpoint: { endpoint: publicEndpoint, useTls: this.config.relayPublicUseTls },
          registry: this.registry,
          serverId: id,
        })
        this.#relayConnection.start()
      }

      const app = createHttpApp({
        config: this.config,
        host: this,
        logger: this.logger,
        registry: this.registry,
      })
      const webSocketServer = new WebSocketServer({
        handleProtocols: (protocols) =>
          protocols.has(CYPHERIA_WEBSOCKET_PROTOCOL) ? CYPHERIA_WEBSOCKET_PROTOCOL : false,
        maxPayload: this.config.maxMessageBytes,
        noServer: true,
      })
      this.#webSocketHeartbeat = this.#startWebSocketHeartbeat(webSocketServer)
      const listening = new Promise<CypheriaServerAddress>((resolve, reject) => {
        let httpServer: HttpServer
        const onError = (error: Error) => reject(error)
        httpServer = serve(
          {
            fetch: app.fetch,
            hostname: this.config.host,
            port: this.config.port,
            websocket: { server: webSocketServer },
          },
          (info) => {
            httpServer.off("error", onError)
            const displayHost = info.family === "IPv6" ? `[${info.address}]` : info.address
            resolve({
              host: info.address,
              port: info.port,
              url: `http://${displayHost}:${info.port}`,
            })
          }
        ) as HttpServer
        httpServer.once("error", onError)
        this.#httpServer = httpServer
      })
      this.#webSocketServer = webSocketServer
      this.#address = await listening
      this.logger.info(this.#address, "Cypheria server is ready")
      return this.#address
    } catch (error) {
      if (this.#webSocketHeartbeat) clearInterval(this.#webSocketHeartbeat)
      this.#webSocketServer?.close()
      await Promise.allSettled([
        this.#closeHttpListener(),
        this.agentManager.stop(),
        this.runtime.stop(),
      ])
      this.web3.stop()
      this.schedules.stop()
      await this.magpieManager.shutdown()
      this.terminals.stop()
      this.#identity = undefined
      this.#webSocketServer = undefined
      this.#webSocketHeartbeat = undefined
      this.#relayConnection?.stop()
      this.#relayConnection = undefined
      throw error
    }
  }

  isReady(): boolean {
    return this.#address !== undefined && this.runtime.lifecycleState === "ready"
  }

  getIdentity(): ServerIdentity {
    if (!this.#identity) throw new Error("Server identity is not initialized")
    return this.#identity
  }

  getStatus(): ServerStatus {
    return {
      ...this.getIdentity(),
      capabilities: this.getSessionCapabilities(),
      connections: this.registry.size,
      runtimeState: this.runtime.lifecycleState,
      webApp: { enabled: this.config.webAppEnabled },
    }
  }

  getDiagnostics(): ServerDiagnostics {
    return collectDiagnostics(this.registry.diagnostics(), this.runtime.lifecycleState)
  }

  getConfig(): ServerConfigSnapshot {
    return this.configStore.getSnapshot()
  }

  async patchConfig(patch: PersistedServerConfigPatch): Promise<ServerConfigSnapshot> {
    return this.#withConfigurationMutation(async () => {
      const snapshot = await this.configStore.patch(patch)
      this.#applyWorkspaceConfig(snapshot)
      this.harnesses.invalidate()
      this.registry.broadcast({ payload: snapshot, type: "server.config.updated.notification" })
      return snapshot
    })
  }

  async reloadConfig(): Promise<ServerConfigSnapshot> {
    return this.#withConfigurationMutation(async () => {
      await this.configStore.reload()
      const snapshot = this.configStore.getSnapshot()
      this.#applyWorkspaceConfig(snapshot)
      this.harnesses.invalidate()
      this.registry.broadcast({ payload: snapshot, type: "server.config.updated.notification" })
      return snapshot
    })
  }

  #projectlessWorkspaceFor(cwd: string): { cwd: string; outputsDirectory: string } | null {
    const root = resolve(
      this.configStore.getSnapshot().config.workspace.projectlessRoot ??
        join(homedir(), "Documents", "Cypheria")
    )
    return isManagedProjectlessWorkspace(root, cwd)
      ? { cwd, outputsDirectory: projectlessOutputsDirectory(cwd) }
      : null
  }

  #applyWorkspaceConfig(snapshot: ServerConfigSnapshot): void {
    const root = resolve(
      snapshot.config.workspace.projectlessRoot ?? join(homedir(), "Documents", "Cypheria")
    )
    this.threadManager.setProjectlessWorkspaceRoot(root)
    this.workspaceFiles.setProjectlessRoot(root)
  }

  getNetworkProxy(): NetworkProxySnapshot {
    return this.networkProxy.snapshot()
  }

  async setNetworkProxy(settings: NetworkProxySettings): Promise<NetworkProxySnapshot> {
    return this.#withConfigurationMutation(async () => {
      const snapshot = await this.networkProxy.set(settings)
      this.registry.broadcast({
        payload: snapshot,
        type: "server.network-proxy.updated.notification",
      })
      return snapshot
    })
  }

  #withConfigurationMutation<Result>(task: () => Promise<Result>): Promise<Result> {
    const current = this.#configurationMutationQueue.catch(() => undefined).then(task)
    this.#configurationMutationQueue = current.then(
      () => undefined,
      () => undefined
    )
    return current
  }

  async testNetworkProxy(settings: NetworkProxySettings): Promise<NetworkProxyTestResult> {
    const startedAt = performance.now()
    try {
      const { stdout } = await promisify(execFile)(
        "curl",
        [
          "--silent",
          "--show-error",
          "--output",
          "/dev/null",
          "--write-out",
          "%{http_code}",
          "--max-time",
          "10",
          "https://api.openai.com/v1/models",
        ],
        { env: this.networkProxy.environmentForSettings(settings, process.env) }
      )
      const status = Number(stdout.trim())
      return {
        latencyMs: Math.round(performance.now() - startedAt),
        message: Number.isInteger(status)
          ? `Reached the test endpoint (HTTP ${status}).`
          : "Reached the test endpoint.",
        ok: status >= 100 && status < 600,
      }
    } catch (error) {
      return {
        latencyMs: Math.round(performance.now() - startedAt),
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      }
    }
  }

  getSessionCapabilities(): string[] {
    return [
      SERVER_CAPABILITIES.agentManager,
      SERVER_CAPABILITIES.browser,
      SERVER_CAPABILITIES.config,
      SERVER_CAPABILITIES.diagnostics,
      SERVER_CAPABILITIES.integrations,
      SERVER_CAPABILITIES.magpie,
      SERVER_CAPABILITIES.mcpApps,
      SERVER_CAPABILITIES.codeReview,
      SERVER_CAPABILITIES.codexHarness,
      SERVER_CAPABILITIES.harnessManagement,
      SERVER_CAPABILITIES.projectThread,
      SERVER_CAPABILITIES.schedules,
      SERVER_CAPABILITIES.terminals,
      SERVER_CAPABILITIES.git,
      SERVER_CAPABILITIES.status,
      SERVER_CAPABILITIES.thread,
      SERVER_CAPABILITIES.web3,
    ]
  }

  async handleAgentMessage(
    message: ClientMessage,
    sessionId: string,
    source: SessionTransport,
    send: (message: ServerMessage) => void
  ): Promise<boolean> {
    if (
      message.type === "agent.list.request" ||
      message.type === "agent.add.request" ||
      message.type === "agent.remove.request" ||
      message.type === "agent.get.request" ||
      message.type.startsWith("agent.operation.") ||
      message.type.startsWith("agent.toolchain.") ||
      [
        "agent.install.request",
        "agent.update.request",
        "agent.uninstall.request",
        "agent.enable.request",
        "agent.disable.request",
        "agent.start.request",
        "agent.stop.request",
      ].includes(message.type)
    ) {
      await this.agentManager.handleManagement(message as AgentManagementClientMessage, {
        send,
        sessionId,
      })
      return true
    }
    void source
    return false
  }

  async handleProjectThreadMessage(
    message: ClientMessage,
    send: (message: ServerMessage) => void,
    clientId?: string,
    sendBinary?: (frame: CypheriaBinaryFrame) => void,
    clientKind?: ClientKind
  ): Promise<boolean> {
    if (
      message.type.startsWith("thread.files.") ||
      message.type === "thread.paths.resolve.request" ||
      message.type.startsWith("thread.workspace.cleanup.")
    ) {
      const respond = (value: unknown, error?: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        send({
          payload: error
            ? {
                error: {
                  code:
                    error instanceof WorkspaceFileError ? error.code : failure.name || "FILE_ERROR",
                  message: failure.message,
                },
                ok: false,
              }
            : { ok: true, value },
          requestId: message.requestId,
          type: message.type.replace(/\.request$/u, ".response"),
        } as ServerMessage)
      }
      try {
        switch (message.type) {
          case "thread.paths.resolve.request":
            respond(await this.workspaceFiles.resolvePath(message.payload))
            break
          case "thread.files.directory.list.request":
            respond(await this.workspaceFiles.listDirectory(message.payload))
            break
          case "thread.files.search.request":
            respond(await this.workspaceFiles.search(message.payload))
            break
          case "thread.files.read.request":
            {
              const transfer = await this.workspaceFiles.readForTransfer(message.payload)
              if (transfer.result.kind === "binary") {
                if (!sendBinary || !transfer.bytes) {
                  throw new WorkspaceFileError(
                    "FILE_TRANSFER_UNAVAILABLE",
                    "This connection does not support binary file transfer"
                  )
                }
                if (transfer.bytes.byteLength === 0) {
                  sendBinary(
                    encodeFileTransferFrame(transfer.result.streamId, transfer.bytes, true)
                  )
                } else {
                  for (
                    let offset = 0;
                    offset < transfer.bytes.byteLength;
                    offset += FILE_TRANSFER_MAX_DATA_BYTES
                  ) {
                    const chunk = transfer.bytes.subarray(
                      offset,
                      Math.min(offset + FILE_TRANSFER_MAX_DATA_BYTES, transfer.bytes.byteLength)
                    )
                    sendBinary(
                      encodeFileTransferFrame(
                        transfer.result.streamId,
                        chunk,
                        offset + chunk.byteLength === transfer.bytes.byteLength
                      )
                    )
                  }
                }
                respond(transfer.result)
              } else respond(transfer.result)
            }
            break
          case "thread.files.create.request":
            respond(await this.workspaceFiles.create(message.payload))
            break
          case "thread.files.write.request":
            respond(await this.workspaceFiles.write(message.payload))
            break
          case "thread.files.move.request":
            respond(await this.workspaceFiles.move(message.payload))
            break
          case "thread.files.delete.request":
            respond(await this.workspaceFiles.delete(message.payload))
            break
          case "thread.files.restore.request":
            respond(await this.workspaceFiles.restore(message.payload))
            break
          case "thread.workspace.cleanup.list.request":
            respond(await this.workspaceFiles.listCleanup())
            break
          case "thread.workspace.cleanup.delete.request":
            respond(await this.workspaceFiles.deleteCleanup(message.payload.paths))
            break
        }
      } catch (error) {
        respond(null, error)
      }
      return true
    }
    if (message.type.startsWith("thread.input-file.")) {
      if (!clientId) throw new Error("Client identity is required for input files")
      const respond = (value: unknown, error?: Error) =>
        send({
          payload: error
            ? { ok: false, error: { code: "INPUT_FILE_ERROR", message: error.message } }
            : { ok: true, value },
          requestId: message.requestId,
          type: message.type.replace(/\.request$/u, ".response"),
        } as ServerMessage)
      try {
        switch (message.type) {
          case "thread.input-file.upload.start.request":
            respond(await this.inputFiles.start(clientId, message.payload))
            break
          case "thread.input-file.upload.chunk.request":
            respond(
              await this.inputFiles.chunk(
                clientId,
                message.payload.uploadId,
                message.payload.offset,
                message.payload.bytes
              )
            )
            break
          case "thread.input-file.upload.status.request":
            respond(await this.inputFiles.status(clientId, message.payload.uploadId))
            break
          case "thread.input-file.upload.complete.request":
            respond(await this.inputFiles.complete(clientId, message.payload.uploadId))
            break
          case "thread.input-file.upload.abort.request":
            respond(await this.inputFiles.abort(clientId, message.payload.uploadId))
            break
          case "thread.input-file.get.request":
            await this.threadManager.get(message.payload.threadId)
            respond(
              await this.inputFiles.get(
                message.payload.fileId,
                message.payload.threadId,
                message.payload.offset
              )
            )
            break
        }
      } catch (error) {
        respond(null, error instanceof Error ? error : new Error(String(error)))
      }
      return true
    }
    if (message.type === "thread.composer.suggest.request") {
      try {
        if (!message.payload.threadId && !message.payload.agentId)
          throw new Error("Agent is required for a new chat")
        const context = message.payload.threadId
          ? await this.threadManager.getComposerContext(message.payload.threadId)
          : {
              agentId: message.payload.agentId ?? "codex",
              agentSessionId: null,
              cwd: message.payload.roots?.[0] ?? null,
              threadId: "",
              workspaceRoots: message.payload.roots ?? [],
            }
        const items = await this.composerReferences.suggest(
          context,
          message.payload.trigger,
          message.payload.query
        )
        send({
          payload: { ok: true, value: { items } },
          requestId: message.requestId,
          type: "thread.composer.suggest.response",
        })
      } catch (error) {
        send({
          payload: {
            ok: false,
            error: {
              code: "COMPOSER_SUGGEST_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          requestId: message.requestId,
          type: "thread.composer.suggest.response",
        })
      }
      return true
    }
    if (message.type === "thread.turn.queue.add.request") {
      try {
        const thread = await this.threadManager.get(message.payload.threadId)
        if (thread.agentId !== "codex" || !thread.agentSessionId)
          throw new Error("Codex queue is unavailable")
        const content = await this.threadManager.prepareComposerInput(
          thread.id,
          message.payload.content
        )
        const queued = (await this.agentManager.callCodex("thread/queue/add", {
          clientUserMessageId: message.payload.clientMessageId,
          input: mapCodexInput(content),
          threadId: thread.agentSessionId,
        } satisfies v2.ThreadQueueAddParams)) as v2.ThreadQueueAddResponse
        send({
          payload: { ok: true, value: { queuedId: queued.queuedSubmission.id } },
          requestId: message.requestId,
          type: "thread.turn.queue.add.response",
        })
      } catch (error) {
        send({
          payload: {
            ok: false,
            error: {
              code: "THREAD_QUEUE_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          requestId: message.requestId,
          type: "thread.turn.queue.add.response",
        })
      }
      return true
    }
    if (message.type.startsWith("thread.attachment.")) {
      await this.threadAttachments.handle(message as ThreadAttachmentClientMessage, send)
      return true
    }
    if (message.type.startsWith("thread.")) {
      await this.threadManager.handle(message as ThreadClientMessage, send, { clientKind })
      return true
    }
    if (!message.type.startsWith("project.") && !message.type.startsWith("section.")) {
      return false
    }
    await this.projectThread.handle(message as ProjectThreadClientMessage, send)
    return true
  }

  async handleIntegrationMessage(
    message: IntegrationClientMessage,
    send: (message: IntegrationServerMessage) => void
  ): Promise<boolean> {
    return this.integrations.handle(message, send)
  }

  async handleCodexHarnessMessage(
    message: CodexHarnessClientMessage,
    send: (message: CodexHarnessServerMessage) => void
  ): Promise<boolean> {
    return this.codexHarness.handle(message, send)
  }

  async handleHarnessMessage(
    message: HarnessClientMessage,
    sessionId: string,
    send: (message: ServerMessage) => void
  ): Promise<boolean> {
    return this.harnesses.handle(message, sessionId, send)
  }

  async handleMcpAppMessage(
    message: McpAppClientMessage,
    send: (message: McpAppServerMessage) => void
  ): Promise<boolean> {
    return this.mcpApps.handle(message, send)
  }

  async handleCodeReviewMessage(
    message: CodeReviewClientMessage,
    send: (message: CodeReviewServerMessage) => void
  ): Promise<boolean> {
    return this.codeReviewHost.handle(message, send)
  }

  async handleMagpieMessage(
    message: MagpieClientMessage,
    send: (message: MagpieServerMessage) => void
  ): Promise<boolean> {
    return this.magpie.handle(message, send)
  }

  async handleScheduleMessage(
    message: ScheduleClientMessage,
    send: (message: ScheduleServerMessage) => void
  ): Promise<boolean> {
    await this.schedules.handle(message, send)
    return true
  }

  async handleTerminalMessage(
    message: TerminalClientMessage,
    sessionId: string,
    source: SessionTransport,
    sendBinary: (frame: CypheriaBinaryFrame) => void,
    send: (message: TerminalServerMessage) => void
  ): Promise<boolean> {
    return this.terminals.handle(message, { send, sendBinary, sessionId, source })
  }

  async handleBinaryFrame(
    frame: CypheriaBinaryFrame,
    sessionId: string,
    source: SessionTransport
  ): Promise<boolean> {
    return this.terminals.handleBinaryFrame(frame, sessionId, source)
  }

  /** The URL Agent processes on this host use to reach the Server, before and after it listens. */
  #appToolsServerUrl(): string {
    const port = this.#address?.port ?? this.config.port
    const host = this.config.host
    if (host === "::1") return `http://[::1]:${port}`
    if (["", "0.0.0.0", "::", "localhost", "127.0.0.1"].includes(host)) {
      return `http://127.0.0.1:${port}`
    }
    return `http://${host.includes(":") ? `[${host}]` : host}:${port}`
  }

  verifyAppToolToken(token: string | undefined): AppToolGrant | null {
    return this.appToolGrants.verify(token)
  }

  /** The installed, enabled Agents and the models each one offers, for the app tools guidance. */
  async #appToolAgents(): Promise<AppToolAgent[]> {
    const agents = (await this.agentManager.list("app-tools")).filter(
      (agent) => agent.installed && agent.enabled
    )
    return Promise.all(
      agents.map(async (agent) => {
        const catalog = await this.harnesses.catalog.get(agent.id).catch(() => undefined)
        return {
          id: agent.id,
          models: (catalog?.models ?? [])
            .filter((model) => model.isSelectable)
            .map((model) => ({
              description: model.description,
              id: model.id,
              reasoningEfforts: model.thinkingOptions.map((option) => option.id),
            })),
          name: agent.name,
        }
      })
    )
  }

  /**
   * The tools of one bundled plugin server for the caller a token speaks for. Codex hides the Code
   * Review App's tools from its model itself; a Claude session is given only the model's tools. A
   * private review's Codex process sees only its `review_context` tools.
   */
  async listAppTools(grant: AppToolGrant, server: string): Promise<AppToolMcpTool[] | undefined> {
    if (grant.kind === "review") {
      return server === "review_context" ? this.privateReviews.contextTools() : undefined
    }
    if (server === "cypheria_app_tools") return await this.appTools.mcpTools()
    if (server === CODE_REVIEW_SERVER) {
      return grant.kind === "codex"
        ? this.codeReviewTools.list()
        : this.codeReviewTools.listForModel()
    }
    return undefined
  }

  /**
   * Runs an app tool for the caller a token speaks for. A Codex call names its Thread through the
   * turn metadata Codex attaches; a Claude call is bound to its Thread by the token itself.
   */
  async callAppTool(
    grant: AppToolGrant,
    request: { server: string; name: string; arguments?: unknown; codexTurnMetadata?: unknown },
    signal?: AbortSignal
  ): Promise<AppToolMcpResult> {
    if (grant.kind === "review") {
      return request.server === "review_context"
        ? this.privateReviews.callContextTool(grant.runId, request.name, request.arguments)
        : { content: [{ text: "This review cannot call that tool.", type: "text" }], isError: true }
    }
    if (request.server === CODE_REVIEW_SERVER) {
      if (
        grant.kind === "thread" &&
        !this.codeReviewTools.listForModel().some((tool) => tool.name === request.name)
      ) {
        return {
          content: [{ text: `Unknown code-review tool: ${request.name}`, type: "text" }],
          isError: true,
        }
      }
      return this.codeReviewTools.call(request.name, request.arguments ?? {}, signal)
    }
    const context =
      grant.kind === "thread"
        ? this.agentManager.appToolContextForThread(grant.threadId)
        : this.agentManager.appToolContextForCodexSession(
            codexCallerSessionIds(request.codexTurnMetadata)
          )
    if (!context) {
      return {
        content: [
          { text: "Cypheria could not find the Thread that made this call.", type: "text" },
        ],
        isError: true,
      }
    }
    const callContext = { ...context, ...(signal ? { signal } : {}) }
    return toMcpResult(
      await this.appTools.call(
        { arguments: request.arguments ?? {}, tool: request.name },
        callContext
      )
    )
  }

  async handleGitMessage(
    message: GitClientMessage,
    send: (message: GitServerMessage) => void
  ): Promise<boolean> {
    return this.git.handle(message, send)
  }

  async handleBrowserMessage(
    message: BrowserClientMessage,
    session: { id: string; kind: ClientKind; notify(message: BrowserServerMessage): void },
    send: (message: BrowserServerMessage) => void
  ): Promise<boolean> {
    return this.browserTools.handle(message, session, send)
  }

  clientSessionClosed(sessionId: string): void {
    this.browserTools.sessionClosed(sessionId)
    this.harnesses.closeSession(sessionId)
    this.terminals.closeSession(sessionId)
  }

  clientTransportClosed(sessionId: string, source: SessionTransport): void {
    this.terminals.transportClosed(sessionId, source)
  }

  async handleWeb3Message(
    message: Web3ClientMessage,
    send: (message: Web3ServerMessage) => void
  ): Promise<boolean> {
    return this.web3.handle(message, send)
  }

  getState(): ServerOperationalState {
    const config = this.configStore.getSnapshot()
    return {
      config: {
        path: config.path,
        restartRequired: config.restartRequiredPaths.length > 0,
      },
      connections: {
        active: this.registry.size,
        activeSessions: this.registry.activeSessions,
        retained: this.registry.retained,
      },
      relay: {
        connected: this.#relayConnection?.connected ?? false,
        enabled: this.config.relayEnabled,
      },
      runtimeState: this.runtime.lifecycleState,
      worker: {
        pid: process.pid,
        ...(typeof process.send === "function" ? { supervisorPid: process.ppid } : {}),
      },
    }
  }

  getRelayPairingOffer(): RelayPairingOfferResponse | undefined {
    const relay = this.#relayConnection
    if (!relay) return undefined
    return {
      offer: relay.offer,
      relayConnected: relay.connected,
      url: "cypheria://pair",
    }
  }

  async requestRuntime(method: string, params?: unknown): Promise<unknown> {
    return this.runtime.request(method as CypheriaRuntimeMethod, params)
  }

  requestLifecycle(action: ServerLifecycleAction, reason?: string): void {
    this.logger.info({ action, reason }, "Server lifecycle request accepted")
    this.#lifecycleHandler?.({ action, reason })
  }

  async stop(reason = "Server shutting down"): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopPromise = this.#stop(reason)
    try {
      await this.#stopPromise
    } finally {
      this.#stopPromise = undefined
    }
  }

  async #stop(reason: string): Promise<void> {
    if (!this.#httpServer && this.runtime.lifecycleState === "stopped") return
    this.logger.info({ reason }, "Stopping Cypheria server")
    this.#address = undefined
    this.#relayConnection?.stop()
    this.#relayConnection = undefined
    this.registry.closeAll(1001, reason)
    if (this.#webSocketHeartbeat) clearInterval(this.#webSocketHeartbeat)
    this.#webSocketHeartbeat = undefined
    if (this.#resourceCleanupTimer) clearInterval(this.#resourceCleanupTimer)
    this.#resourceCleanupTimer = undefined
    this.#webSocketServer?.close()
    this.#webSocketServer = undefined
    this.schedules.stop()
    this.git.stop()
    this.terminals.stop()
    this.web3.stop()
    this.harnesses.stop()
    this.integrations.dispose()
    await this.privateReviews.dispose()
    await this.magpieManager.shutdown()

    const results = await Promise.allSettled([
      this.#closeHttpListener(),
      this.agentManager.stop(),
      this.runtime.stop(),
    ])
    this.database.close()
    this.#identity = undefined
    const failures = results.filter((result) => result.status === "rejected")
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Cypheria server shutdown failed"
      )
    }
    this.logger.info("Cypheria server stopped")
  }

  async #closeHttpListener(): Promise<void> {
    const httpServer = this.#httpServer
    this.#httpServer = undefined
    if (!httpServer?.listening) return

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        httpServer.closeAllConnections()
        resolve()
      }, this.config.shutdownTimeoutMs).unref()
      httpServer.close((error) => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve()
      })
    })
  }

  #startWebSocketHeartbeat(webSocketServer: WebSocketServer): NodeJS.Timeout {
    const alive = new WeakSet<WebSocket>()
    webSocketServer.on("connection", (socket) => {
      alive.add(socket)
      socket.on("pong", () => alive.add(socket))
    })

    const heartbeat = setInterval(() => {
      for (const socket of webSocketServer.clients) {
        if (!alive.has(socket)) {
          socket.terminate()
          continue
        }
        alive.delete(socket)
        socket.ping()
      }
    }, 30_000)
    heartbeat.unref()
    return heartbeat
  }
}

export type { CypheriaRuntimeEvent }
