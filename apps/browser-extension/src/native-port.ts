import { Peer, PeerError } from "./peer.ts"
import {
  DesktopStatusSchema,
  HelloResultSchema,
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  type ProtocolError,
} from "./protocol.ts"

/** What the extension shows about its connection, kept for diagnostics. */
export type ConnectionStatus = {
  readonly state: "connecting" | "connected" | "waiting_for_desktop" | "disconnected"
  readonly error?: ProtocolError
  readonly desktopVersion?: string
  readonly hostVersion?: string
  readonly updatedAt: number
}

export type NativePortLike = {
  postMessage(message: unknown): void
  disconnect(): void
  readonly onMessage: { addListener(listener: (message: unknown) => void): void }
  readonly onDisconnect: { addListener(listener: () => void): void }
}

export type NativeConnectionOptions = {
  readonly connectNative: (name: string) => NativePortLike
  /** The reason Chrome gave for the last disconnect. */
  readonly lastError: () => string | undefined
  readonly extensionId: string
  readonly extensionVersion: string
  readonly onRequest: (method: string, params: unknown) => Promise<unknown>
  readonly onStatus?: (status: ConnectionStatus) => void
  /** Called when Desktop connects, so the backend can report state it lost. */
  readonly onDesktopConnected?: () => void
  /** Schedules a wake-up that survives the service worker sleeping; `chrome.alarms` in the extension. */
  readonly scheduleWakeup?: (delayMs: number) => void
}

const MAX_RETRY_MS = 30_000

/**
 * The extension's port to its native host. It sends `hello`, keeps the port open while Desktop
 * comes and goes (the host reports that), and reconnects with backoff when the host itself goes
 * away, such as when it is not installed yet. An open port keeps the service worker alive.
 */
export class NativeConnection {
  readonly #options: NativeConnectionOptions
  #port: NativePortLike | undefined
  #peer: Peer | undefined
  #retry = 1_000
  #timer: ReturnType<typeof setTimeout> | undefined
  #status: ConnectionStatus = { state: "disconnected", updatedAt: Date.now() }

  constructor(options: NativeConnectionOptions) {
    this.#options = options
  }

  get status(): ConnectionStatus {
    return this.#status
  }

  /** Sends a notification to Desktop when connected; dropped otherwise. */
  notify(method: string, params: unknown): void {
    if (this.#status.state !== "connected") return
    try {
      this.#peer?.notify(method, params)
    } catch {
      // The port closed; the disconnect handler reconnects.
    }
  }

  connect(): void {
    if (this.#port) return
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#setStatus({ state: "connecting" })
    let port: NativePortLike
    try {
      port = this.#options.connectNative(NATIVE_HOST_NAME)
    } catch (error) {
      this.#setStatus({
        error: { code: "failed", message: error instanceof Error ? error.message : String(error) },
        state: "disconnected",
      })
      this.#scheduleReconnect()
      return
    }
    const peer = new Peer({
      onNotification: (method, params) => this.#onNotification(method, params),
      onRequest: this.#options.onRequest,
      send: (message) => port.postMessage(message),
      timeoutMs: 30_000,
    })
    this.#port = port
    this.#peer = peer
    port.onMessage.addListener((message) => peer.receive(message))
    port.onDisconnect.addListener(() => {
      if (this.#port !== port) return
      this.#port = undefined
      this.#peer = undefined
      peer.close(new PeerError("failed", "The native host disconnected."))
      const reason = this.#options.lastError()
      this.#setStatus({
        state: "disconnected",
        ...(reason ? { error: { code: "failed", message: reason } } : {}),
      })
      this.#scheduleReconnect()
    })
    void this.#hello(peer)
  }

  async #hello(peer: Peer): Promise<void> {
    try {
      const result = HelloResultSchema.parse(
        await peer.request("hello", {
          extensionId: this.#options.extensionId,
          extensionVersion: this.#options.extensionVersion,
          protocolVersion: PROTOCOL_VERSION,
        })
      )
      this.#retry = 1_000
      this.#setStatus({
        desktopVersion: result.desktopVersion,
        hostVersion: result.hostVersion,
        state: "connected",
      })
      this.#options.onDesktopConnected?.()
    } catch (error) {
      if (this.#peer !== peer) return
      const code = error instanceof PeerError ? error.code : "failed"
      const message = error instanceof Error ? error.message : String(error)
      // Without Desktop the host stays connected and reports when Desktop starts.
      this.#setStatus({
        error: { code, message },
        state: code === "desktop_not_running" ? "waiting_for_desktop" : "disconnected",
      })
      if (code !== "desktop_not_running") {
        this.#port?.disconnect()
        this.#port = undefined
        this.#peer = undefined
        this.#scheduleReconnect()
      }
    }
  }

  #onNotification(method: string, params: unknown): void {
    if (method !== "desktopStatus") return
    const parsed = DesktopStatusSchema.safeParse(params)
    if (!parsed.success) return
    const { desktopVersion, error, state } = parsed.data
    if (state === "connected") {
      this.#setStatus({ state: "connected", ...(desktopVersion ? { desktopVersion } : {}) })
      this.#options.onDesktopConnected?.()
    } else {
      this.#setStatus({ state: "waiting_for_desktop", ...(error ? { error } : {}) })
    }
  }

  #scheduleReconnect(): void {
    if (this.#timer) return
    const delay = this.#retry
    this.#retry = Math.min(this.#retry * 2, MAX_RETRY_MS)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.connect()
    }, delay)
    this.#options.scheduleWakeup?.(delay)
  }

  #setStatus(
    status: Omit<ConnectionStatus, "updatedAt" | "hostVersion"> & { hostVersion?: string }
  ): void {
    this.#status = {
      ...status,
      ...((status.hostVersion ?? this.#status.hostVersion)
        ? { hostVersion: status.hostVersion ?? this.#status.hostVersion }
        : {}),
      updatedAt: Date.now(),
    } as ConnectionStatus
    this.#options.onStatus?.(this.#status)
  }
}
