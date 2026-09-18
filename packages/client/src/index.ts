import {
  type AgentAcpClientMessage,
  type AgentAcpServerMessage,
  type AgentClaudeServerMessage,
  type AgentPiServerMessage,
  isAgentAcpServerMessage,
  type PersistedServerConfigPatch,
  type RegistryAgentId,
  type ServerConfigSnapshot,
  type ServerDiagnostics,
  type ServerMessage,
  type ServerStatus,
} from "@cypheria/protocol"

import { type AcpEndpoint, createAcpEndpoint } from "./acp-client.js"
import {
  type AgentManagementActions,
  createAgentManagementActions,
  isAgentUpdateAvailable,
} from "./agent-manager.js"
import {
  type ClaudeEndpoint,
  createClaudeEndpoint,
  isClaudeServerMessage,
} from "./claude-endpoint.js"
import { type CodexEndpoint, createCodexEndpoint, isCodexServerMessage } from "./codex-endpoint.js"
import { createOpenCodeEndpoint, type OpenCodeEndpoint } from "./opencode.js"
import { createPiEndpoint, isPiServerMessage, type PiEndpoint } from "./pi-endpoint.js"
import { createProjectThreadActions, type ProjectThreadActions } from "./project-thread.js"
import {
  type ConnectionState,
  type RequestOptions,
  ServerClient,
  type ServerClientConfig,
  type ServerSession,
} from "./server-client.js"
import { createThreadActions, type ThreadActions } from "./thread.js"

export interface AgentActions extends AgentManagementActions {
  readonly acp: (agent: RegistryAgentId) => AcpEndpoint
  readonly claude: ClaudeEndpoint
  readonly codex: CodexEndpoint
  readonly opencode: OpenCodeEndpoint
  readonly pi: PiEndpoint
}

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

/** Capability-only facade. Every operation maps directly to a current protocol message. */
export interface CypheriaApi {
  readonly agent: AgentActions
  readonly projectThread: ProjectThreadActions
  readonly server: ServerActions
  readonly thread: ThreadActions
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

const acpEndpointsByServerClient = new WeakMap<ServerClient, Map<RegistryAgentId, AcpEndpoint>>()
const codexEndpointsByServerClient = new WeakMap<ServerClient, CodexEndpoint>()
const claudeEndpointsByServerClient = new WeakMap<ServerClient, ClaudeEndpoint>()
const piEndpointsByServerClient = new WeakMap<ServerClient, PiEndpoint>()
const openCodeEndpointsByServerClient = new WeakMap<ServerClient, OpenCodeEndpoint>()

const getAcpEndpoint = (serverClient: ServerClient, agent: RegistryAgentId): AcpEndpoint => {
  let endpoints = acpEndpointsByServerClient.get(serverClient)
  if (!endpoints) {
    endpoints = new Map()
    acpEndpointsByServerClient.set(serverClient, endpoints)
  }
  const existing = endpoints.get(agent)
  if (existing) return existing
  const endpoint = createAcpEndpoint(agent, {
    send: (message) => serverClient.sendAcp(message),
    subscribe: (handler) =>
      serverClient.subscribe((message) => {
        if (isAgentAcpServerMessage(message) && message.agent === agent) handler(message)
      }),
    subscribeConnectionStatus: (handler) => serverClient.subscribeConnectionStatus(handler),
  })
  endpoints.set(agent, endpoint)
  return endpoint
}

const getCodexEndpoint = (serverClient: ServerClient): CodexEndpoint => {
  const existing = codexEndpointsByServerClient.get(serverClient)
  if (existing) return existing
  const notify: CodexEndpoint["notify"] = (method, ...args) =>
    serverClient.notifyCodex(method, args[0])
  const request: CodexEndpoint["request"] = (method, ...args) =>
    serverClient.requestCodex(method, args[0], args[1])
  const endpoint = createCodexEndpoint({
    notify,
    request,
    respond: (method, requestId, response) =>
      serverClient.respondToCodex(method, requestId, response),
    subscribe: (handler) =>
      serverClient.subscribe((message) => {
        if (isCodexServerMessage(message)) handler(message)
      }),
    subscribeConnectionStatus: (handler) => serverClient.subscribeConnectionStatus(handler),
  })
  codexEndpointsByServerClient.set(serverClient, endpoint)
  return endpoint
}

const getClaudeEndpoint = (serverClient: ServerClient): ClaudeEndpoint => {
  const existing = claudeEndpointsByServerClient.get(serverClient)
  if (existing) return existing
  const endpoint = createClaudeEndpoint({
    completeInput: (queryId) => serverClient.completeClaudeInput(queryId),
    request: (method, params, options) => serverClient.requestClaude(method, params, options),
    sendInput: (queryId, message) => serverClient.sendClaudeInput(queryId, message),
    subscribe: (handler) =>
      serverClient.subscribe((message) => {
        if (isClaudeServerMessage(message)) handler(message)
      }),
    subscribeConnectionStatus: (handler) => serverClient.subscribeConnectionStatus(handler),
  })
  claudeEndpointsByServerClient.set(serverClient, endpoint)
  return endpoint
}

const getPiEndpoint = (serverClient: ServerClient): PiEndpoint => {
  const existing = piEndpointsByServerClient.get(serverClient)
  if (existing) return existing
  const endpoint = createPiEndpoint({
    request: (command, params, options) => serverClient.requestPi(command, params, options),
    respondToExtensionUI: (method, requestId, answer) =>
      serverClient.respondToPiExtensionUI(method, requestId, answer),
    subscribe: (handler) =>
      serverClient.subscribe((message) => {
        if (isPiServerMessage(message)) handler(message)
      }),
    subscribeConnectionStatus: (handler) => serverClient.subscribeConnectionStatus(handler),
  })
  piEndpointsByServerClient.set(serverClient, endpoint)
  return endpoint
}

const getOpenCodeEndpoint = (serverClient: ServerClient): OpenCodeEndpoint => {
  const existing = openCodeEndpointsByServerClient.get(serverClient)
  if (existing) return existing
  const endpoint = createOpenCodeEndpoint(serverClient)
  openCodeEndpointsByServerClient.set(serverClient, endpoint)
  return endpoint
}

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

  return {
    agent: {
      ...createAgentManagementActions(serverClient),
      acp: (agent) => getAcpEndpoint(serverClient, agent),
      claude: getClaudeEndpoint(serverClient),
      codex: getCodexEndpoint(serverClient),
      opencode: getOpenCodeEndpoint(serverClient),
      pi: getPiEndpoint(serverClient),
    },
    projectThread: createProjectThreadActions(serverClient),
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
    subscribe: (handler) => serverClient.subscribe(handler),
    thread: createThreadActions(serverClient),
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
  AcpEndpoint,
  AgentAcpClientMessage,
  AgentAcpServerMessage,
  AgentClaudeServerMessage,
  AgentManagementActions,
  AgentPiServerMessage,
  ClaudeEndpoint,
  CodexEndpoint,
  OpenCodeEndpoint,
  PiEndpoint,
  ProjectThreadActions,
  ThreadActions,
}
export { isAgentUpdateAvailable }
