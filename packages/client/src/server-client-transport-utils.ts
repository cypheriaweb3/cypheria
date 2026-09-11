import type {
  WebSocketEventLike,
  WebSocketLike,
  WebSocketListener,
} from "./server-client-transport-types.js"

type EventMode = "dom" | "emitter" | "property"

export const addWebSocketListener = (
  socket: WebSocketLike,
  type: "close" | "error" | "message" | "open",
  listener: WebSocketListener
): (() => void) => {
  let mode: EventMode
  if (typeof socket.addEventListener === "function") {
    mode = "dom"
    socket.addEventListener(type, listener)
  } else if (typeof socket.on === "function") {
    mode = "emitter"
    socket.on(type, listener)
  } else {
    mode = "property"
    const property = `on${type}` as const
    socket[property] = listener
  }

  return () => {
    if (mode === "dom") socket.removeEventListener?.(type, listener)
    else if (mode === "emitter") {
      if (typeof socket.off === "function") socket.off(type, listener)
      else socket.removeListener?.(type, listener)
    } else {
      const property = `on${type}` as const
      if (socket[property] === listener) socket[property] = null
    }
  }
}

export const normalizeMessageEvent = (
  first: unknown,
  second?: unknown
): { readonly data: unknown; readonly isBinary: boolean } => {
  if (typeof first === "object" && first !== null && "data" in first) {
    const event = first as WebSocketEventLike
    return { data: event.data, isBinary: typeof event.data !== "string" }
  }
  return { data: first, isBinary: second === true }
}

const decodeCloseReason = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value)
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    )
  }
  return undefined
}

export const normalizeCloseEvent = (first: unknown, second?: unknown): WebSocketEventLike => {
  if (typeof first === "object" && first !== null && ("code" in first || "reason" in first)) {
    return first as WebSocketEventLike
  }
  const reason = decodeCloseReason(second)
  return {
    ...(typeof first === "number" ? { code: first } : {}),
    ...(reason ? { reason } : {}),
  }
}

export const describeClose = (event: unknown): string => {
  if (typeof event !== "object" || event === null) return "Cypheria server connection closed"
  const close = event as WebSocketEventLike
  if (close.reason) return close.reason
  return close.code === undefined
    ? "Cypheria server connection closed"
    : `Cypheria WebSocket closed with code ${close.code}`
}

export const describeError = (event: unknown): Error => {
  if (event instanceof Error) return event
  if (typeof event === "object" && event !== null && "error" in event) {
    const nested = (event as WebSocketEventLike).error
    if (nested instanceof Error) return nested
    if (nested !== undefined) return new Error(String(nested))
  }
  return new Error("Cypheria WebSocket connection failed")
}
