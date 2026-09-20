import type {
  PersistedServerConfigPatch,
  ServerConfigSnapshot,
  ServerDiagnostics,
  ServerMessage,
  ServerStatus,
} from "@cypheria/protocol"

import {
  type AgentManagementActions,
  createAgentManagementActions,
  isAgentUpdateAvailable,
} from "./agent-manager.js"
import { type ArtifactActions, createArtifactActions } from "./artifact.js"
import { createHarnessActions, type HarnessActions } from "./harness.js"
import { type CodexHarnessActions, createCodexHarnessActions } from "./harness-codex.js"
import { createIntegrationActions, type IntegrationActions } from "./integration.js"
import {
  createProjectThreadActions,
  type ProjectActions,
  type ProjectThreadActions,
  type SectionActions,
} from "./project-thread.js"
import { createScheduleActions, type ScheduleActions } from "./schedule.js"
import {
  type ConnectionState,
  type RequestOptions,
  ServerClient,
  type ServerClientConfig,
  type ServerSession,
} from "./server-client.js"
import { createTerminalActions, type TerminalActions } from "./terminal.js"
import { createThreadActions, type ThreadActions, type TimelineActions } from "./thread.js"
import { createWeb3Actions, type Web3Actions } from "./web3.js"

export type AgentActions = AgentManagementActions

export interface ServerActions {
  config(options?: RequestOptions): Promise<ServerConfigSnapshot>
  diagnostics(options?: RequestOptions): Promise<ServerDiagnostics>
  patchConfig(
    patch: PersistedServerConfigPatch,
    options?: RequestOptions
  ): Promise<ServerConfigSnapshot>
  ping(options?: RequestOptions): Promise<void>
  reloadConfig(options?: RequestOptions): Promise<ServerConfigSnapshot>
  status(options?: RequestOptions): Promise<ServerStatus>
  supports(capability: string): boolean
  supportsFeature(feature: string): boolean
}

export interface SettingsActions {
  get(options?: RequestOptions): Promise<ServerConfigSnapshot>
  reload(options?: RequestOptions): Promise<ServerConfigSnapshot>
  update(patch: PersistedServerConfigPatch, options?: RequestOptions): Promise<ServerConfigSnapshot>
}

/** Capability-only facade. Every operation maps directly to a current protocol message. */
export interface CypheriaApi {
  readonly agent: AgentActions
  /** Preferred plural Agent facade. `agent` remains as a compatibility alias. */
  readonly agents: AgentActions
  readonly artifacts: ArtifactActions
  readonly integrations: IntegrationActions
  readonly projectThread: ProjectThreadActions
  readonly projects: ProjectActions
  readonly harnesses: {
    readonly acp: { readonly integrations: IntegrationActions }
    readonly claude: { readonly integrations: IntegrationActions }
    readonly codex: {
      readonly apps: IntegrationActions["apps"]
      readonly integrations: IntegrationActions
      readonly account: CodexHarnessActions["account"]
      readonly guardian: CodexHarnessActions["guardian"]
      readonly models: CodexHarnessActions["models"]
      readonly permissions: CodexHarnessActions["permissions"]
    }
    readonly opencode: { readonly integrations: IntegrationActions }
    readonly pi: { readonly integrations: IntegrationActions }
    readonly get: HarnessActions["get"]
    readonly auth: HarnessActions["auth"]
    readonly models: HarnessActions["models"]
    readonly settings: HarnessActions["settings"]
  }
  readonly server: ServerActions
  readonly sections: SectionActions
  readonly schedules: ScheduleActions
  readonly settings: SettingsActions
  readonly thread: ThreadActions
  /** Preferred plural Thread facade. `thread` remains as a compatibility alias. */
  readonly threads: ThreadActions
  readonly timeline: TimelineActions
  readonly terminals: TerminalActions
  readonly web3: Web3Actions
  on<T extends ServerMessage["type"]>(
    type: T,
    handler: (message: Extract<ServerMessage, { type: T }>) => void
  ): () => void
  on(handler: (message: ServerMessage) => void): () => void
  subscribe(handler: (message: ServerMessage) => void): () => void
}

