import type {
  AcpClientWirePayload,
  AcpServerWirePayload,
  ClientMessage,
  ServerDiagnostics,
  ServerInfo,
  ServerMessage,
} from "@cypheria/protocol"

import { type AcpEndpoint, createAcpEndpoint } from "./acp-client.js"
import { type CodexEndpoint, createCodexEndpoint, isCodexServerMessage } from "./codex-endpoint.js"
import {
  type ConnectionState,
  ServerClient,
  type ServerClientConfig,
  type ServerSession,
} from "./server-client.js"

export type RuntimeMethod = Extract<ClientMessage, { type: "runtime.request" }>["payload"]["method"]
export type RuntimeEvent = Extract<ServerMessage, { type: "runtime.event" }>["payload"]["event"]
export type ServerPong = Extract<ServerMessage, { type: "server.pong" }>["payload"]
export type ServerLifecycleAccepted = Extract<
  ServerMessage,
  { type: "server.lifecycle.accepted" }
>["payload"]

/** The generic runtime request/event pair currently defined by @cypheria/protocol. */
export interface RuntimeActions {
  request<T = unknown>(method: RuntimeMethod, params?: unknown): Promise<T>
  subscribe(handler: (event: RuntimeEvent) => void): () => void
}

export interface AgentActions {
  readonly acp: AcpEndpoint
  readonly codex: CodexEndpoint
}

export interface ServerActions {
  diagnostics(): Promise<ServerDiagnostics>
  info(): Promise<ServerInfo>
  ping(sentAt?: string): Promise<ServerPong>
  restart(reason?: string): Promise<ServerLifecycleAccepted>
  shutdown(reason?: string): Promise<ServerLifecycleAccepted>
}

/** Capability-only facade. Every operation maps directly to a current protocol message. */
export interface CypheriaApi {
  readonly agent: AgentActions
  readonly runtime: RuntimeActions
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
    send: (payload) => serverClient.sendAcp(payload),
    subscribe: (handler) =>
      serverClient.on("agent.acp.server.message", (message) => handler(message.payload)),
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
    runtime: {
      request: async (method, params) => serverClient.requestRuntime(method, params),
      subscribe: (handler) =>
        serverClient.on("runtime.event", (message) => handler(message.payload.event)),
    },
    server: {
      diagnostics: async () => serverClient.getServerDiagnostics(),
      info: async () => serverClient.getServerInfo(),
      ping: async (sentAt) => serverClient.ping(sentAt),
      restart: async (reason) => serverClient.requestLifecycle("restart", reason),
      shutdown: async (reason) => serverClient.requestLifecycle("shutdown", reason),
    },
    subscribe: (handler) => serverClient.subscribe(handler),
  }
}

export {
  type ConnectionState,
  CypheriaConnectionError,
  CypheriaProtocolError,
  CypheriaServerError,
  type ServerSession,
} from "./server-client.js"
export type { AcpClientWirePayload, AcpEndpoint, AcpServerWirePayload, CodexEndpoint }
