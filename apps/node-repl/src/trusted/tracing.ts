import { AsyncLocalStorage } from "node:async_hooks"
import { performance } from "node:perf_hooks"

const responseMetaTraceVersion = 1
// Reserve room for nested CDP spans and their enclosing command span. At 128,
// children could fill the buffer before the command span ended.
const maxResponseMetaTraceSpans = 1024
const maxResponseMetaTraceAttrs = 32
const maxResponseMetaTraceAttrKeyLength = 128
const maxResponseMetaTraceNameLength = 128
const maxResponseMetaTraceAttrStringLength = 256

type TraceAttrValue = boolean | number | string
type TraceAttrs = Record<string, TraceAttrValue>
type SpanStatus = "ok" | "error"

interface TraceSpanRecord {
  id: string
  name: string
  start_ms: number
  duration_ms: number
  status: SpanStatus
  attrs: TraceAttrs
  parent_id?: string
}

export interface ResponseMetaTrace {
  version: number
  spans: TraceSpanRecord[]
  dropped_span_count?: number
}

interface TraceState {
  droppedSpanCount: number
  spanCounter: number
  spans: TraceSpanRecord[]
  startedAtMs: number
}

interface SpanEndOptions {
  attrs?: unknown
  status?: unknown
}

export interface TelemetrySpan {
  end(options?: SpanEndOptions): void
}

export interface TelemetryBridge {
  startSpan(name: unknown, attrs?: unknown): TelemetrySpan
  withSpan<T>(
    name: unknown,
    attrs: unknown,
    operation: () => T | Promise<T>,
    options?: { resultAttrs?: (result: T) => unknown }
  ): Promise<T | undefined>
}

export interface ResponseMetaTracer {
  bridge: TelemetryBridge
  buildTrace(execState: { id: string }): ResponseMetaTrace | null
}

function roundTraceMs(value: number): number {
  return Math.round(value * 1000) / 1000
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

function sanitizeTraceAttrValue(value: unknown): TraceAttrValue | undefined {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === "string") {
    return value.length <= maxResponseMetaTraceAttrStringLength
      ? value
      : value.slice(0, maxResponseMetaTraceAttrStringLength)
  }
  return undefined
}

function sanitizeTraceName(value: unknown): string {
  const name = String(value)
  if (name.length === 0) {
    return "unknown"
  }
  return name.length <= maxResponseMetaTraceNameLength
    ? name
    : name.slice(0, maxResponseMetaTraceNameLength)
}

function sanitizeTraceAttrs(value: unknown): TraceAttrs {
  if (!isPlainObject(value)) {
    return {}
  }

  const attrs: TraceAttrs = {}
  let attrCount = 0
  for (const [key, rawValue] of Object.entries(value)) {
    if (key.length === 0 || key.length > maxResponseMetaTraceAttrKeyLength) {
      continue
    }
    const sanitizedValue = sanitizeTraceAttrValue(rawValue)
    if (sanitizedValue === undefined) {
      continue
    }
    attrs[key] = sanitizedValue
    attrCount += 1
    if (attrCount >= maxResponseMetaTraceAttrs) {
      break
    }
  }
  return attrs
}

function makeNoopTelemetrySpan(): TelemetrySpan {
  return Object.freeze({
    end() {},
  })
}

function telemetryStatus(value: unknown): SpanStatus {
  return value === "error" ? "error" : "ok"
}

function telemetryErrorKind(error: unknown): string {
  return error instanceof Error && error.name ? error.name : typeof error
}

function objectAttrs(value: unknown): object {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function resultAttrsFor<T>(
  result: T,
  resultAttrs: ((result: T) => unknown) | null
): object | undefined {
  if (typeof resultAttrs !== "function") {
    return undefined
  }
  try {
    const attrs = resultAttrs(result)
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
      return attrs
    }
  } catch {
    // Telemetry must not affect runtime behavior.
  }
  return undefined
}

