import { SerializeAddon } from "@xterm/addon-serialize"
import xterm, { type Terminal as HeadlessTerminal } from "@xterm/headless"
import * as pty from "node-pty"

import type {
  TerminalWorkerMessage,
  TerminalWorkerRequest,
  WorkerCreateTerminal,
} from "./worker-protocol.js"

const { Terminal } = xterm
const OUTPUT_COALESCE_MS = 5

type WorkerRecord = {
  appliedRevision: number
  headless: HeadlessTerminal
  process: pty.IPty
  revision: number
  serializer: SerializeAddon
  writeQueue: Promise<void>
  output: Uint8Array[]
  outputBytes: number
  outputRevision: number
  outputTimer?: NodeJS.Timeout
}

const terminals = new Map<string, WorkerRecord>()
let createQueue = Promise.resolve()
let closing = false

const send = (message: TerminalWorkerMessage): void => {
  if (closing || !process.connected || !process.send) return
  try {
    process.send(message)
  } catch {
    closing = true
  }
}

const respond = (requestId: string, result?: unknown): void =>
  send({ ok: true, requestId, result, type: "response" })
const reject = (requestId: string, error: unknown): void =>
  send({
    error: error instanceof Error ? error.message : String(error),
    ok: false,
    requestId,
    type: "response",
  })

const flushOutput = (terminalId: string, record: WorkerRecord): void => {
  if (record.outputTimer) clearTimeout(record.outputTimer)
  record.outputTimer = undefined
  if (record.outputBytes === 0) return
  const data = new Uint8Array(record.outputBytes)
  let offset = 0
  for (const chunk of record.output) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  record.output = []
  record.outputBytes = 0
  send({ data, revision: record.outputRevision, terminalId, type: "output" })
}

const queueOutput = (
  terminalId: string,
  record: WorkerRecord,
  data: string,
  revision: number
): void => {
  const bytes = new TextEncoder().encode(data)
  record.output.push(bytes)
  record.outputBytes += bytes.byteLength
  record.outputRevision = revision
  if (!record.outputTimer) {
    record.outputTimer = setTimeout(() => flushOutput(terminalId, record), OUTPUT_COALESCE_MS)
  }
}

const createTerminal = async (input: WorkerCreateTerminal): Promise<void> => {
  if (terminals.has(input.terminalId)) throw new Error("Terminal already exists")
  const headless = new Terminal({
    allowProposedApi: true,
    cols: input.cols,
    rows: input.rows,
    scrollback: 1000,
  })
  const serializer = new SerializeAddon()
  headless.loadAddon(serializer)
  const child = pty.spawn(input.command, input.args, {
    cols: input.cols,
    cwd: input.cwd,
    env: input.env,
    name: "xterm-256color",
    rows: input.rows,
  })
  const record: WorkerRecord = {
    appliedRevision: 0,
    headless,
    output: [],
    outputBytes: 0,
    outputRevision: 0,
    process: child,
    revision: 0,
    serializer,
    writeQueue: Promise.resolve(),
  }
  terminals.set(input.terminalId, record)
  headless.onData((data) => child.write(data))
  headless.onTitleChange((title) =>
    send({ terminalId: input.terminalId, title: title || null, type: "title" })
  )
  child.onData((data) => {
    const revision = ++record.revision
    record.writeQueue = record.writeQueue.then(
      () =>
        new Promise<void>((resolve) => {
          headless.write(data, () => {
            record.appliedRevision = revision
            queueOutput(input.terminalId, record, data, revision)
            resolve()
          })
        })
    )
  })
  child.onExit(({ exitCode, signal }) => {
    void record.writeQueue.finally(() => {
      flushOutput(input.terminalId, record)
      terminals.delete(input.terminalId)
      headless.dispose()
      send({
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: typeof signal === "number" && Number.isInteger(signal) ? signal : null,
        terminalId: input.terminalId,
        type: "exit",
      })
    })
  })
}

const capture = (record: WorkerRecord, start?: number, end?: number): string => {
  const buffer = record.headless.buffer.active
  const total = buffer.length
  const normalize = (value: number | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    return Math.min(total, Math.max(0, value < 0 ? total + value : value))
  }
  const from = normalize(start, 0)
  const to = normalize(end, total)
  const lines: string[] = []
  for (let index = Math.min(from, to); index < Math.max(from, to); index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "")
  }
  return lines.join("\n")
}

const handle = async (message: TerminalWorkerRequest): Promise<void> => {
  try {
    if (message.type === "create") {
      await createTerminal(message.input)
      respond(message.requestId)
      return
    }
    if (message.type === "killAll") {
      for (const record of terminals.values()) record.process.kill()
      respond(message.requestId)
      return
    }
    const record = terminals.get(message.terminalId)
    if (!record) throw new Error("Terminal is closed")
    if (message.type === "input") record.process.write(message.data)
    else if (message.type === "resize") {
      record.process.resize(message.cols, message.rows)
      record.headless.resize(message.cols, message.rows)
    } else if (message.type === "snapshot") {
      const snapshot = record.writeQueue.then(() => {
        flushOutput(message.terminalId, record)
        return {
          data: record.serializer.serialize({
            scrollback: message.mode === "visible" ? 200 : 1000,
          }),
          revision: record.appliedRevision,
        }
      })
      record.writeQueue = snapshot.then(() => undefined)
      respond(message.requestId, await snapshot)
      return
    } else if (message.type === "capture") {
      const captured = record.writeQueue.then(() => capture(record, message.start, message.end))
      record.writeQueue = captured.then(() => undefined)
      respond(message.requestId, await captured)
      return
    } else if (message.type === "kill") record.process.kill()
    respond(message.requestId)
  } catch (error) {
    reject(message.requestId, error)
  }
}

process.on("message", (message: TerminalWorkerRequest) => {
  if (message.type === "create") {
    const next = createQueue.then(() => handle(message))
    createQueue = next.catch(() => undefined)
    return
  }
  void handle(message)
})

process.once("disconnect", () => {
  closing = true
  for (const record of terminals.values()) record.process.kill()
  terminals.clear()
  setTimeout(() => process.exit(0), 100)
})
