import type { CodexClientResponseMap, CodexServerRequestResponseMap } from "@cypheria/protocol"
import {
  type AGENT_CODEX_CLIENT_NOTIFICATIONS,
  type AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD,
  type AGENT_CODEX_SERVER_NOTIFICATIONS,
  AGENT_CODEX_SERVER_REQUEST_TYPE_TO_METHOD,
  type AGENT_CODEX_SERVER_RPC,
  type AgentCodexClientNotificationMessage,
  type AgentCodexClientRequestMessage,
  type AgentCodexServerNotificationMessage,
  type AgentCodexServerRequestMessage,
  type RequestId as CypheriaRequestId,
} from "@cypheria/protocol"

export type CodexClientMethod = keyof typeof AGENT_CODEX_CLIENT_RPC
export type CodexClientNotificationMethod = keyof typeof AGENT_CODEX_CLIENT_NOTIFICATIONS
export type CodexServerMethod = keyof typeof AGENT_CODEX_SERVER_RPC
export type CodexServerNotificationMethod = keyof typeof AGENT_CODEX_SERVER_NOTIFICATIONS

export type CodexRequestParams<Method extends CodexClientMethod> = Omit<
  Extract<
    AgentCodexClientRequestMessage,
    { type: (typeof AGENT_CODEX_CLIENT_RPC)[Method]["request"] }
  >,
  "requestId" | "type"
>

export type CodexClientNotificationParams<Method extends CodexClientNotificationMethod> = Omit<
  Extract<
    AgentCodexClientNotificationMessage,
    { type: (typeof AGENT_CODEX_CLIENT_NOTIFICATIONS)[Method]["notification"] }
  >,
  "type"
>

export type CodexServerRequestParams<Method extends CodexServerMethod> = Omit<
  Extract<
    AgentCodexServerRequestMessage,
    { type: (typeof AGENT_CODEX_SERVER_RPC)[Method]["request"] }
  >,
  "requestId" | "type"
>

export type CodexServerNotificationParams<Method extends CodexServerNotificationMethod> =
  Extract<
    AgentCodexServerNotificationMessage,
    { type: (typeof AGENT_CODEX_SERVER_NOTIFICATIONS)[Method]["notification"] }
  > extends { payload: infer Params }
    ? Params
    : Record<never, never>

export type CodexRequestOptions = {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export type CodexServerMessage =
  | AgentCodexServerRequestMessage
  | AgentCodexServerNotificationMessage

/** @internal Narrows the shared server stream to messages consumed by a Codex ClientApp. */
export const isCodexServerMessage = (message: {
  readonly type: string
}): message is CodexServerMessage =>
  message.type in AGENT_CODEX_SERVER_REQUEST_TYPE_TO_METHOD ||
  message.type in AGENT_CODEX_SERVER_NOTIFICATION_TYPE_TO_METHOD

export type CodexConnectionState =
  | { readonly status: "idle" }
  | { readonly attempt: number; readonly status: "connecting" }
  | { readonly sessionId: string; readonly status: "connected" }
  | { readonly reason: string; readonly status: "disconnected" }
  | { readonly status: "disposed" }

/** The transport-neutral Codex capability accepted by ClientApp.connect() and connectWith(). */
export interface CodexEndpoint {
  notify<Method extends CodexClientNotificationMethod>(
    method: Method,
    ...args: keyof CodexClientNotificationParams<Method> extends never
      ? [params?: CodexClientNotificationParams<Method>]
      : [params: CodexClientNotificationParams<Method>]
  ): Promise<void>
  request<Method extends CodexClientMethod>(
    method: Method,
    ...args: keyof CodexRequestParams<Method> extends never
      ? [params?: CodexRequestParams<Method>, options?: CodexRequestOptions]
      : [params: CodexRequestParams<Method>, options?: CodexRequestOptions]
  ): Promise<CodexClientResponseMap[Method]>
  respond<Method extends CodexServerMethod>(
    method: Method,
    requestId: CypheriaRequestId,
    response: CodexServerRequestResponseMap[Method]
  ): Promise<void>
  subscribe(handler: (message: CodexServerMessage) => void): () => void
}

interface CodexEndpointTransport extends CodexEndpoint {
  subscribeConnectionStatus?(handler: (state: CodexConnectionState) => void): () => void
}

const endpointTransports = new WeakMap<CodexEndpoint, CodexEndpointTransport>()
const activeConnections = new WeakMap<CodexEndpoint, symbol>()

/** @internal Creates a public endpoint while retaining private connection-state hooks. */
export const createCodexEndpoint = (transport: CodexEndpointTransport): CodexEndpoint => {
  const endpoint = {
    notify: (method: CodexClientNotificationMethod, params?: unknown) =>
      transport.notify(method, params as never),
    request: (method: CodexClientMethod, params?: unknown, options?: CodexRequestOptions) =>
      transport.request(method, params as never, options),
    respond: (method: CodexServerMethod, requestId: CypheriaRequestId, response: unknown) =>
      transport.respond(method, requestId, response as never),
    subscribe: (handler: (message: CodexServerMessage) => void) => transport.subscribe(handler),
  } as CodexEndpoint
  endpointTransports.set(endpoint, transport)
  return endpoint
}

/** @internal Reserves one endpoint for one ClientApp and observes transport termination. */
export const attachCodexEndpoint = (
  endpoint: CodexEndpoint,
  onTransportClosed: (error: Error) => void
): (() => void) => {
  if (activeConnections.has(endpoint)) {
    throw new Error("This Cypheria Codex endpoint already has an active connection")
  }

  const token = Symbol("cypheria-codex-connection")
  activeConnections.set(endpoint, token)
  let active = true
  let unsubscribeStatus: (() => void) | undefined

  const release = (): void => {
    if (!active) return
    active = false
    unsubscribeStatus?.()
    unsubscribeStatus = undefined
    if (activeConnections.get(endpoint) === token) activeConnections.delete(endpoint)
  }

  const transport = endpointTransports.get(endpoint)
  const removeStatus = transport?.subscribeConnectionStatus?.((state) => {
    if (state.status !== "disconnected" && state.status !== "disposed") return
    const error = new Error(
      state.status === "disconnected"
        ? `Cypheria connection disconnected: ${state.reason}`
        : "Cypheria client closed"
    )
    release()
    onTransportClosed(error)
  })
  if (active) unsubscribeStatus = removeStatus
  else removeStatus?.()

  return release
}
