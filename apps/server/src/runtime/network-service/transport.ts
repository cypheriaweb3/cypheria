import { NetworkRuntimeError } from "./destination.js"

export type RpcTransportRequest = {
  readonly headers?: Readonly<Record<string, string>>
  readonly method: string
  readonly params?: unknown
  readonly timeoutMs: number
  readonly url: string
}

export type RpcTransport = (request: RpcTransportRequest) => Promise<unknown>

export type FetchRpcTransportOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly maxConcurrentRequests?: number
  readonly maxResponseBytes?: number
}

export type WebSocketRpcTransportOptions = {
  readonly createSocket?: (url: string) => WebSocket
  readonly maxConcurrentRequests?: number
  readonly maxResponseBytes?: number
}

const forbiddenHeaders = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "transfer-encoding",
])

const parseHeaders = (headers: Readonly<Record<string, string>> | undefined) => {
  const result = new Headers({ Accept: "application/json", "Content-Type": "application/json" })
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (forbiddenHeaders.has(name.toLowerCase()) || /[\r\n]/u.test(name + value)) {
      throw new NetworkRuntimeError("RPC_DESTINATION_BLOCKED", "The RPC headers are invalid.")
    }
    result.set(name, value)
  }
  return result
}

export const createFetchRpcTransport = (options: FetchRpcTransportOptions = {}): RpcTransport => {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const maxConcurrentRequests = options.maxConcurrentRequests ?? 16
  const maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024
  if (!Number.isSafeInteger(maxConcurrentRequests) || maxConcurrentRequests < 1) {
    throw new TypeError("maxConcurrentRequests must be a positive integer.")
  }
  let activeRequests = 0
  const waiters: Array<() => void> = []
  let requestId = 0

  const acquire = async () => {
    if (activeRequests >= maxConcurrentRequests) {
      await new Promise<void>((resolve) => waiters.push(resolve))
    }
    activeRequests += 1
  }

  const release = () => {
    activeRequests -= 1
    waiters.shift()?.()
  }

  return async (request) => {
    await acquire()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    try {
      const response = await fetchImplementation(request.url, {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++requestId,
          method: request.method,
          ...(request.params === undefined ? {} : { params: request.params }),
        }),
        headers: parseHeaders(request.headers),
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      })
      const contentLength = Number(response.headers.get("content-length") ?? 0)
      if (contentLength > maxResponseBytes) {
        throw new NetworkRuntimeError("RPC_REQUEST_FAILED", "The RPC response is too large.")
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > maxResponseBytes) {
        throw new NetworkRuntimeError("RPC_REQUEST_FAILED", "The RPC response is too large.")
      }
      if (response.status === 429 || response.status >= 500) {
        throw new NetworkRuntimeError(
          "RPC_ENDPOINT_UNAVAILABLE",
          "The RPC endpoint is temporarily unavailable.",
          true
        )
      }
      if (!response.ok) {
        throw new NetworkRuntimeError("RPC_REQUEST_FAILED", "The RPC request was rejected.")
      }
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
        readonly error?: { readonly code?: number; readonly message?: string }
        readonly result?: unknown
      }
      if (payload.error) {
        throw new NetworkRuntimeError(
          "RPC_REQUEST_FAILED",
          `The RPC returned error code ${payload.error.code ?? "unknown"}.`
        )
      }
      if (!("result" in payload)) {
        throw new NetworkRuntimeError("RPC_REQUEST_FAILED", "The RPC response has no result.")
      }
      return payload.result
    } catch (error) {
      if (error instanceof NetworkRuntimeError) throw error
      if (controller.signal.aborted) {
        throw new NetworkRuntimeError("RPC_REQUEST_TIMEOUT", "The RPC request timed out.", true)
      }
      throw new NetworkRuntimeError(
        "RPC_ENDPOINT_UNAVAILABLE",
        "The RPC endpoint could not be reached.",
        true
      )
    } finally {
      clearTimeout(timeout)
      release()
    }
  }
}

export const createWebSocketRpcTransport = (
  options: WebSocketRpcTransportOptions = {}
): RpcTransport => {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url))
  const maxConcurrentRequests = options.maxConcurrentRequests ?? 16
  const maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024
  if (!Number.isSafeInteger(maxConcurrentRequests) || maxConcurrentRequests < 1) {
    throw new TypeError("maxConcurrentRequests must be a positive integer.")
  }
  let activeRequests = 0
  const waiters: Array<() => void> = []
  let requestId = 0

  const acquire = async () => {
    if (activeRequests >= maxConcurrentRequests) {
      await new Promise<void>((resolve) => waiters.push(resolve))
    }
    activeRequests += 1
  }

  const release = () => {
    activeRequests -= 1
    waiters.shift()?.()
  }

  return async (request) => {
    await acquire()
    try {
      if (request.headers && Object.keys(request.headers).length > 0) {
        throw new NetworkRuntimeError(
          "RPC_DESTINATION_BLOCKED",
          "WebSocket RPC headers are not supported by this transport."
        )
      }
      return await new Promise<unknown>((resolve, reject) => {
        const socket = createSocket(request.url)
        const id = ++requestId
        let settled = false
        const timeout = setTimeout(() => {
          finish(() =>
            reject(
              new NetworkRuntimeError("RPC_REQUEST_TIMEOUT", "The RPC request timed out.", true)
            )
          )
        }, request.timeoutMs)
        const finish = (callback: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          socket.close()
          callback()
        }
        socket.addEventListener("open", () => {
          socket.send(
            JSON.stringify({
              id,
              jsonrpc: "2.0",
              method: request.method,
              ...(request.params === undefined ? {} : { params: request.params }),
            })
          )
        })
        socket.addEventListener("message", (event) => {
          const text = typeof event.data === "string" ? event.data : ""
          if (new TextEncoder().encode(text).byteLength > maxResponseBytes) {
            finish(() =>
              reject(
                new NetworkRuntimeError("RPC_REQUEST_FAILED", "The RPC response is too large.")
              )
            )
            return
          }
          try {
            const payload = JSON.parse(text) as {
              readonly error?: { readonly code?: number }
              readonly id?: number
              readonly result?: unknown
            }
            if (payload.id !== id) return
            if (payload.error) {
              finish(() =>
                reject(
                  new NetworkRuntimeError(
                    "RPC_REQUEST_FAILED",
                    `The RPC returned error code ${payload.error?.code ?? "unknown"}.`
                  )
                )
              )
            } else if ("result" in payload) {
              finish(() => resolve(payload.result))
            } else {
              finish(() =>
                reject(
                  new NetworkRuntimeError("RPC_REQUEST_FAILED", "The RPC response has no result.")
                )
              )
            }
          } catch {
            finish(() =>
              reject(new NetworkRuntimeError("RPC_REQUEST_FAILED", "The RPC response is invalid."))
            )
          }
        })
        socket.addEventListener("error", () => {
          finish(() =>
            reject(
              new NetworkRuntimeError(
                "RPC_ENDPOINT_UNAVAILABLE",
                "The RPC endpoint could not be reached.",
                true
              )
            )
          )
        })
        socket.addEventListener("close", () => {
          finish(() =>
            reject(
              new NetworkRuntimeError(
                "RPC_ENDPOINT_UNAVAILABLE",
                "The RPC endpoint closed before replying.",
                true
              )
            )
          )
        })
      })
    } finally {
      release()
    }
  }
}
