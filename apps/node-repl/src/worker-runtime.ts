import { AsyncLocalStorage } from "node:async_hooks"
import { Buffer } from "node:buffer"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { inspect } from "node:util"
import { isArrayBuffer } from "./realm-checks.ts"

/** A JSONL message exchanged with the host supervisor. */
export type HostMessage = Record<string, unknown> & { type?: string; id?: string }

/** A host response routed back to the request that created it. */
export type HostResponse = HostMessage & { ok?: boolean; error?: string }

export type ResponseResolver = (response: HostResponse) => void

export interface OutputEvent {
  kind: "line" | "write"
  text: string
  item_id?: string
}

interface BackgroundResult {
  ok: boolean
  error: unknown
  observation: { observed: boolean }
}

export interface ExecState {
  id: string
  outputEvents: OutputEvent[]
  pendingBackgroundTasks: Set<Promise<BackgroundResult>>
}

/** A thenable that only tracks whether the caller observed its outcome. */
export interface TrackedThenable<T> {
  then<R1 = T, R2 = never>(
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2>
  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<T | R>
  finally(onFinally?: (() => void) | null): Promise<T>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function formatLog(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 4, colors: false })))
    .join(" ")
}

export function makeRejectedThenable<T = never>(error: unknown): TrackedThenable<T> {
  // A lazy thenable avoids an unhandled rejection when the caller ignores it.
  return {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable
    then(onFulfilled, onRejected) {
      return Promise.reject(error).then(onFulfilled, onRejected)
    },
    catch(onRejected) {
      return Promise.reject(error).catch(onRejected)
    },
    finally(onFinally) {
      return Promise.reject(error).finally(onFinally)
    },
  }
}

export function trackExecBackgroundOperation<T>(
  execState: ExecState,
  operation: Promise<T>
): TrackedThenable<T> {
  const observation = { observed: false }
  const trackedOperation = operation.then(
    () => ({ ok: true, error: null, observation }),
    (error: unknown) => ({ ok: false, error, observation })
  )
  execState.pendingBackgroundTasks.add(trackedOperation)
  return {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable
    then(onFulfilled, onRejected) {
      observation.observed = true
      return operation.then(onFulfilled, onRejected)
    },
    catch(onRejected) {
      observation.observed = true
      return operation.catch(onRejected)
    },
    finally(onFinally) {
      observation.observed = true
      return operation.finally(onFinally)
    },
  }
}

export async function drainExecBackgroundTasks(execState: ExecState): Promise<void> {
  while (execState.pendingBackgroundTasks.size > 0) {
    const backgroundTasks = [...execState.pendingBackgroundTasks]
    execState.pendingBackgroundTasks.clear()
    const backgroundResults = await Promise.all(backgroundTasks)
    const firstUnhandledBackgroundError = backgroundResults.find(
      (result) => !result.ok && !result.observation.observed
    )
    if (firstUnhandledBackgroundError) {
      throw firstUnhandledBackgroundError.error
    }
  }
}

function toByteArray(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value
  }
  if (isArrayBuffer(value)) {
    return new Uint8Array(value)
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

function encodeByteImage(bytes: Uint8Array, mimeType: unknown): { image_url: string } {
  if (bytes.byteLength === 0) {
    throw new Error("nodeRepl.emitImage expected non-empty bytes")
  }
  if (typeof mimeType !== "string" || !mimeType) {
    throw new Error("nodeRepl.emitImage expected a non-empty mimeType")
  }
  return {
    image_url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
  }
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return (
    bytes.byteLength >= offset + expected.length &&
    expected.every((byte, index) => bytes[offset + index] === byte)
  )
}

function sniffImageMimeType(bytes: Uint8Array): string {
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png"
  }
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) {
    return "image/jpeg"
  }
  if (
    hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp"
  }
  throw new Error(
    "nodeRepl.emitImage could not infer image MIME type from bytes; expected PNG, JPEG, or WebP data"
  )
}

function normalizeEmitImageValue(value: unknown): { image_url: string } {
  if (typeof value === "string") {
    if (!value) {
      throw new Error("nodeRepl.emitImage expected a non-empty image_url")
    }
    if (/^file:/i.test(value)) {
      const bytes = fs.readFileSync(fileURLToPath(value))
      return encodeByteImage(bytes, sniffImageMimeType(bytes))
    }
    if (!/^data:/i.test(value)) {
      throw new Error("nodeRepl.emitImage only accepts data or file URLs")
    }
    return { image_url: value }
  }
  const inferredBytes = toByteArray(value)
  if (inferredBytes) {
    return encodeByteImage(inferredBytes, sniffImageMimeType(inferredBytes))
  }
  if (isPlainObject(value) && "bytes" in value) {
    if (Object.keys(value).some((key) => key !== "bytes" && key !== "mimeType")) {
      throw new Error("nodeRepl.emitImage received an unsupported value")
    }
    const bytes = toByteArray(value.bytes)
    if (!bytes) {
      throw new Error(
        "nodeRepl.emitImage expected bytes to be Buffer, Uint8Array, ArrayBuffer, or ArrayBufferView"
      )
    }
    return encodeByteImage(bytes, value.mimeType)
  }
  throw new Error("nodeRepl.emitImage received an unsupported value")
}

