import { classify, type ProtocolErrorCode } from "./protocol.ts"

/** An error a peer answered with, carrying its protocol code. */
export class PeerError extends Error {
  readonly code: string

  constructor(code: ProtocolErrorCode | (string & {}), message: string) {
    super(message)
    this.name = "PeerError"
    this.code = code
  }
}

type Pending = {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout> | undefined
}

export type PeerOptions = {
  /** Sends one message to the other side. */
  readonly send: (message: unknown) => void
  readonly onRequest?: (method: string, params: unknown) => Promise<unknown>
  readonly onNotification?: (method: string, params: unknown) => void
  /** How long a request may wait for its response; unlimited when omitted. */
  readonly timeoutMs?: number
}

/**
 * One end of the extension protocol: it numbers requests, matches responses, and answers the
 * other side's requests with the handler's result or its error.
 */
export class Peer {
  readonly #options: PeerOptions
  readonly #pending = new Map<string, Pending>()
  #nextId = 1

  constructor(options: PeerOptions) {
    this.#options = options
  }

  request(method: string, params?: unknown, timeoutMs = this.#options.timeoutMs): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.#pending.delete(String(id))
              reject(new PeerError("failed", `${method} did not answer within ${timeoutMs} ms.`))
            }, timeoutMs)
      this.#pending.set(String(id), { reject, resolve, timer })
      try {
        this.#options.send({ id, method, ...(params === undefined ? {} : { params }) })
      } catch (error) {
        this.#settle(String(id))?.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, params?: unknown): void {
    this.#options.send({ method, ...(params === undefined ? {} : { params }) })
  }

  /** Handles one message from the other side. */
  receive(message: unknown): void {
    const classified = classify(message)
    if (!classified) return
    if (classified.kind === "response") {
      const pending = this.#settle(String(classified.message.id))
      if (!pending) return
      if ("error" in classified.message) {
        const { code, message: text } = classified.message.error
        pending.reject(new PeerError(code, text))
      } else {
        pending.resolve(classified.message.result)
      }
      return
    }
    if (classified.kind === "notification") {
      this.#options.onNotification?.(classified.message.method, classified.message.params)
      return
    }
    const { id, method, params } = classified.message
    const handler = this.#options.onRequest
    void (async () => {
      try {
        if (!handler) throw new PeerError("invalid", `Unknown method ${method}.`)
        const result = await handler(method, params)
        this.#options.send({ id, result: result ?? null })
      } catch (error) {
        this.#options.send({
          error: {
            code: error instanceof PeerError ? error.code : "failed",
            message: (error instanceof Error ? error.message : String(error)).slice(0, 4_096),
          },
          id,
        })
      }
    })()
  }

  /** Fails every request still waiting, such as when the connection closed. */
  close(error: Error): void {
    for (const id of [...this.#pending.keys()]) this.#settle(id)?.reject(error)
  }

  #settle(id: string): Pending | undefined {
    const pending = this.#pending.get(id)
    this.#pending.delete(id)
    if (pending?.timer !== undefined) clearTimeout(pending.timer)
    return pending
  }
}
