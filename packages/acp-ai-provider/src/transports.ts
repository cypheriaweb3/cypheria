import type { AnyMessage } from "@agentclientprotocol/sdk"
import {
  createHttpStream,
  type HttpStreamOptions,
} from "@agentclientprotocol/sdk/experimental/http-client"
import {
  createWebSocketStream,
  type WebSocketStreamOptions,
} from "@agentclientprotocol/sdk/experimental/ws-client"
import type { ACPStreamTransport } from "./types.js"

export function createACPHttpTransport(
  serverUrl: string,
  options?: HttpStreamOptions
): ACPStreamTransport {
  let stream: ReturnType<typeof createHttpStream> | undefined
  return {
    type: "stream",
    connect() {
      stream = createHttpStream(serverUrl, options)
      return stream
    },
    async close() {
      await stream?.writable.close()
      stream = undefined
    },
  }
}

export function createACPWebSocketTransport(
  serverUrl: string,
  options?: WebSocketStreamOptions
): ACPStreamTransport {
  let stream: ReturnType<typeof createWebSocketStream<AnyMessage>> | undefined
  return {
    type: "stream",
    connect() {
      stream = createWebSocketStream<AnyMessage>(serverUrl, options)
      return stream
    },
    async close() {
      await stream?.writable.close()
      stream = undefined
    },
  }
}
