import type { ConnectionOfferV2 } from "@cypheria/protocol"
import {
  createClientChannel,
  type EncryptedChannel,
  resolveClientRelayWebSocketUrl,
  type Transport,
} from "@cypheria/relay"
import type { ServerTransport, ServerTransportFactory } from "./server-client-transport-types.js"

const toRelayFrame = (data: unknown): string | ArrayBuffer => {
  if (typeof data === "string" || data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const result = new Uint8Array(data.byteLength)
    result.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    return result.buffer
  }
  throw new Error("Relay sent an unsupported WebSocket frame")
}

export class RelayServerTransport implements ServerTransport {
  readonly #closeHandlers = new Set<(event?: unknown) => void>()
  readonly #errorHandlers = new Set<(event?: unknown) => void>()
  readonly #messageHandlers = new Set<(data: unknown, isBinary: boolean) => void>()
  readonly #openHandlers = new Set<() => void>()
  readonly #raw: ServerTransport
  readonly #removers: Array<() => void> = []
  readonly #serverPublicKeyB64: string
  #channel: EncryptedChannel | undefined

  constructor(raw: ServerTransport, serverPublicKeyB64: string) {
    this.#raw = raw
    this.#serverPublicKeyB64 = serverPublicKeyB64
    const adapter: Transport = {
      close: (code, reason) => raw.close(code, reason),
      onclose: null,
      onerror: null,
      onmessage: null,
      send: (data) => raw.send(data),
    }
    this.#removers.push(
      raw.onMessage((data, isBinary) => {
        try {
          adapter.onmessage?.({ data: toRelayFrame(data), isBinary })
        } catch (error) {
          adapter.onerror?.(error instanceof Error ? error : new Error(String(error)))
        }
      }),
      raw.onClose((event) => {
        const record = typeof event === "object" && event !== null ? event : {}
        const code = "code" in record && typeof record.code === "number" ? record.code : 1006
        const reason = "reason" in record && typeof record.reason === "string" ? record.reason : ""
        adapter.onclose?.(code, reason)
        for (const handler of this.#closeHandlers) handler(event)
      }),
      raw.onError((event) => {
        const error = event instanceof Error ? event : new Error("Relay transport failed")
        if (adapter.onerror) adapter.onerror(error)
        else for (const handler of this.#errorHandlers) handler(event)
      }),
      raw.onOpen(() => {
        void createClientChannel(adapter, this.#serverPublicKeyB64, {
          onerror: (error) => {
            for (const handler of this.#errorHandlers) handler(error)
          },
          onmessage: (data) => {
            for (const handler of this.#messageHandlers) {
              handler(data, data instanceof ArrayBuffer)
            }
          },
          onopen: () => {
            for (const handler of this.#openHandlers) handler()
          },
        })
          .then((channel) => {
            this.#channel = channel
          })
          .catch((error) => {
            for (const handler of this.#errorHandlers) handler(error)
            raw.close(1008, "Relay E2EE handshake failed")
          })
      })
    )
  }

  send(data: string | Uint8Array | ArrayBuffer): Promise<void> {
    const channel = this.#channel
    if (!channel) throw new Error("Relay E2EE channel is not ready")
    const normalized = data instanceof Uint8Array ? data.slice().buffer : data
    return channel.send(normalized)
  }

  close(code?: number, reason?: string): void {
    this.#channel?.close(code, reason)
    if (!this.#channel) this.#raw.close(code, reason)
    for (const remove of this.#removers.splice(0)) remove()
  }

  onOpen(handler: () => void): () => void {
    this.#openHandlers.add(handler)
    return () => this.#openHandlers.delete(handler)
  }

  onMessage(handler: (data: unknown, isBinary: boolean) => void): () => void {
    this.#messageHandlers.add(handler)
    return () => this.#messageHandlers.delete(handler)
  }

  onClose(handler: (event?: unknown) => void): () => void {
    this.#closeHandlers.add(handler)
    return () => this.#closeHandlers.delete(handler)
  }

  onError(handler: (event?: unknown) => void): () => void {
    this.#errorHandlers.add(handler)
    return () => this.#errorHandlers.delete(handler)
  }
}

export const createRelayServerTransportFactory =
  (offer: ConnectionOfferV2, rawFactory: ServerTransportFactory): ServerTransportFactory =>
  () =>
    new RelayServerTransport(
      rawFactory({ protocols: [], url: resolveClientRelayWebSocketUrl(offer) }),
      offer.serverPublicKeyB64
    )
