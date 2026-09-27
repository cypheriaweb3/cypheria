import { type ChildProcess, fork } from "node:child_process"
import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"

import type { ProjectThreadPersistenceService } from "@cypheria/db"
import {
  type CypheriaBinaryFrame,
  decodeTerminalBinaryFrame,
  encodeTerminalOutputFrame,
  encodeTerminalRestoreFrame,
  TERMINAL_MAX_RESTORE_DATA_BYTES,
  TERMINAL_MAX_STREAM_DATA_BYTES,
  type TerminalClientMessage,
  type TerminalInfo,
  type TerminalRestoreMode,
  type TerminalServerMessage,
} from "@cypheria/protocol"

import type { SessionTransport } from "../session/client-session.js"
import type {
  TerminalWorkerEvent,
  TerminalWorkerMessage,
  TerminalWorkerRequest,
  TerminalWorkerResponse,
  WorkerCreateTerminal,
  WorkerSnapshot,
} from "./worker-protocol.js"

type SendMessage = (message: TerminalServerMessage) => void
type SendBinary = (frame: CypheriaBinaryFrame) => void
type TerminalScope =
  | { kind: "thread"; threadId: string }
  | { kind: "auth"; ownerSessionId: string; flowId: string }
type TerminalRecord = {
  cols: number
  createdAt: number
  cwd: string
  name: string
  rows: number
  scope: TerminalScope
  terminalId: string
  title: string | null
  onExit?: (exitCode: number | null) => void
}
type DirectorySubscription = {
  send: SendMessage
  sessionId: string
  source: SessionTransport
  subscriptionId: string
  threadId: string
}
type StreamSubscription = {
  buffered: Array<{ data: Uint8Array; revision: number }>
  disposed: boolean
  outputBytesSinceSnapshot: number
  restoring: boolean
  sendBinary: SendBinary
  sendMessage: SendMessage
  sessionId: string
  slot: number
  source: SessionTransport
  subscriptionId: string
  terminalId: string
  restoreMode: TerminalRestoreMode
}
type PendingRequest = {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timer: NodeJS.Timeout
}
type WorkerRequestInput = TerminalWorkerRequest extends infer Request
  ? Request extends TerminalWorkerRequest
    ? Omit<Request, "requestId">
    : never
  : never
type AuthTerminalInput = {
  args: string[]
  command: string
  cwd: string
  env: Record<string, string>
  flowId: string
  title: string
}

const MAX_TERMINALS_PER_THREAD = 32
const MAX_TERMINALS = 256
const SNAPSHOT_AFTER_OUTPUT_BYTES = 256 * 1024
const CLIENT_BACKPRESSURE_BYTES = 4 * 1024 * 1024
const WORKER_REQUEST_TIMEOUT_MS = 10_000

const terminalEnvironment = (base: Record<string, string>): Record<string, string> => ({
  ...base,
  COLORTERM: "truecolor",
  TERM: "xterm-256color",
  TERM_PROGRAM: "cypheria",
})

const processEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )

const workerUrl = (): URL =>
  import.meta.url.endsWith(".ts")
    ? new URL("./terminal-worker.ts", import.meta.url)
    : new URL("./terminal-worker.mjs", import.meta.url)

const workerExecArgv = (): string[] => (import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [])

const failureCode = (error: unknown): string =>
  error instanceof TerminalManagerError ? error.code : "TERMINAL_ERROR"
const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class TerminalManagerError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

export class TerminalManager {
  readonly #persistence: ProjectThreadPersistenceService
  readonly #terminals = new Map<string, TerminalRecord>()
  readonly #directorySubscriptions = new Map<string, DirectorySubscription>()
  readonly #streams = new Map<string, StreamSubscription>()
  readonly #streamsBySource = new Map<SessionTransport, Map<number, StreamSubscription>>()
  readonly #pending = new Map<string, PendingRequest>()
  readonly #closeReasons = new Map<string, "closed" | "worker">()
  readonly #resizeOwner = new Map<string, SessionTransport>()
  #worker: ChildProcess | undefined
  #stopping = false

  constructor(persistence: ProjectThreadPersistenceService) {
    this.#persistence = persistence
  }

