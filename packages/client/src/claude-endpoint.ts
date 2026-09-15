import type {
  AGENT_CLAUDE_RPC,
  AgentClaudeClientRequest,
  AgentClaudeRpcName,
  AgentClaudeServerMessage,
  AgentClaudeServerResponse,
} from "@cypheria/protocol"
import type { SDKUserMessage } from "@cypheria/protocol/claude-types"

import type { RequestOptions } from "./request-options.js"

export type ClaudeRpcParams<Method extends AgentClaudeRpcName> = Omit<
  Extract<AgentClaudeClientRequest, { type: (typeof AGENT_CLAUDE_RPC)[Method]["request"] }>,
  "requestId" | "type"
>

type ClaudeRpcResponse<Method extends AgentClaudeRpcName> = Extract<
  AgentClaudeServerResponse,
  { type: (typeof AGENT_CLAUDE_RPC)[Method]["response"] }
>

type ClaudeRpcSuccessPayload<Method extends AgentClaudeRpcName> = Exclude<
  ClaudeRpcResponse<Method>["payload"],
  { error: unknown }
>

export type ClaudeRpcResult<Method extends AgentClaudeRpcName> =
  ClaudeRpcSuccessPayload<Method> extends { result: infer Result } ? Result : undefined

export interface ClaudeEndpoint {
  completeInput(queryId: string): Promise<void>
  request<Method extends AgentClaudeRpcName>(
    method: Method,
    params: ClaudeRpcParams<Method>,
    options?: RequestOptions
  ): Promise<ClaudeRpcResult<Method>>
  sendInput(queryId: string, message: SDKUserMessage): Promise<void>
  subscribe(handler: (message: AgentClaudeServerMessage) => void): () => void
}

export type ClaudeConnectionState =
  | { readonly status: "idle" }
  | { readonly attempt: number; readonly status: "connecting" }
  | { readonly status: "connected" }
  | { readonly reason: string; readonly status: "disconnected" }
  | { readonly status: "disposed" }

interface ClaudeEndpointTransport extends ClaudeEndpoint {
  subscribeConnectionStatus?(handler: (state: ClaudeConnectionState) => void): () => void
}

const endpointTransports = new WeakMap<ClaudeEndpoint, ClaudeEndpointTransport>()

export const isClaudeServerMessage = (message: {
  readonly type: string
}): message is AgentClaudeServerMessage => message.type.startsWith("agent.claude.")

/** @internal Creates the minimal transport-neutral Claude capability facade. */
export const createClaudeEndpoint = (transport: ClaudeEndpointTransport): ClaudeEndpoint => {
  const endpoint: ClaudeEndpoint = {
    completeInput: (queryId) => transport.completeInput(queryId),
    request: (method, params, options) => transport.request(method, params as never, options),
    sendInput: (queryId, message) => transport.sendInput(queryId, message),
    subscribe: (handler) => transport.subscribe(handler),
  }
  endpointTransports.set(endpoint, transport)
  return endpoint
}

/** @internal Observes termination of the underlying Cypheria connection. */
export const observeClaudeEndpoint = (
  endpoint: ClaudeEndpoint,
  onTransportClosed: (error: Error) => void
): (() => void) => {
  const transport = endpointTransports.get(endpoint)
  return (
    transport?.subscribeConnectionStatus?.((state) => {
      if (state.status === "disconnected") {
        onTransportClosed(new Error(`Cypheria connection disconnected: ${state.reason}`))
      } else if (state.status === "disposed") {
        onTransportClosed(new Error("Cypheria client closed"))
      }
    }) ?? (() => undefined)
  )
}