export interface ExecContext {
  readonly activeId: string | null
  activate(id: string): void
  clear(id: string | undefined): void
  getAsync(): ExecState
  getCurrent(): ExecState
  getOptional(): ExecState | null
  run<R>(state: ExecState, operation: () => R): R
}

function createExecContext(): ExecContext {
  const storage = new AsyncLocalStorage<ExecState>()
  let activeId: string | null = null

  function getOptional(): ExecState | null {
    const state = storage.getStore()
    return state && typeof state.id === "string" && state.id ? state : null
  }

  function getAsync(): ExecState {
    const state = getOptional()
    if (state === null) {
      throw new Error("node_repl exec context not found")
    }
    return state
  }

  function getCurrent(): ExecState {
    const state = getAsync()
    // AsyncLocalStorage retains the originating store for late callbacks, but
    // results may only be attached to the currently active tool call.
    if (state.id !== activeId) {
      throw new Error("node_repl exec context not found")
    }
    return state
  }

  return {
    get activeId() {
      return activeId
    },
    activate(id) {
      activeId = id
    },
    clear(id) {
      if (activeId === id) {
        activeId = null
      }
    },
    getAsync,
    getCurrent,
    getOptional,
    run(state, operation) {
      return storage.run(state, operation)
    },
  }
}

export type Send = (message: HostMessage) => void

/** The `nodeRepl` global exposed to submitted code. */
export interface NodeReplBridge {
  cwd: string
  env: Readonly<Record<string, string>>
  homeDir: string | null
  tmpDir: string
  write(value: unknown, itemId?: unknown): void
  emitImage(imageLike: unknown): TrackedThenable<void>
  emitAudio?: (audioDataUrl: unknown) => TrackedThenable<void>
  rpc?: (service: unknown, request: unknown) => TrackedThenable<unknown>
}

/** Sends a request to the host and resolves when its response is settled. */
function requestHost(
  pendingRequests: Map<string, ResponseResolver>,
  send: Send,
  message: HostMessage & { id: string },
  failureMessage: string
): Promise<HostResponse> {
  send(message)
  return new Promise((resolve, reject) => {
    pendingRequests.set(message.id, (response) => {
      if (!response.ok) {
        reject(new Error(response.error || failureMessage))
        return
      }
      resolve(response)
    })
  })
}

interface WorkerRuntimeOptions {
  audioEnabled: boolean
  cwd: string
  env: Readonly<Record<string, string>>
  homeDir: string | null
  tmpDir: string
}

function createNodeReplBridge({
  audioEnabled,
  cwd,
  env,
  execContext,
  homeDir,
  pendingRequests,
  send,
  tmpDir,
}: WorkerRuntimeOptions & {
  execContext: ExecContext
  pendingRequests: Map<string, ResponseResolver>
  send: Send
}): NodeReplBridge {
  let emitImageCounter = 0
  let emitAudioCounter = 0
  const nodeRepl: NodeReplBridge = {
    cwd,
    env,
    homeDir,
    tmpDir,
    write(value, itemId) {
      const execState = execContext.getCurrent()
      if (itemId !== undefined && (typeof itemId !== "string" || itemId.length === 0)) {
        throw new TypeError("nodeRepl.write expected a nonempty string content item ID")
      }
      execState.outputEvents.push({
        kind: "write",
        text: formatLog([value]),
        ...(itemId === undefined ? {} : { item_id: itemId }),
      })
    },
    emitImage(imageLike) {
      let execState: ExecState
      try {
        execState = execContext.getCurrent()
      } catch (error) {
        return makeRejectedThenable(error)
      }
      const operation = (async () => {
        const normalized = normalizeEmitImageValue(await imageLike)
        const id = `${execState.id}-emit-image-${emitImageCounter++}`
        await requestHost(
          pendingRequests,
          send,
          { type: "emit_image", id, exec_id: execState.id, image_url: normalized.image_url },
          "emitImage failed"
        )
      })()
      return trackExecBackgroundOperation(execState, operation)
    },
  }
  if (audioEnabled) {
    nodeRepl.emitAudio = function emitAudio(audioDataUrl) {
      let execState: ExecState
      try {
        execState = execContext.getCurrent()
      } catch (error) {
        return makeRejectedThenable(error)
      }
      const operation = (async () => {
        const audioUrl = await audioDataUrl
        if (typeof audioUrl !== "string" || !audioUrl) {
          throw new Error("nodeRepl.emitAudio expected a non-empty audio_url")
        }
        if (!/^data:/i.test(audioUrl)) {
          throw new Error("nodeRepl.emitAudio only accepts data URLs")
        }
        const id = `${execState.id}-emit-audio-${emitAudioCounter++}`
        await requestHost(
          pendingRequests,
          send,
          { type: "emit_audio", id, exec_id: execState.id, audio_url: audioUrl },
          "emitAudio failed"
        )
      })()
      return trackExecBackgroundOperation(execState, operation)
    }
  }
  return nodeRepl
}

