import type * as AcpV1 from "@agentclientprotocol/sdk"
import type * as AcpV2 from "@agentclientprotocol/sdk/experimental/v2"
import {
  ACP_V1_PROTOCOL_VERSION,
  ACP_V2_PROTOCOL_VERSION,
  type AcpClientWirePayload,
  AcpClientWirePayloadSchema,
  type AcpServerWirePayload,
  type AcpV1AgentMessage,
  type AcpV1ClientMessage,
  type AcpV2AgentWireMessage,
  type AcpV2ClientWireMessage,
} from "@cypheria/protocol"

export type AcpTransportState =
  | { readonly status: "idle" }
  | { readonly attempt: number; readonly status: "connecting" }
  | { readonly sessionId: string; readonly status: "connected" }
  | { readonly reason: string; readonly status: "disconnected" }
  | { readonly status: "disposed" }

/** The Cypheria ACP endpoint accepted by ClientApp.connect() and connectWith(). */
export interface AcpEndpoint {
  send(payload: AcpClientWirePayload): Promise<void>
  subscribe(handler: (payload: AcpServerWirePayload) => void): () => void
}

interface AcpEndpointTransport extends AcpEndpoint {
  subscribeConnectionStatus?(handler: (state: AcpTransportState) => void): () => void
}

type BridgeStream<OutgoingMessage, IncomingMessage> = {
  readonly readable: ReadableStream<IncomingMessage>
  readonly writable: WritableStream<OutgoingMessage>
  close(error?: unknown): void
}

const endpointTransports = new WeakMap<AcpEndpoint, AcpEndpointTransport>()
const activeStreams = new WeakMap<AcpEndpoint, symbol>()

const asError = (value: unknown, fallback: string): Error =>
  value instanceof Error ? value : new Error(value === undefined ? fallback : String(value))

/** @internal Creates a stable public endpoint while retaining private lifecycle hooks. */
export const createAcpEndpoint = (transport: AcpEndpointTransport): AcpEndpoint => {
  const endpoint: AcpEndpoint = {
    send: (payload) => transport.send(payload),
    subscribe: (handler) => transport.subscribe(handler),
  }
  endpointTransports.set(endpoint, transport)
  return endpoint
}

const createBridgeStream = <OutgoingMessage, IncomingMessage>(
  endpoint: AcpEndpoint,
  protocolVersion: 1 | 2,
  onClose: () => void
): BridgeStream<OutgoingMessage, IncomingMessage> => {
  const transport: AcpEndpointTransport = endpointTransports.get(endpoint) ?? endpoint
  let active = true
  let controller: ReadableStreamDefaultController<IncomingMessage> | undefined
  let unsubscribeMessages: (() => void) | undefined
  let unsubscribeStatus: (() => void) | undefined

  const cleanup = (): void => {
    if (!active) return
    active = false
    unsubscribeMessages?.()
    unsubscribeMessages = undefined
    unsubscribeStatus?.()
    unsubscribeStatus = undefined
    onClose()
  }

  const terminate = (error?: unknown): void => {
    if (!active) return
    const readableController = controller
    cleanup()
    if (!readableController) return
    try {
      if (error === undefined) readableController.close()
      else readableController.error(error)
    } catch {
      // The ACP connection may already have cancelled its reader.
    }
  }

  const readable = new ReadableStream<IncomingMessage>({
    start(readableController) {
      controller = readableController
      const removeMessages = transport.subscribe((payload) => {
        if (!active || payload.protocolVersion !== protocolVersion) return
        try {
          readableController.enqueue(payload.message as IncomingMessage)
        } catch (error) {
          terminate(error)
        }
      })
      if (active) unsubscribeMessages = removeMessages
      else removeMessages()

      const removeStatus = transport.subscribeConnectionStatus?.((state) => {
        if (state.status === "disconnected") {
          terminate(new Error(`Cypheria connection disconnected: ${state.reason}`))
        } else if (state.status === "disposed") {
          terminate(new Error("Cypheria client closed"))
        }
      })
      if (active) unsubscribeStatus = removeStatus
      else removeStatus?.()
    },
    cancel() {
      cleanup()
    },
  })

  const writable = new WritableStream<OutgoingMessage>({
    async write(message) {
      if (!active) throw new Error("Cypheria ACP connection is closed")
      try {
        const payload = AcpClientWirePayloadSchema.parse({ message, protocolVersion })
        await transport.send(payload)
      } catch (error) {
        const failure = asError(error, "Failed to send Cypheria ACP message")
        terminate(failure)
        throw failure
      }
    },
    close() {
      terminate()
    },
    abort(reason) {
      terminate(reason)
    },
  })

  return { close: terminate, readable, writable }
}

const openStream = <Stream extends { close(error?: unknown): void }>(
  endpoint: AcpEndpoint,
  create: (onClose: () => void) => Stream
): Stream => {
  if (activeStreams.has(endpoint)) {
    throw new Error("This Cypheria ACP endpoint already has an active connection")
  }
  const token = Symbol("cypheria-acp-connection")
  activeStreams.set(endpoint, token)
  try {
    return create(() => {
      if (activeStreams.get(endpoint) === token) activeStreams.delete(endpoint)
    })
  } catch (error) {
    if (activeStreams.get(endpoint) === token) activeStreams.delete(endpoint)
    throw error
  }
}

/** @internal Opens the SDK's stable stream behind a Cypheria ACP endpoint. */
export const openAcpV1Stream = (
  endpoint: AcpEndpoint
): AcpV1.Stream & BridgeStream<AcpV1ClientMessage, AcpV1AgentMessage> =>
  openStream(endpoint, (onClose) =>
    createBridgeStream<AcpV1ClientMessage, AcpV1AgentMessage>(
      endpoint,
      ACP_V1_PROTOCOL_VERSION,
      onClose
    )
  )

/** @internal Opens the SDK's draft-v2 stream behind a Cypheria ACP endpoint. */
export const openAcpV2Stream = (
  endpoint: AcpEndpoint
): AcpV2.Stream & BridgeStream<AcpV2ClientWireMessage, AcpV2AgentWireMessage> =>
  openStream(endpoint, (onClose) =>
    createBridgeStream<AcpV2ClientWireMessage, AcpV2AgentWireMessage>(
      endpoint,
      ACP_V2_PROTOCOL_VERSION,
      onClose
    )
  )
