import type {
  AgentPiServerMessage,
  PiBlockingExtensionUIMethod,
  PiExtensionUIResponse,
  PiRpcCommandName,
  PiRpcParams,
  PiRpcResult,
} from "@cypheria/protocol"

import type { RequestOptions } from "./request-options.js"

type DistributiveOmit<Value, Keys extends PropertyKey> = Value extends unknown
  ? Omit<Value, Extract<Keys, keyof Value>>
  : never

export type PiExtensionUIAnswer<Method extends PiBlockingExtensionUIMethod> = DistributiveOmit<
  PiExtensionUIResponse<Method>,
  "id" | "type"
>

export interface PiEndpoint {
  request<Command extends PiRpcCommandName>(
    command: Command,
    params: PiRpcParams<Command>,
    options?: RequestOptions
  ): Promise<PiRpcResult<Command>>
  respondToExtensionUI<Method extends PiBlockingExtensionUIMethod>(
    method: Method,
    requestId: string,
    answer: PiExtensionUIAnswer<Method>
  ): Promise<void>
  subscribe(handler: (message: AgentPiServerMessage) => void): () => void
}

export type PiConnectionState =
  | { readonly status: "idle" }
  | { readonly attempt: number; readonly status: "connecting" }
  | { readonly status: "connected" }
  | { readonly reason: string; readonly status: "disconnected" }
  | { readonly status: "disposed" }

interface PiEndpointTransport extends PiEndpoint {
  subscribeConnectionStatus?(handler: (state: PiConnectionState) => void): () => void
}

const endpointTransports = new WeakMap<PiEndpoint, PiEndpointTransport>()

export const isPiServerMessage = (message: {
  readonly type: string
}): message is AgentPiServerMessage => message.type.startsWith("agent.pi.")

/** @internal Creates the minimal transport-neutral Pi capability facade. */
export const createPiEndpoint = (transport: PiEndpointTransport): PiEndpoint => {
  const endpoint: PiEndpoint = {
    request: (command, params, options) => transport.request(command, params, options),
    respondToExtensionUI: (method, requestId, answer) =>
      transport.respondToExtensionUI(method, requestId, answer),
    subscribe: (handler) => transport.subscribe(handler),
  }
  endpointTransports.set(endpoint, transport)
  return endpoint
}

/** @internal Observes termination of the underlying Cypheria connection. */
export const observePiEndpoint = (
  endpoint: PiEndpoint,
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