  async handle(
    message: TerminalClientMessage,
    context: {
      sessionId: string
      source: SessionTransport
      send: SendMessage
      sendBinary: SendBinary
    }
  ): Promise<boolean> {
    const respond = (value: unknown): void => {
      context.send({
        payload: { ok: true, value },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as TerminalServerMessage)
    }
    try {
      switch (message.type) {
        case "terminal.list.request":
          await this.#requiredThread(message.payload.threadId)
          respond({ terminals: this.#list(message.payload.threadId) })
          break
        case "terminal.create.request":
          respond(await this.#createThreadTerminal(message.payload))
          break
        case "terminal.rename.request":
          respond(this.#rename(message.payload.terminalId, message.payload.name))
          break
        case "terminal.close.request":
          await this.#closeThreadTerminal(message.payload.terminalId)
          respond({ succeeded: true })
          break
        case "terminal.capture.request":
          respond({
            text: await this.#capture(
              message.payload.terminalId,
              message.payload.start,
              message.payload.end
            ),
          })
          break
        case "terminal.directory.subscribe.request":
          await this.#requiredThread(message.payload.threadId)
          respond(this.#subscribeDirectory(message.payload.threadId, context))
          break
        case "terminal.directory.unsubscribe.request":
          this.#unsubscribeDirectory(message.payload.subscriptionId, context.source)
          respond({ succeeded: true })
          break
        case "terminal.stream.subscribe.request": {
          const stream = this.#subscribeStream(
            message.payload.terminalId,
            message.payload.restore,
            context
          )
          respond({ slot: stream.slot, subscriptionId: stream.subscriptionId })
          queueMicrotask(() => void this.#restore(stream))
          break
        }
        case "terminal.stream.unsubscribe.request":
          this.#unsubscribeStream(message.payload.subscriptionId, context.source)
          respond({ succeeded: true })
          break
      }
    } catch (error) {
      context.send({
        payload: {
          error: { code: failureCode(error), message: failureMessage(error) },
          ok: false,
        },
        requestId: message.requestId,
        type: message.type.replace(/\.request$/u, ".response"),
      } as TerminalServerMessage)
    }
    return true
  }

  async handleBinaryFrame(
    frame: CypheriaBinaryFrame,
    sessionId: string,
    source: SessionTransport
  ): Promise<boolean> {
    const decoded = decodeTerminalBinaryFrame(frame)
    if (!decoded) return false
    if (decoded.type !== "input" && decoded.type !== "resize") {
      throw new TerminalManagerError(
        "TERMINAL_FRAME_FORBIDDEN",
        "Client terminal frame is forbidden"
      )
    }
    const stream = this.#streamsBySource.get(source)?.get(decoded.slot)
    if (!stream || stream.sessionId !== sessionId || stream.disposed) {
      throw new TerminalManagerError("TERMINAL_STREAM_CLOSED", "Terminal stream is closed")
    }
    const terminal = this.#requiredTerminal(stream.terminalId)
    this.#assertScope(terminal, sessionId)
    if (decoded.type === "input") {
      await this.#request({
        data: new TextDecoder().decode(decoded.data),
        terminalId: terminal.terminalId,
        type: "input",
      })
      return true
    }
    const owner = this.#resizeOwner.get(terminal.terminalId)
    if (decoded.claim || !owner) this.#resizeOwner.set(terminal.terminalId, source)
    if (this.#resizeOwner.get(terminal.terminalId) !== source) return true
    terminal.cols = decoded.cols
    terminal.rows = decoded.rows
    await this.#request({
      cols: decoded.cols,
      rows: decoded.rows,
      terminalId: terminal.terminalId,
      type: "resize",
    })
    if (terminal.scope.kind === "thread") this.#publishDirectory(terminal.scope.threadId)
    return true
  }

  async createAuthTerminal(
    input: AuthTerminalInput,
    ownerSessionId: string,
    onExit: (exitCode: number | null) => void
  ): Promise<{ cwd: string; terminalId: string; title: string }> {
    this.#assertCapacity()
    const terminalId = randomUUID()
    const terminal: TerminalRecord = {
      cols: 100,
      createdAt: Date.now(),
      cwd: input.cwd,
      name: input.title,
      onExit,
      rows: 28,
      scope: { flowId: input.flowId, kind: "auth", ownerSessionId },
      terminalId,
      title: input.title,
    }
    await this.#spawn(terminal, {
      args: input.args,
      cols: terminal.cols,
      command: input.command,
      cwd: input.cwd,
      env: terminalEnvironment(input.env),
      rows: terminal.rows,
      terminalId,
    })
    return { cwd: input.cwd, terminalId, title: input.title }
  }

