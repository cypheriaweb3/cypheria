import {
  decrypt,
  deriveDirectionalKeys,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
  type KeyPair,
  type SharedKey,
} from "./crypto.js"

export type TransportMessage = { data: string | ArrayBuffer; isBinary: boolean }

export interface Transport {
  close(code?: number, reason?: string): void
  onclose: ((code: number, reason: string) => void) | null
  onerror: ((error: Error) => void) | null
  onmessage: ((message: TransportMessage) => void) | null
  send(data: string | ArrayBuffer): Promise<void> | void
}

export type EncryptedChannelEvents = {
  onclose?: (code: number, reason: string) => void
  onerror?: (error: Error) => void
  onmessage?: (data: ArrayBuffer) => void
  onopen?: () => void
}

type ChannelState = "closed" | "handshaking" | "open"
type ChannelRole = "client" | "server"
type E2EEHelloMessage = { key: string; type: "e2ee_hello" }
type E2EEReadyMessage = { type: "e2ee_ready" }

const HANDSHAKE_RETRY_MS = 1_000
const SERVER_HANDSHAKE_TIMEOUT_MS = 15_000
const MAX_PENDING_SENDS = 200
const ENCRYPTED_PAYLOAD_OVERHEAD_BYTES = 40
const REHANDSHAKE_REJECTION_CODE = 1008
const REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON = "E2EE re-handshake key mismatch"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const isE2EEHelloMessage = (value: unknown): value is E2EEHelloMessage =>
  isRecord(value) &&
  value.type === "e2ee_hello" &&
  typeof value.key === "string" &&
  value.key.trim().length > 0

const isE2EEReadyMessage = (value: unknown): value is E2EEReadyMessage =>
  isRecord(value) && value.type === "e2ee_ready"

const decodeText = (data: string | ArrayBuffer): string =>
  typeof data === "string" ? data : new TextDecoder().decode(data)

const requireArrayBuffer = (data: string | ArrayBuffer): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data
  throw new Error("Binary WebSocket frame did not contain bytes")
}

const constantTimeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

export class EncryptedChannel {
  readonly #events: EncryptedChannelEvents
  readonly #decryptKey: SharedKey
  readonly #encryptKey: SharedKey
  readonly #sharedKey: SharedKey
  readonly #transport: Transport
  readonly #serverKeyPair: KeyPair | undefined
  readonly #onOpenCallbacks: Array<() => void> = []
  readonly #onCloseCallbacks: Array<() => void> = []
  #pendingSends: Array<ArrayBuffer> = []
  #state: ChannelState = "handshaking"

