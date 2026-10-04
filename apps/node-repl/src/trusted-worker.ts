// Trusted service host. JSONL on stdout is reserved for the host supervisor.
import { Console } from "node:console"
import { realpathSync } from "node:fs"
import { createRequire, registerHooks } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createPrivilegedWorkerRuntime } from "./trusted/privileged-runtime.ts"
import { createResponseMetaTracer } from "./trusted/tracing.ts"
import {
  createWorkerRuntime,
  drainExecBackgroundTasks,
  type HostMessage,
} from "./worker-runtime.ts"

type RpcHandler = (request: unknown) => unknown

process.chdir(process.argv[2] as string)

const stderrConsole = new Console(process.stderr)

const configuredServices: Record<string, unknown> = JSON.parse(
  process.env.NODE_REPL_TRUSTED_SERVICES as string
)
const handlers = new Map<string, Promise<RpcHandler>>()
const moduleSearchPaths = (process.env.NODE_REPL_NODE_MODULE_DIRS ?? "")
  .split(path.delimiter)
  .filter(Boolean)
const trustedCodeRoots = (process.env.NODE_REPL_TRUSTED_CODE_PATHS ?? "")
  .split(path.delimiter)
  .filter((entry) => path.isAbsolute(entry))
  .flatMap((root) => {
    try {
      // Native realpath accepts Windows verbatim paths and expands short aliases.
      return [realpathSync.native(root)]
    } catch {
      return []
    }
  })

function isWithinRoot(root: string, filename: string): boolean {
  const relative = path.relative(root, filename)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function isTrustedCodePath(filename: string): boolean {
  return trustedCodeRoots.some((root) => isWithinRoot(root, filename))
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    if (resolved.url.startsWith("file:")) {
      const filename = realpathSync.native(fileURLToPath(resolved.url))
      if (!isTrustedCodePath(filename)) {
        throw new Error(
          `Trusted RPC dependency must resolve within a configured trusted code path: ${specifier}`
        )
      }
      return { ...resolved, url: pathToFileURL(filename).href }
    }
    return resolved
  },
})

const env = Object.freeze(
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  )
)
const runtime = createWorkerRuntime({
  audioEnabled: process.env.NODE_REPL_ENABLE_AUDIO === "1",
  cwd: process.cwd(),
  env,
  homeDir: process.env.HOME ?? null,
  tmpDir: os.tmpdir(),
})
const { execContext, send } = runtime
const traceEnabled = process.env.NODE_REPL_TRACE_META === "1"
const responseMetaTracer = createResponseMetaTracer({
  enabled: traceEnabled,
  getCurrentExecState: execContext.getCurrent,
})
globalThis.console = runtime.createConsole(stderrConsole)
Object.freeze(runtime.nodeRepl)
const privilegedRuntime = createPrivilegedWorkerRuntime({
  env,
  runtime,
  telemetryBridge: traceEnabled ? responseMetaTracer.bridge : null,
})
Object.defineProperty(globalThis, "nodeRepl", {
  configurable: false,
  enumerable: false,
  value: privilegedRuntime.nodeRepl,
  writable: false,
})
Object.defineProperty(globalThis, "tmpDir", {
  configurable: false,
  enumerable: false,
  value: os.tmpdir(),
  writable: false,
})

function resolveTrustedService(configured: string): string {
  if (configured.startsWith("file:")) {
    return configured
  }
  if (path.isAbsolute(configured)) {
    return pathToFileURL(configured).href
  }

  for (const configuredRoot of moduleSearchPaths) {
    try {
      const root = realpathSync.native(configuredRoot)
      const resolved = realpathSync.native(
        createRequire(path.join(root, "node-repl-trusted.js")).resolve(configured)
      )
      if (isWithinRoot(root, resolved)) {
        return pathToFileURL(resolved).href
      }
    } catch {
      // Another explicitly configured trusted root may contain the package.
    }
  }

  throw new Error(
    `Trusted RPC package must resolve within a configured trusted module directory: ${configured}`
  )
}

async function loadHandler(service: string): Promise<RpcHandler> {
  let handler = handlers.get(service)
  if (handler === undefined) {
    const configured = configuredServices[service]
    if (typeof configured !== "string") {
      throw new Error(`Trusted RPC service is not configured: ${service}`)
    }
    handler = import(resolveTrustedService(configured)).then((module) => {
      if (typeof module.handleRpc !== "function") {
        throw new Error(`Trusted RPC service ${service} does not export handleRpc`)
      }
      return module.handleRpc as RpcHandler
    })
    handlers.set(service, handler)
  }
  return await handler
}

async function runInExecContext(message: HostMessage, operation: () => unknown): Promise<void> {
  const execState = runtime.createExecState(message)
  execContext.activate(execState.id)
  const response = {
    type: "trusted_service_response",
    id: message.id,
    output: execState.outputEvents,
    content_items: execState.contentItems,
  }
  const sendResponse = (result: Record<string, unknown>) => {
    if (message.type === "run_hooks") {
      const trace = responseMetaTracer.buildTrace(execState)
      if (trace !== null) {
        send({ type: "response_meta_trace", id: execState.id, trace })
      }
    }
    send({ ...response, ...result })
  }
  try {
    const value = await execContext.run(execState, async () => {
      const result = await operation()
      if (message.type !== "run_hooks") {
        await drainExecBackgroundTasks(execState)
      }
      return result ?? null
    })
    sendResponse({ ok: true, value })
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleServiceRequest(message: HostMessage): Promise<void> {
  await runInExecContext(message, async () => {
    const handler = await loadHandler(message.service as string)
    return await handler(message.request)
  })
}

function handleNodeReplMessage(message: HostMessage): void {
  if (message.type === "turn_ended") {
    const execState = runtime.createExecState(message)
    execContext.activate(execState.id)
    void execContext
      .run(execState, () => privilegedRuntime.turnEndedHandlers.run(Object.freeze(message.event)))
      .finally(() => {
        execContext.clear(execState.id)
        send({ type: "turn_ended_result", id: message.id })
      })
    return
  }
  if (message.type === "run_hooks") {
    void runInExecContext(message, () => privilegedRuntime.afterSubmittedCodeHooks.run()).finally(
      () => {
        execContext.clear(message.exec_id as string | undefined)
      }
    )
    return
  }
  if (!runtime.settle(message)) {
    privilegedRuntime.nativePipeBridge.handleMessage(message)
  }
}

runtime.listen((message) => {
  if (message.type === "service") {
    void handleServiceRequest(message)
    return
  }
  handleNodeReplMessage(message)
})