  async closeAuthTerminal(terminalId: string, ownerSessionId: string): Promise<void> {
    const terminal = this.#terminals.get(terminalId)
    if (!terminal || terminal.scope.kind !== "auth") return
    if (terminal.scope.ownerSessionId !== ownerSessionId) {
      throw new TerminalManagerError("TERMINAL_FORBIDDEN", "Authentication terminal is private")
    }
    await this.#kill(terminalId, "closed")
  }

  closeThread(threadId: string): void {
    for (const terminal of this.#terminals.values()) {
      if (terminal.scope.kind === "thread" && terminal.scope.threadId === threadId) {
        void this.#kill(terminal.terminalId, "closed")
      }
    }
  }

  transportClosed(sessionId: string, source: SessionTransport): void {
    for (const [subscriptionId, subscription] of this.#directorySubscriptions) {
      if (subscription.source === source) this.#directorySubscriptions.delete(subscriptionId)
    }
    for (const stream of [...this.#streams.values()]) {
      if (stream.source === source) this.#disposeStream(stream)
    }
    for (const [terminalId, owner] of this.#resizeOwner) {
      if (owner === source) this.#resizeOwner.delete(terminalId)
    }
    void sessionId
  }

  closeSession(sessionId: string): void {
    for (const [subscriptionId, subscription] of this.#directorySubscriptions) {
      if (subscription.sessionId === sessionId) this.#directorySubscriptions.delete(subscriptionId)
    }
    for (const stream of [...this.#streams.values()]) {
      if (stream.sessionId === sessionId) this.#disposeStream(stream)
    }
    for (const terminal of this.#terminals.values()) {
      if (terminal.scope.kind === "auth" && terminal.scope.ownerSessionId === sessionId) {
        void this.#kill(terminal.terminalId, "closed")
      }
    }
  }

  stop(): void {
    this.#stopping = true
    if (this.#worker?.connected) {
      this.#worker.disconnect()
    }
    this.#worker = undefined
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Terminal worker stopped"))
    }
    this.#pending.clear()
    this.#terminals.clear()
    this.#directorySubscriptions.clear()
    this.#streams.clear()
    this.#streamsBySource.clear()
    this.#resizeOwner.clear()
  }

  async #createThreadTerminal(input: {
    name?: string
    size: { cols: number; rows: number }
    threadId: string
  }): Promise<TerminalInfo> {
    const thread = await this.#requiredThread(input.threadId)
    const count = this.#list(input.threadId).length
    if (count >= MAX_TERMINALS_PER_THREAD) {
      throw new TerminalManagerError("TERMINAL_LIMIT", "Thread terminal limit reached")
    }
    this.#assertCapacity()
    const cwd = thread.cwd
    if (!cwd)
      throw new TerminalManagerError("TERMINAL_CWD_UNAVAILABLE", "Thread has no working directory")
    const info = await stat(cwd).catch(() => undefined)
    if (!info?.isDirectory()) {
      throw new TerminalManagerError(
        "TERMINAL_CWD_UNAVAILABLE",
        "The terminal working directory is unavailable"
      )
    }
    const shell =
      process.platform === "win32"
        ? (process.env.ComSpec ?? process.env.COMSPEC ?? "powershell.exe")
        : (process.env.SHELL ?? "/bin/sh")
    const terminal: TerminalRecord = {
      cols: input.size.cols,
      createdAt: Date.now(),
      cwd,
      name: input.name?.trim() || `Terminal ${count + 1}`,
      rows: input.size.rows,
      scope: { kind: "thread", threadId: input.threadId },
      terminalId: randomUUID(),
      title: basename(shell),
    }
    await this.#spawn(terminal, {
      args: process.platform === "win32" ? [] : ["-l"],
      cols: terminal.cols,
      command: shell,
      cwd,
      env: terminalEnvironment(processEnvironment()),
      rows: terminal.rows,
      terminalId: terminal.terminalId,
    })
    this.#publishDirectory(input.threadId)
    return this.#toInfo(terminal)
  }

  async #spawn(terminal: TerminalRecord, input: WorkerCreateTerminal): Promise<void> {
    this.#terminals.set(terminal.terminalId, terminal)
    try {
      await this.#request({ input, type: "create" })
    } catch (error) {
      this.#terminals.delete(terminal.terminalId)
      throw error
    }
  }

  #rename(terminalId: string, name: string): TerminalInfo {
    const terminal = this.#requiredThreadTerminal(terminalId)
    terminal.name = name.trim()
    this.#publishDirectory(terminal.scope.threadId)
    return this.#toInfo(terminal)
  }

  async #closeThreadTerminal(terminalId: string): Promise<void> {
    this.#requiredThreadTerminal(terminalId)
    await this.#kill(terminalId, "closed")
  }

  async #capture(terminalId: string, start?: number, end?: number): Promise<string> {
    this.#requiredThreadTerminal(terminalId)
    return (await this.#request({ end, start, terminalId, type: "capture" })) as string
  }

  async #kill(terminalId: string, reason: "closed" | "worker"): Promise<void> {
    if (!this.#terminals.has(terminalId)) return
    this.#closeReasons.set(terminalId, reason)
    await this.#request({ terminalId, type: "kill" }).catch(() => undefined)
  }

  #subscribeDirectory(
    threadId: string,
    context: { sessionId: string; source: SessionTransport; send: SendMessage }
  ): { subscriptionId: string; terminals: TerminalInfo[] } {
    const subscriptionId = randomUUID()
    this.#directorySubscriptions.set(subscriptionId, {
      ...context,
      subscriptionId,
      threadId,
    })
    return { subscriptionId, terminals: this.#list(threadId) }
  }

  #unsubscribeDirectory(subscriptionId: string, source: SessionTransport): void {
    const subscription = this.#directorySubscriptions.get(subscriptionId)
    if (subscription?.source === source) this.#directorySubscriptions.delete(subscriptionId)
  }

  #subscribeStream(
    terminalId: string,
    restoreMode: TerminalRestoreMode,
    context: {
      sessionId: string
      source: SessionTransport
      send: SendMessage
      sendBinary: SendBinary
    }
  ): StreamSubscription {
    const terminal = this.#requiredTerminal(terminalId)
    this.#assertScope(terminal, context.sessionId)
    const slots = this.#streamsBySource.get(context.source) ?? new Map()
    let slot = 0
    while (slot <= 255 && slots.has(slot)) slot += 1
    if (slot > 255)
      throw new TerminalManagerError("TERMINAL_STREAM_LIMIT", "No terminal stream slots available")
    const stream: StreamSubscription = {
      buffered: [],
      disposed: false,
      outputBytesSinceSnapshot: 0,
      restoring: true,
      restoreMode,
      sendBinary: context.sendBinary,
      sendMessage: context.send,
      sessionId: context.sessionId,
      slot,
      source: context.source,
      subscriptionId: randomUUID(),
      terminalId,
    }
    slots.set(slot, stream)
    this.#streamsBySource.set(context.source, slots)
    this.#streams.set(stream.subscriptionId, stream)
    return stream
  }

  #unsubscribeStream(subscriptionId: string, source: SessionTransport): void {
    const stream = this.#streams.get(subscriptionId)
    if (stream?.source === source) this.#disposeStream(stream)
  }

  #disposeStream(stream: StreamSubscription): void {
    if (stream.disposed) return
    stream.disposed = true
    stream.buffered = []
    this.#streams.delete(stream.subscriptionId)
    const slots = this.#streamsBySource.get(stream.source)
    slots?.delete(stream.slot)
    if (slots?.size === 0) this.#streamsBySource.delete(stream.source)
    if (this.#resizeOwner.get(stream.terminalId) === stream.source) {
      const sourceStillSubscribed = [...this.#streams.values()].some(
        (candidate) =>
          candidate.terminalId === stream.terminalId &&
          candidate.source === stream.source &&
          !candidate.disposed
      )
      if (!sourceStillSubscribed) this.#resizeOwner.delete(stream.terminalId)
    }
  }

  async #restore(stream: StreamSubscription): Promise<void> {
    if (stream.disposed || !this.#terminals.has(stream.terminalId)) return
    stream.restoring = true
    try {
      const snapshot = (await this.#request({
        mode: stream.restoreMode,
        terminalId: stream.terminalId,
        type: "snapshot",
      })) as WorkerSnapshot
      if (stream.disposed) return
      const bytes = new TextEncoder().encode(snapshot.data)
      if (bytes.byteLength === 0) {
        stream.sendBinary(
          encodeTerminalRestoreFrame(stream.slot, bytes, { end: true, start: true })
        )
      } else {
        for (let offset = 0; offset < bytes.byteLength; offset += TERMINAL_MAX_RESTORE_DATA_BYTES) {
          const end = Math.min(offset + TERMINAL_MAX_RESTORE_DATA_BYTES, bytes.byteLength)
          stream.sendBinary(
            encodeTerminalRestoreFrame(stream.slot, bytes.subarray(offset, end), {
              end: end === bytes.byteLength,
              start: offset === 0,
            })
          )
        }
      }
      const buffered = stream.buffered
      stream.buffered = []
      stream.outputBytesSinceSnapshot = 0
      stream.restoring = false
      for (const item of buffered) {
        if (item.revision > snapshot.revision) this.#sendOutput(stream, item.data)
      }
    } catch {
      stream.restoring = false
      if (!stream.disposed) this.#disposeStream(stream)
    }
  }

  #handleWorkerEvent(event: TerminalWorkerEvent): void {
    const terminal = this.#terminals.get(event.terminalId)
    if (!terminal) return
    if (event.type === "output") {
      for (const stream of this.#streams.values()) {
        if (stream.terminalId !== event.terminalId || stream.disposed) continue
        if (stream.restoring) {
          stream.buffered.push({ data: event.data, revision: event.revision })
          continue
        }
        stream.outputBytesSinceSnapshot += event.data.byteLength
        if (
          stream.outputBytesSinceSnapshot > SNAPSHOT_AFTER_OUTPUT_BYTES &&
          (stream.source.bufferedAmount?.() ?? 0) > CLIENT_BACKPRESSURE_BYTES
        ) {
          stream.buffered.push({ data: event.data, revision: event.revision })
          void this.#restore(stream)
          continue
        }
        this.#sendOutput(stream, event.data)
      }
      return
    }
    if (event.type === "title") {
      terminal.title = event.title
      if (terminal.scope.kind === "thread") this.#publishDirectory(terminal.scope.threadId)
      return
    }
    this.#finishTerminal(terminal, event.exitCode, event.signal)
  }

  #sendOutput(stream: StreamSubscription, data: Uint8Array): void {
    for (let offset = 0; offset < data.byteLength; offset += TERMINAL_MAX_STREAM_DATA_BYTES) {
      stream.sendBinary(
        encodeTerminalOutputFrame(
          stream.slot,
          data.subarray(offset, Math.min(offset + TERMINAL_MAX_STREAM_DATA_BYTES, data.byteLength))
        )
      )
    }
  }

  #finishTerminal(terminal: TerminalRecord, exitCode: number | null, signal: number | null): void {
    this.#terminals.delete(terminal.terminalId)
    this.#resizeOwner.delete(terminal.terminalId)
    const reason = this.#closeReasons.get(terminal.terminalId) ?? "exit"
    this.#closeReasons.delete(terminal.terminalId)
    for (const stream of [...this.#streams.values()]) {
      if (stream.terminalId !== terminal.terminalId) continue
      stream.sendMessage({
        payload: { exitCode, reason, signal, terminalId: terminal.terminalId },
        type: "terminal.exited.notification",
      })
      this.#disposeStream(stream)
    }
    if (terminal.scope.kind === "thread") this.#publishDirectory(terminal.scope.threadId)
    terminal.onExit?.(exitCode)
  }

  #handleWorkerExit(): void {
    this.#worker = undefined
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Terminal worker exited"))
    }
    this.#pending.clear()
    for (const terminal of [...this.#terminals.values()]) {
      this.#closeReasons.set(terminal.terminalId, "worker")
      this.#finishTerminal(terminal, null, null)
    }
  }

  #ensureWorker(): ChildProcess {
    if (this.#worker?.connected) return this.#worker
    if (this.#stopping) throw new Error("Terminal manager is stopped")
    const worker = fork(fileURLToPath(workerUrl()), [], {
      execArgv: workerExecArgv(),
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    })
    worker.on("message", (message: TerminalWorkerMessage) => {
      if (message.type === "response") this.#handleResponse(message)
      else this.#handleWorkerEvent(message)
    })
    worker.once("exit", () => this.#handleWorkerExit())
    this.#worker = worker
    return worker
  }

  #handleResponse(response: TerminalWorkerResponse): void {
    const pending = this.#pending.get(response.requestId)
    if (!pending) return
    this.#pending.delete(response.requestId)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error))
  }

  #request(input: WorkerRequestInput): Promise<unknown> {
    const requestId = randomUUID()
    const worker = this.#ensureWorker()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId)
        reject(new Error("Terminal worker request timed out"))
      }, WORKER_REQUEST_TIMEOUT_MS)
      timer.unref()
      this.#pending.set(requestId, { reject, resolve, timer })
      worker.send({ ...input, requestId } as TerminalWorkerRequest, (error) => {
        if (!error) return
        const pending = this.#pending.get(requestId)
        if (!pending) return
        this.#pending.delete(requestId)
        clearTimeout(pending.timer)
        pending.reject(error)
      })
    })
  }

  async #requiredThread(threadId: string) {
    const thread = await this.#persistence.getThread(threadId)
    if (!thread || thread.deletedAt !== null) {
      throw new TerminalManagerError("THREAD_NOT_FOUND", "Thread was not found")
    }
    if (thread.archivedAt !== null) {
      throw new TerminalManagerError("THREAD_ARCHIVED", "Archived threads cannot use terminals")
    }
    return thread
  }

  #requiredTerminal(terminalId: string): TerminalRecord {
    const terminal = this.#terminals.get(terminalId)
    if (!terminal) throw new TerminalManagerError("TERMINAL_CLOSED", "Terminal is closed")
    return terminal
  }

  #requiredThreadTerminal(terminalId: string): TerminalRecord & {
    scope: { kind: "thread"; threadId: string }
  } {
    const terminal = this.#requiredTerminal(terminalId)
    if (terminal.scope.kind !== "thread") {
      throw new TerminalManagerError("TERMINAL_FORBIDDEN", "Authentication terminal is private")
    }
    return terminal as TerminalRecord & { scope: { kind: "thread"; threadId: string } }
  }

  #assertScope(terminal: TerminalRecord, sessionId: string): void {
    if (terminal.scope.kind === "auth" && terminal.scope.ownerSessionId !== sessionId) {
      throw new TerminalManagerError("TERMINAL_FORBIDDEN", "Authentication terminal is private")
    }
  }

  #assertCapacity(): void {
    if (this.#terminals.size >= MAX_TERMINALS) {
      throw new TerminalManagerError("TERMINAL_LIMIT", "Server terminal limit reached")
    }
  }

  #list(threadId: string): TerminalInfo[] {
    return [...this.#terminals.values()]
      .filter(
        (terminal) => terminal.scope.kind === "thread" && terminal.scope.threadId === threadId
      )
      .map((terminal) => this.#toInfo(terminal))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  #toInfo(terminal: TerminalRecord): TerminalInfo {
    if (terminal.scope.kind !== "thread") throw new Error("Authentication terminals are private")
    return {
      cols: terminal.cols,
      createdAt: terminal.createdAt,
      cwd: terminal.cwd,
      name: terminal.name,
      rows: terminal.rows,
      terminalId: terminal.terminalId,
      threadId: terminal.scope.threadId,
      title: terminal.title,
    }
  }

  #publishDirectory(threadId: string): void {
    const terminals = this.#list(threadId)
    for (const subscription of this.#directorySubscriptions.values()) {
      if (subscription.threadId !== threadId) continue
      subscription.send({
        payload: {
          subscriptionId: subscription.subscriptionId,
          terminals,
          threadId,
        },
        type: "terminal.directory.changed.notification",
      })
    }
  }
}