type ConsoleLike = Pick<Console, "log" | "info" | "warn" | "error" | "debug">

export interface WorkerRuntime {
  createConsole<C extends ConsoleLike>(original: C): C
  createExecState(message: HostMessage): ExecState
  execContext: ExecContext
  listen(handleMessage: (message: HostMessage) => void): void
  nodeRepl: NodeReplBridge
  pendingRequests: Map<string, ResponseResolver>
  send: Send
  settle(message: HostMessage): boolean
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const execContext = createExecContext()
  const pendingRequests = new Map<string, ResponseResolver>()

  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    // The host can close its response pipe before stdin during reset or exit.
    if (error.code === "EPIPE") {
      process.exit(0)
    }
    throw error
  })

  function send(message: HostMessage): void {
    process.stdout.write(`${JSON.stringify(message)}\n`)
  }

  function createExecState(message: HostMessage): ExecState {
    return {
      id: (message.exec_id ?? message.id) as string,
      outputEvents: [],
      pendingBackgroundTasks: new Set(),
    }
  }

  function createConsole<C extends ConsoleLike>(original: C): C {
    const captured = { ...original }
    for (const name of ["log", "info", "warn", "error", "debug"] as const) {
      captured[name] = (...args: unknown[]) => {
        const execState = execContext.getOptional()
        if (execState) {
          execState.outputEvents.push({ kind: "line", text: formatLog(args) })
        } else {
          original[name](...args)
        }
      }
    }
    return captured
  }

  function settle(message: HostMessage): boolean {
    const resolver = typeof message.id === "string" ? pendingRequests.get(message.id) : undefined
    if (!resolver || typeof message.id !== "string") {
      return false
    }
    pendingRequests.delete(message.id)
    resolver(message)
    return true
  }

  function listen(handleMessage: (message: HostMessage) => void): void {
    let pendingInputSegments: Buffer[] = []

    function handleInputFrame(input: Buffer): void {
      let frame = input
      if (frame.length > 0 && frame[frame.length - 1] === 0x0d) {
        frame = frame.subarray(0, frame.length - 1)
      }
      const line = frame.toString("utf8")
      if (!line.trim()) {
        return
      }
      let message: HostMessage
      try {
        message = JSON.parse(line)
      } catch {
        // Malformed JSONL frames cannot be dispatched.
        return
      }
      handleMessage(message)
    }

    process.stdin.on("data", (chunk: Buffer | string) => {
      const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      let segmentStart = 0
      let frameEnd = input.indexOf(0x0a)
      while (frameEnd !== -1) {
        pendingInputSegments.push(input.subarray(segmentStart, frameEnd))
        // Keep raw stdin chunks queued until a full JSONL frame is ready so we
        // only assemble the frame bytes once.
        const frame =
          pendingInputSegments.length === 1
            ? (pendingInputSegments[0] as Buffer)
            : Buffer.concat(pendingInputSegments)
        pendingInputSegments = []
        handleInputFrame(frame)
        segmentStart = frameEnd + 1
        frameEnd = input.indexOf(0x0a, segmentStart)
      }
      if (segmentStart < input.length) {
        pendingInputSegments.push(input.subarray(segmentStart))
      }
    })

    process.stdin.on("end", () => {
      // The host owns worker lifetime. Once stdin closes, it can no longer
      // service worker requests, and user-created handles may keep Node alive.
      process.exit(0)
    })
  }

  return {
    createConsole,
    createExecState,
    execContext,
    listen,
    nodeRepl: createNodeReplBridge({ ...options, execContext, pendingRequests, send }),
    pendingRequests,
    send,
    settle,
  }
}
