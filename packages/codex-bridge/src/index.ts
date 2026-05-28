export type CodexJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly CodexJsonValue[]
  | { readonly [key: string]: CodexJsonValue }

export type CodexRequestId = number | string

export type CodexJsonRpcRequest = {
  readonly id: CodexRequestId
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly params?: CodexJsonValue
}

export type CodexJsonRpcNotification = {
  readonly id?: never
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly params?: CodexJsonValue
}

export type CodexJsonRpcSuccess = {
  readonly id: CodexRequestId
  readonly jsonrpc: "2.0"
  readonly result: CodexJsonValue
}

export type CodexJsonRpcErrorObject = {
  readonly code: number
  readonly data?: CodexJsonValue
  readonly message: string
}

export type CodexJsonRpcError = {
  readonly error: CodexJsonRpcErrorObject
  readonly id: CodexRequestId | null
  readonly jsonrpc: "2.0"
}

export type CodexWireMessage =
  | CodexJsonRpcError
  | CodexJsonRpcNotification
  | CodexJsonRpcRequest
  | CodexJsonRpcSuccess

export type CodexWireMessageKind = "error" | "notification" | "request" | "success"

export type ParsedCodexJsonlLine =
  | { readonly kind: "empty" }
  | {
      readonly kind: "invalid"
      readonly line: string
      readonly reason: string
    }
  | {
      readonly kind: "message"
      readonly line: string
      readonly message: CodexWireMessage
      readonly messageKind: CodexWireMessageKind
    }

export type CodexLifecycleState =
  | "closed"
  | "closing"
  | "errored"
  | "ready"
  | "starting"
  | "stopped"

export type CodexTransportError = {
  readonly cause?: unknown
  readonly code: "CLOSED" | "INVALID_MESSAGE" | "PARSE_ERROR" | "PROCESS_EXIT" | "TRANSPORT_ERROR"
  readonly message: string
}

export type CodexNormalizedEvent =
  | {
      readonly message: CodexWireMessage
      readonly messageKind: CodexWireMessageKind
      readonly rawLine?: string
      readonly timestamp: string
      readonly type: "codex.message"
    }
  | {
      readonly error: CodexTransportError
      readonly rawLine?: string
      readonly timestamp: string
      readonly type: "codex.transport.error"
    }
  | {
      readonly state: CodexLifecycleState
      readonly timestamp: string
      readonly type: "codex.lifecycle"
    }

export type CodexTransport = {
  readonly close: () => Promise<void> | void
  readonly getState: () => CodexLifecycleState
  readonly sendNotification: (method: string, params?: CodexJsonValue) => Promise<void> | void
  readonly sendRequest: (
    method: string,
    params?: CodexJsonValue,
    id?: CodexRequestId
  ) => Promise<CodexRequestId> | CodexRequestId
}

export type CodexJsonlMessageBuffer = {
  readonly append: (chunk: string) => readonly ParsedCodexJsonlLine[]
  readonly flush: () => ParsedCodexJsonlLine | undefined
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isRequestId = (value: unknown): value is CodexRequestId =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value))

const isJsonValue = (value: unknown): value is CodexJsonValue => {
  if (value === null) {
    return true
  }

  if (typeof value === "boolean" || typeof value === "string") {
    return true
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  if (isObject(value)) {
    return Object.values(value).every(isJsonValue)
  }

  return false
}

const isJsonRpcErrorObject = (value: unknown): value is CodexJsonRpcErrorObject =>
  isObject(value) &&
  typeof value.code === "number" &&
  Number.isFinite(value.code) &&
  typeof value.message === "string" &&
  ("data" in value ? isJsonValue(value.data) : true)

export const classifyCodexWireMessage = (value: unknown): CodexWireMessageKind | undefined => {
  if (!isObject(value) || value.jsonrpc !== "2.0") {
    return undefined
  }

  if ("error" in value) {
    return (isRequestId(value.id) || value.id === null) && isJsonRpcErrorObject(value.error)
      ? "error"
      : undefined
  }

  if ("result" in value) {
    return isRequestId(value.id) && isJsonValue(value.result) ? "success" : undefined
  }

  if (typeof value.method === "string" && value.method.length > 0) {
    const hasValidParams = "params" in value ? isJsonValue(value.params) : true
    if (!hasValidParams) {
      return undefined
    }

    return "id" in value ? (isRequestId(value.id) ? "request" : undefined) : "notification"
  }

  return undefined
}

export const parseCodexWireMessage = (value: unknown): CodexWireMessage | undefined => {
  const kind = classifyCodexWireMessage(value)
  return kind ? (value as CodexWireMessage) : undefined
}

export const stringifyCodexWireMessage = (message: CodexWireMessage): string =>
  `${JSON.stringify(message)}\n`

export const parseCodexJsonlLine = (line: string): ParsedCodexJsonlLine => {
  const trimmedLine = line.trim()
  if (!trimmedLine) {
    return { kind: "empty" }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmedLine)
  } catch (error) {
    return {
      kind: "invalid",
      line,
      reason: error instanceof Error ? error.message : "Invalid JSON",
    }
  }

  const messageKind = classifyCodexWireMessage(parsed)
  if (!messageKind) {
    return {
      kind: "invalid",
      line,
      reason: "Line is not a supported JSON-RPC 2.0 message",
    }
  }

  return {
    kind: "message",
    line,
    message: parsed as CodexWireMessage,
    messageKind,
  }
}

export const createCodexJsonlMessageBuffer = (): CodexJsonlMessageBuffer => {
  let buffered = ""

  return {
    append: (chunk) => {
      buffered += chunk
      const lines = buffered.split(/\r?\n/u)
      buffered = lines.pop() ?? ""
      return lines.map(parseCodexJsonlLine)
    },
    flush: () => {
      if (!buffered) {
        return undefined
      }

      const line = buffered
      buffered = ""
      return parseCodexJsonlLine(line)
    },
  }
}

export const createCodexRequestIdGenerator = (prefix = "cypheria"): (() => CodexRequestId) => {
  let nextId = 1
  return () => `${prefix}_${nextId++}`
}

export const createCodexRequest = (
  method: string,
  params: CodexJsonValue | undefined,
  id: CodexRequestId
): CodexJsonRpcRequest => ({
  id,
  jsonrpc: "2.0",
  method,
  ...(params === undefined ? {} : { params }),
})

export const createCodexNotification = (
  method: string,
  params?: CodexJsonValue
): CodexJsonRpcNotification => ({
  jsonrpc: "2.0",
  method,
  ...(params === undefined ? {} : { params }),
})

export const normalizeCodexJsonlLine = (
  parsed: ParsedCodexJsonlLine,
  timestamp = new Date().toISOString()
): CodexNormalizedEvent | undefined => {
  if (parsed.kind === "empty") {
    return undefined
  }

  if (parsed.kind === "invalid") {
    return {
      error: {
        code: "INVALID_MESSAGE",
        message: parsed.reason,
      },
      rawLine: parsed.line,
      timestamp,
      type: "codex.transport.error",
    }
  }

  return {
    message: parsed.message,
    messageKind: parsed.messageKind,
    rawLine: parsed.line,
    timestamp,
    type: "codex.message",
  }
}

export const createCodexLifecycleEvent = (
  state: CodexLifecycleState,
  timestamp = new Date().toISOString()
): CodexNormalizedEvent => ({
  state,
  timestamp,
  type: "codex.lifecycle",
})