/** An owned CypheriaApi plus connection lifecycle. */
export interface CypheriaClient extends CypheriaApi {
  close(): Promise<void>
  connect(): Promise<void>
  ensureConnected(): Promise<void>
  getConnectionState(): ConnectionState
  getLastError(): Error | undefined
  getSession(): ServerSession | undefined
  subscribeConnectionStatus(handler: (state: ConnectionState) => void): () => void
}

export type CypheriaClientConfig = ServerClientConfig

/** Creates a public client which owns exactly one Cypheria server connection. */
export function createCypheriaClient(config: CypheriaClientConfig = {}): CypheriaClient {
  const serverClient = new ServerClient(config)
  return {
    ...createCypheriaApi(serverClient),
    close: () => serverClient.close(),
    connect: () => serverClient.connect(),
    ensureConnected: () => serverClient.ensureConnected(),
    getConnectionState: () => serverClient.getConnectionState(),
    getLastError: () => serverClient.getLastError(),
    getSession: () => serverClient.getSession(),
    subscribeConnectionStatus: (handler) => serverClient.subscribeConnectionStatus(handler),
  }
}

/** Creates a capability facade which borrows, but never closes, a ServerClient. */
export function createCypheriaApi(serverClient: ServerClient): CypheriaApi {
  const on = ((
    typeOrHandler: ServerMessage["type"] | ((message: ServerMessage) => void),
    handler?: (message: ServerMessage) => void
  ): (() => void) => {
    if (typeof typeOrHandler === "function") return serverClient.on(typeOrHandler)
    if (!handler) throw new Error("A Cypheria message handler is required")
    return serverClient.on(typeOrHandler, handler)
  }) as CypheriaApi["on"]

  const agents = createAgentManagementActions(serverClient)
  const integrations = createIntegrationActions(serverClient)
  const codexHarness = createCodexHarnessActions(serverClient)
  const harnesses = createHarnessActions(serverClient)
  const projectThread = createProjectThreadActions(serverClient)
  const threads = createThreadActions(serverClient)
  const schedules = createScheduleActions(serverClient)
  const terminals = createTerminalActions(serverClient)
  const web3 = createWeb3Actions(serverClient)
  const artifacts = createArtifactActions(threads.timeline)
  const settings: SettingsActions = {
    get: async (options) => serverClient.getServerConfig(options),
    reload: async (options) => serverClient.reloadServerConfig(options),
    update: async (patch, options) => serverClient.patchServerConfig(patch, options),
  }
  return {
    agent: agents,
    agents,
    artifacts,
    integrations,
    projectThread,
    projects: projectThread.projects,
    harnesses: {
      acp: { integrations },
      claude: { integrations },
      codex: {
        account: codexHarness.account,
        apps: integrations.apps,
        integrations,
        guardian: codexHarness.guardian,
        models: codexHarness.models,
        permissions: codexHarness.permissions,
      },
      opencode: { integrations },
      pi: { integrations },
      auth: harnesses.auth,
      get: harnesses.get,
      models: harnesses.models,
      settings: harnesses.settings,
    },
    on,
    server: {
      config: async (options) => serverClient.getServerConfig(options),
      diagnostics: async (options) => serverClient.getServerDiagnostics(options),
      patchConfig: async (patch, options) => serverClient.patchServerConfig(patch, options),
      ping: async (options) => serverClient.ping(options),
      reloadConfig: async (options) => serverClient.reloadServerConfig(options),
      status: async (options) => serverClient.getServerStatus(options),
      supports: (capability) => serverClient.supports(capability),
      supportsFeature: (feature) => serverClient.supportsFeature(feature),
    },
    sections: projectThread.sections,
    schedules,
    settings,
    subscribe: (handler) => serverClient.subscribe(handler),
    thread: threads,
    threads,
    timeline: threads.timeline,
    terminals,
    web3,
  }
}

export {
  type ConnectionState,
  CypheriaCapabilityError,
  CypheriaConnectionError,
  CypheriaProtocolError,
  CypheriaTimeoutError,
  type RequestOptions,
  type ServerSession,
} from "./server-client.js"
export type {
  AgentManagementActions,
  ArtifactActions,
  CodexHarnessActions,
  HarnessActions,
  IntegrationActions,
  ProjectActions,
  ProjectThreadActions,
  ScheduleActions,
  SectionActions,
  ThreadActions,
  TimelineActions,
  Web3Actions,
}
export { isAgentUpdateAvailable }