export function createResponseMetaTracer({
  enabled,
  getCurrentExecState,
}: {
  enabled: boolean
  getCurrentExecState: () => { id: string }
}): ResponseMetaTracer {
  const spanStorage = new AsyncLocalStorage<{ spanId: string }>()
  const traces = new Map<string, TraceState>()

  function getTraceState(execState: { id: string }): TraceState {
    let state = traces.get(execState.id)
    if (state === undefined) {
      state = {
        droppedSpanCount: 0,
        spanCounter: 0,
        spans: [],
        startedAtMs: performance.now(),
      }
      traces.set(execState.id, state)
    }
    return state
  }

  function buildTrace(execState: { id: string }): ResponseMetaTrace | null {
    const state = traces.get(execState.id)
    traces.delete(execState.id)
    if (!enabled || state === undefined || state.spans.length === 0) {
      return null
    }

    const trace: ResponseMetaTrace = {
      version: responseMetaTraceVersion,
      spans: state.spans.slice().sort((a, b) => a.start_ms - b.start_ms),
    }
    if (state.droppedSpanCount > 0) {
      trace.dropped_span_count = state.droppedSpanCount
    }
    return trace
  }

  function currentParentSpanId(): string | null {
    const activeSpan = spanStorage.getStore()
    return typeof activeSpan?.spanId === "string" ? activeSpan.spanId : null
  }

  function startSpan(name: unknown, attrs: unknown = {}): { span: TelemetrySpan; spanId?: string } {
    if (!enabled) {
      return { span: makeNoopTelemetrySpan() }
    }

    let execState: { id: string }
    try {
      execState = getCurrentExecState()
    } catch {
      return { span: makeNoopTelemetrySpan() }
    }

    const state = getTraceState(execState)
    const spanId = `span-${++state.spanCounter}`
    const parentSpanId = currentParentSpanId()
    const startMs = performance.now()
    let ended = false

    const span: TelemetrySpan = Object.freeze({
      end(options: SpanEndOptions = {}) {
        if (ended) {
          return
        }
        ended = true

        const endMs = performance.now()
        if (state.spans.length >= maxResponseMetaTraceSpans) {
          state.droppedSpanCount += 1
          return
        }

        const record: TraceSpanRecord = {
          id: spanId,
          name: sanitizeTraceName(name),
          start_ms: roundTraceMs(startMs - state.startedAtMs),
          duration_ms: roundTraceMs(endMs - startMs),
          status: telemetryStatus(options.status),
          attrs: sanitizeTraceAttrs({ ...objectAttrs(attrs), ...objectAttrs(options.attrs) }),
        }
        if (parentSpanId != null) {
          record.parent_id = parentSpanId
        }
        state.spans.push(record)
      },
    })

    return { span, spanId }
  }

  const bridge: TelemetryBridge = Object.freeze({
    startSpan(name: unknown, attrs: unknown = {}) {
      return startSpan(name, attrs).span
    },

    async withSpan<T>(
      name: unknown,
      attrs: unknown,
      operation: () => T | Promise<T>,
      options: { resultAttrs?: (result: T) => unknown } = {}
    ): Promise<T | undefined> {
      if (typeof operation !== "function") {
        return undefined
      }

      const resultAttrs =
        options && typeof options.resultAttrs === "function" ? options.resultAttrs : null
      const { span, spanId } = startSpan(name, attrs ?? {})
      const run = async (): Promise<T> => {
        try {
          const result = await operation()
          span.end({
            attrs: resultAttrsFor(result, resultAttrs),
            status: "ok",
          })
          return result
        } catch (error) {
          span.end({
            attrs: { "error.kind": telemetryErrorKind(error) },
            status: "error",
          })
          throw error
        }
      }

      if (!spanId) {
        return await run()
      }
      return await spanStorage.run({ spanId }, run)
    },
  })

  return Object.freeze({
    bridge,
    buildTrace,
  })
}
