import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js"
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
  onmessage?: (data: string | ArrayBuffer) => void
  onopen?: () => void
}

type ChannelState = "closed" | "handshaking" | "open"
type ChannelRole = "client" | "server"
type E2EECapabilities = { binaryCiphertext?: boolean }
type E2EEHelloMessage = { capabilities?: E2EECapabilities; key: string; type: "e2ee_hello" }
type E2EEReadyMessage = { capabilities?: E2EECapabilities; type: "e2ee_ready" }

const HANDSHAKE_RETRY_MS = 1_000
const SERVER_HANDSHAKE_TIMEOUT_MS = 15_000
const MAX_PENDING_SENDS = 200
const ENCRYPTED_PAYLOAD_OVERHEAD_BYTES = 40
const REHANDSHAKE_REJECTION_CODE = 1008
const REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON = "E2EE re-handshake key mismatch"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCapabilities = (value: unknown): value is E2EECapabilities =>
  value === undefined ||
  (isRecord(value) &&
    (value.binaryCiphertext === undefined || typeof value.binaryCiphertext === "boolean"))

export const isE2EEHelloMessage = (value: unknown): value is E2EEHelloMessage =>
  isRecord(value) &&
  value.type === "e2ee_hello" &&
  typeof value.key === "string" &&
  value.key.trim().length > 0 &&
  isCapabilities(value.capabilities)

const isE2EEReadyMessage = (value: unknown): value is E2EEReadyMessage =>
  isRecord(value) && value.type === "e2ee_ready" && isCapabilities(value.capabilities)

const supportsBinary = (message: E2EEHelloMessage | E2EEReadyMessage): boolean =>
  message.capabilities?.binaryCiphertext === true

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

const decodePlaintext = (data: ArrayBuffer, isBinary: boolean | null): string | ArrayBuffer => {
  if (isBinary === true) return data
  if (isBinary === false) return new TextDecoder("utf-8", { fatal: true }).decode(data)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data)
  } catch {
    return data
  }
}

export const base64EncryptedWireByteLength = (plaintextBytes: number): number =>
  4 * Math.ceil((plaintextBytes + ENCRYPTED_PAYLOAD_OVERHEAD_BYTES) / 3)

export const maxBase64EncryptedPlaintextByteLength = (wireBytes: number): number =>
  Math.floor(wireBytes / 4) * 3 - ENCRYPTED_PAYLOAD_OVERHEAD_BYTES

export class EncryptedChannel {
  readonly #events: EncryptedChannelEvents
  readonly #decryptKey: SharedKey
  readonly #encryptKey: SharedKey
  readonly #sharedKey: SharedKey
  readonly #transport: Transport
  readonly #daemonKeyPair: KeyPair | undefined
  readonly #onOpenCallbacks: Array<() => void> = []
  readonly #onCloseCallbacks: Array<() => void> = []
  #binaryCiphertext: boolean
  #pendingSends: Array<string | ArrayBuffer> = []
  #state: ChannelState = "handshaking"

  constructor(
    transport: Transport,
    sharedKey: SharedKey,
    events: EncryptedChannelEvents = {},
    options: { binaryCiphertext?: boolean; daemonKeyPair?: KeyPair; role: ChannelRole }
  ) {
    this.#transport = transport
    this.#sharedKey = sharedKey
    const directionalKeys = deriveDirectionalKeys(sharedKey)
    this.#encryptKey =
      options.role === "client" ? directionalKeys.clientToServer : directionalKeys.serverToClient
    this.#decryptKey =
      options.role === "client" ? directionalKeys.serverToClient : directionalKeys.clientToServer
    this.#events = events
    this.#daemonKeyPair = options.daemonKeyPair
    this.#binaryCiphertext = options.binaryCiphertext ?? false
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

  async send(data: string | ArrayBuffer): Promise<void> {
    if (this.#state === "handshaking") {
      if (this.#pendingSends.length >= MAX_PENDING_SENDS) this.#pendingSends.shift()
      this.#pendingSends.push(data)
      return
    }
    if (this.#state !== "open") throw new Error("Channel not open")
    const ciphertext = encrypt(this.#encryptKey, data)
    if (this.#binaryCiphertext && data instanceof ArrayBuffer) {
      await this.#transport.send(ciphertext)
    } else {
      await this.#transport.send(arrayBufferToBase64(ciphertext))
    }
  }

  outboundWireByteLength(data: string | ArrayBuffer): number {
    const plaintextBytes =
      typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength
    return this.#binaryCiphertext && data instanceof ArrayBuffer
      ? plaintextBytes + ENCRYPTED_PAYLOAD_OVERHEAD_BYTES
      : base64EncryptedWireByteLength(plaintextBytes)
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
        this.#binaryCiphertext = supportsBinary(parsed)
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
            await this.#handleDaemonRehello(parsed)
            return
          }
          if (isE2EEReadyMessage(parsed)) return
          throw new Error("Received plaintext frame on encrypted channel")
        }
      }

      let ciphertext: ArrayBuffer
      let binaryKind: boolean | null
      if (this.#binaryCiphertext) {
        ciphertext = message.isBinary
          ? requireArrayBuffer(message.data)
          : base64ToArrayBuffer(decodeText(message.data))
        binaryKind = message.isBinary
      } else if (!message.isBinary) {
        ciphertext = base64ToArrayBuffer(decodeText(message.data))
        binaryKind = null
      } else {
        try {
          ciphertext = base64ToArrayBuffer(decodeText(message.data))
        } catch {
          ciphertext = requireArrayBuffer(message.data)
        }
        binaryKind = null
      }
      this.#events.onmessage?.(decodePlaintext(decrypt(this.#decryptKey, ciphertext), binaryKind))
    } catch (error) {
      this.#fail(error)
    }
  }

  async #handleDaemonRehello(message: E2EEHelloMessage): Promise<void> {
    if (!this.#daemonKeyPair) return
    const retryKey = deriveSharedKey(this.#daemonKeyPair.secretKey, importPublicKey(message.key))
    if (!constantTimeEqual(retryKey, this.#sharedKey)) {
      this.#state = "closed"
      this.#transport.close(REHANDSHAKE_REJECTION_CODE, REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON)
      return
    }
    await this.#transport.send(
      JSON.stringify({
        ...(this.#binaryCiphertext ? { capabilities: { binaryCiphertext: true } } : {}),
        type: "e2ee_ready",
      } satisfies E2EEReadyMessage)
    )
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
    capabilities: { binaryCiphertext: true },
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
          const binaryCiphertext = supportsBinary(parsed)
          await transport.send(
            JSON.stringify({
              ...(binaryCiphertext ? { capabilities: { binaryCiphertext: true } } : {}),
              type: "e2ee_ready",
            } satisfies E2EEReadyMessage)
          )
          if (settled) return
          const channel = new EncryptedChannel(transport, sharedKey, events, {
            binaryCiphertext,
            daemonKeyPair: serverKeyPair,
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
export const createDaemonChannel = createServerChannel
