import { EngineError } from "./errors.ts"
import type { CdpEvent, CdpTransport } from "./transport.ts"

type Pending = {
  readonly resolve: (value: Record<string, unknown>) => void
  readonly reject: (error: Error) => void
  readonly method: string
}

type Message = {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { readonly message: string }
  readonly sessionId?: string
}

export type TargetInfo = {
  readonly targetId: string
  readonly type: string
  readonly title: string
  readonly url: string
  readonly attached: boolean
  readonly openerId?: string
  readonly browserContextId?: string
}

/**
 * A browser-level CDP connection over WebSocket, such as a running browser's DevTools endpoint. It
 * multiplexes page sessions with flattened `Target.attachToTarget`, so each tab gets its own
 * `CdpTransport`.
 */
export class CdpConnection {
  readonly #socket: WebSocket
  readonly #pending = new Map<number, Pending>()
  readonly #listeners = new Map<string, Set<(event: CdpEvent) => void>>()
  readonly #closeListeners = new Map<string, Set<() => void>>()
  readonly #browserListeners = new Set<(event: CdpEvent) => void>()
  #nextId = 1
  #closed = false

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.addEventListener("message", (event) => this.#onMessage(String(event.data)))
    socket.addEventListener("close", () => this.#onClose())
    socket.addEventListener("error", () => this.#onClose())
  }

  static async connect(url: string, timeoutMs = 10_000): Promise<CdpConnection> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new EngineError("cdp_unreachable", `Timed out connecting to ${url}.`))
      }, timeoutMs)
      socket.addEventListener("open", () => {
        clearTimeout(timer)
        resolve()
      })
      socket.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new EngineError("cdp_unreachable", `Could not connect to ${url}.`))
      })
    })
    return new CdpConnection(socket)
  }

  get closed(): boolean {
    return this.#closed
  }

  close(): void {
    this.#socket.close()
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new EngineError("cdp_closed", "The browser connection closed."))
    }
    const id = this.#nextId++
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { method, reject, resolve: resolve as (value: unknown) => void })
      this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  /** Browser-level events, such as targets appearing and closing. */
  onBrowserEvent(listener: (event: CdpEvent) => void): () => void {
    this.#browserListeners.add(listener)
    return () => this.#browserListeners.delete(listener)
  }

  async targets(): Promise<TargetInfo[]> {
    const result = await this.send<{ targetInfos: TargetInfo[] }>("Target.getTargets")
    return result.targetInfos.filter((target) => target.type === "page")
  }

  /** Attaches to a page target and returns its transport. */
  async attach(targetId: string): Promise<CdpTransport> {
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", {
      flatten: true,
      targetId,
    })
    return {
      detach: async () => {
        await this.send("Target.detachFromTarget", { sessionId }).catch(() => {})
        this.#detach(sessionId)
      },
      onClose: (listener) => {
        let set = this.#closeListeners.get(sessionId)
        if (!set) {
          set = new Set()
          this.#closeListeners.set(sessionId, set)
        }
        set.add(listener)
        return () => set.delete(listener)
      },
      onEvent: (listener) => {
        let set = this.#listeners.get(sessionId)
        if (!set) {
          set = new Set()
          this.#listeners.set(sessionId, set)
        }
        set.add(listener)
        return () => set.delete(listener)
      },
      send: (method, params) => this.send(method, params ?? {}, sessionId),
    }
  }

  #onMessage(data: string): void {
    let message: Message
    try {
      message = JSON.parse(data) as Message
    } catch {
      return
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (message.error) {
        pending.reject(new EngineError("cdp_error", `${pending.method}: ${message.error.message}`))
      } else {
        pending.resolve(message.result ?? {})
      }
      return
    }
    if (!message.method) return
    const event: CdpEvent = { method: message.method, params: message.params ?? {} }
    if (message.method === "Target.detachedFromTarget") {
      const sessionId = message.params?.sessionId as string | undefined
      if (sessionId) this.#detach(sessionId)
    }
    if (message.sessionId) {
      for (const listener of this.#listeners.get(message.sessionId) ?? []) listener(event)
    } else {
      for (const listener of this.#browserListeners) listener(event)
    }
  }

  #detach(sessionId: string): void {
    for (const listener of this.#closeListeners.get(sessionId) ?? []) listener()
    this.#closeListeners.delete(sessionId)
    this.#listeners.delete(sessionId)
  }

  #onClose(): void {
    if (this.#closed) return
    this.#closed = true
    for (const pending of this.#pending.values()) {
      pending.reject(new EngineError("cdp_closed", "The browser connection closed."))
    }
    this.#pending.clear()
    for (const sessionId of [...this.#closeListeners.keys()]) this.#detach(sessionId)
  }
}
