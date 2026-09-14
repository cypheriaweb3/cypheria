import {
  type AgentAcpClientMessage,
  type AgentAcpServerMessage,
  isAgentAcpServerMessage,
  type PersistedServerConfigPatch,
  type ServerConfigSnapshot,
  type ServerDiagnostics,
  type ServerMessage,
  type ServerStatus,
} from "@cypheria/protocol"

import { type AcpEndpoint, createAcpEndpoint } from "./acp-client.js"
import { type CodexEndpoint, createCodexEndpoint, isCodexServerMessage } from "./codex-endpoint.js"
import {
  type ConnectionState,
  type RequestOptions,
  ServerClient,
  type ServerClientConfig,
  type ServerSession,
} from "./server-client.js"

export interface AgentActions {
  readonly acp: AcpEndpoint
  readonly codex: CodexEndpoint
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
  readonly server: ServerActions
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

const acpEndpointsByServerClient = new WeakMap<ServerClient, AcpEndpoint>()
const codexEndpointsByServerClient = new WeakMap<ServerClient, CodexEndpoint>()

const getAcpEndpoint = (serverClient: ServerClient): AcpEndpoint => {
  const existing = acpEndpointsByServerClient.get(serverClient)
  if (existing) return existing
  const endpoint = createAcpEndpoint({
    send: (message) => serverClient.sendAcp(message),
    subscribe: (handler) =>
      serverClient.subscribe((message) => {
        if (isAgentAcpServerMessage(message)) handler(message)
      }),
    subscribeConnectionStatus: (handler) => serverClient.subscribeConnectionStatus(handler),
  })
  acpEndpointsByServerClient.set(serverClient, endpoint)
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
      acp: getAcpEndpoint(serverClient),
      codex: getCodexEndpoint(serverClient),
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
    subscribe: (handler) => serverClient.subscribe(handler),
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
export type { AcpEndpoint, AgentAcpClientMessage, AgentAcpServerMessage, CodexEndpoint }