  constructor(
    transport: Transport,
    sharedKey: SharedKey,
    events: EncryptedChannelEvents = {},
    options: { role: ChannelRole; serverKeyPair?: KeyPair }
  ) {
    this.#transport = transport
    this.#sharedKey = sharedKey
    const directionalKeys = deriveDirectionalKeys(sharedKey)
    this.#encryptKey =
      options.role === "client" ? directionalKeys.clientToServer : directionalKeys.serverToClient
    this.#decryptKey =
      options.role === "client" ? directionalKeys.serverToClient : directionalKeys.clientToServer
    this.#events = events
    this.#serverKeyPair = options.serverKeyPair
    transport.onmessage = (message) => void this.#handleMessage(message)
    transport.onclose = (code, reason) => {
      this.#state = "closed"
      events.onclose?.(code, reason)
      for (const callback of this.#onCloseCallbacks) callback()
    }
    transport.onerror = (error) => events.onerror?.(error)
  }

  setState(state: ChannelState): void {
    this.#state = state
  }

  async send(data: ArrayBuffer): Promise<void> {
    if (this.#state === "handshaking") {
      if (this.#pendingSends.length >= MAX_PENDING_SENDS) this.#pendingSends.shift()
      this.#pendingSends.push(data)
      return
    }
    if (this.#state !== "open") throw new Error("Channel not open")
    await this.#transport.send(encrypt(this.#encryptKey, data))
  }

  outboundWireByteLength(data: ArrayBuffer): number {
    return data.byteLength + ENCRYPTED_PAYLOAD_OVERHEAD_BYTES
  }

  close(code = 1000, reason = "Normal closure"): void {
    this.#state = "closed"
    this.#transport.close(code, reason)
  }

  isOpen(): boolean {
    return this.#state === "open"
  }

  onTransitionToOpen(callback: () => void): void {
    this.#onOpenCallbacks.push(callback)
  }

  onClose(callback: () => void): void {
    this.#onCloseCallbacks.push(callback)
  }

  async #handleMessage(message: TransportMessage): Promise<void> {
    if (this.#state === "handshaking") {
      try {
        if (message.isBinary) return
        const parsed: unknown = JSON.parse(decodeText(message.data))
        if (!isE2EEReadyMessage(parsed)) return
        this.#state = "open"
        this.#events.onopen?.()
        for (const callback of this.#onOpenCallbacks) callback()
        const pending = this.#pendingSends
        this.#pendingSends = []
        for (const item of pending) await this.send(item)
      } catch (error) {
        this.#fail(error)
      }
      return
    }
    if (this.#state !== "open") return

    try {
      if (!message.isBinary) {
        const text = decodeText(message.data)
        if (text.trim().startsWith("{")) {
          const parsed: unknown = JSON.parse(text)
          if (isE2EEHelloMessage(parsed)) {
            await this.#handleServerRehello(parsed)
            return
          }
          if (isE2EEReadyMessage(parsed)) return
          throw new Error("Received plaintext frame on encrypted channel")
        }
        throw new Error("Encrypted application messages must use binary frames")
      }
      this.#events.onmessage?.(decrypt(this.#decryptKey, requireArrayBuffer(message.data)))
    } catch (error) {
      this.#fail(error)
    }
  }

  async #handleServerRehello(message: E2EEHelloMessage): Promise<void> {
    if (!this.#serverKeyPair) return
    const retryKey = deriveSharedKey(this.#serverKeyPair.secretKey, importPublicKey(message.key))
    if (!constantTimeEqual(retryKey, this.#sharedKey)) {
      this.#state = "closed"
      this.#transport.close(REHANDSHAKE_REJECTION_CODE, REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON)
      return
    }
    await this.#transport.send(JSON.stringify({ type: "e2ee_ready" } satisfies E2EEReadyMessage))
  }

  #fail(value: unknown): void {
    const error = value instanceof Error ? value : new Error(String(value))
    this.#events.onerror?.(error)
    this.#state = "closed"
    try {
      this.#transport.close(1011, error.message)
    } catch {
      // The underlying transport may already be closed.
    }
  }
}

export const createClientChannel = async (
  transport: Transport,
  serverPublicKeyB64: string,
  events: EncryptedChannelEvents = {}
): Promise<EncryptedChannel> => {
  const keyPair = generateKeyPair()
  const sharedKey = deriveSharedKey(keyPair.secretKey, importPublicKey(serverPublicKeyB64))
  const channel = new EncryptedChannel(transport, sharedKey, events, { role: "client" })
  const hello = JSON.stringify({
    key: exportPublicKey(keyPair.publicKey),
    type: "e2ee_hello",
  } satisfies E2EEHelloMessage)

  const sendHello = (): void => {
    try {
      const result = transport.send(hello)
      if (result) void result.catch((error) => events.onerror?.(error))
    } catch (error) {
      events.onerror?.(error instanceof Error ? error : new Error(String(error)))
    }
  }
  let retry: ReturnType<typeof setInterval> | undefined
  const clearRetry = (): void => {
    if (retry) clearInterval(retry)
    retry = undefined
  }
  channel.onTransitionToOpen(clearRetry)
  channel.onClose(clearRetry)
  sendHello()
  retry = setInterval(() => {
    if (channel.isOpen()) clearRetry()
    else sendHello()
  }, HANDSHAKE_RETRY_MS)
  const timeout = retry as unknown
  if (
    typeof timeout === "object" &&
    timeout !== null &&
    "unref" in timeout &&
    typeof timeout.unref === "function"
  ) {
    timeout.unref()
  }
  return channel
}

export const createServerChannel = async (
  transport: Transport,
  serverKeyPair: KeyPair,
  events: EncryptedChannelEvents = {},
  options: { handshakeTimeoutMs?: number } = {}
): Promise<EncryptedChannel> =>
  new Promise((resolve, reject) => {
    const buffered: TransportMessage[] = []
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const fail = (value: unknown): void => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      const error = value instanceof Error ? value : new Error(String(value))
      try {
        transport.close(1008, error.message.slice(0, 123))
      } catch {
        // A failed transport may already be closed.
      }
      reject(error)
    }
    timeout = setTimeout(() => {
      fail(new Error("Timed out waiting for E2EE hello"))
    }, options.handshakeTimeoutMs ?? SERVER_HANDSHAKE_TIMEOUT_MS)
    const timeoutWithUnref = timeout as unknown
    if (
      typeof timeoutWithUnref === "object" &&
      timeoutWithUnref !== null &&
      "unref" in timeoutWithUnref &&
      typeof timeoutWithUnref.unref === "function"
    ) {
      timeoutWithUnref.unref()
    }
    transport.onerror = fail
    transport.onclose = (code, reason) =>
      fail(new Error(`Connection closed during E2EE handshake: ${code} ${reason}`))
    transport.onmessage = (message) => {
      void (async () => {
        try {
          if (message.isBinary) throw new Error("E2EE hello must be a text frame")
          const parsed: unknown = JSON.parse(decodeText(message.data))
          if (!isE2EEHelloMessage(parsed)) throw new Error("Invalid E2EE hello message")
          transport.onmessage = (next) => buffered.push(next)
          const sharedKey = deriveSharedKey(serverKeyPair.secretKey, importPublicKey(parsed.key))
          await transport.send(JSON.stringify({ type: "e2ee_ready" } satisfies E2EEReadyMessage))
          if (settled) return
          const channel = new EncryptedChannel(transport, sharedKey, events, {
            serverKeyPair,
            role: "server",
          })
          channel.setState("open")
          events.onopen?.()
          for (const item of buffered) transport.onmessage?.(item)
          settled = true
          clearTimeout(timeout)
          resolve(channel)
        } catch (error) {
          fail(error)
        }
      })()
    }
  })

/** @deprecated Use createServerChannel. */
