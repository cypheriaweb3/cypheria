// Node-based kernel for node_repl.
// Communicates over JSON lines on stdin/stdout.
// Requires Node started with --experimental-vm-modules.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import vm from "node:vm"
import type { Binding } from "./kernel/ast.ts"
import { buildModuleSource } from "./kernel/cell-source.ts"
import { createModuleLoader, type ModuleContext } from "./kernel/module-loader.ts"
import { createRuntimeContext } from "./kernel/runtime-context.ts"
import {
  createWorkerRuntime,
  drainExecBackgroundTasks,
  type ExecState,
  type HostMessage,
  type HostResponse,
  makeRejectedThenable,
  type OutputEvent,
  trackExecBackgroundOperation,
} from "./worker-runtime.ts"

const { SourceTextModule, SyntheticModule } = vm

interface CellImportMeta extends ImportMeta {
  __codexInternalMarkCommittedBindings?: (...names: string[]) => void
  __codexInternalMarkPreludeCompleted?: () => void
  __codexInternalMarkBannerExecuted?: () => void
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return error.message ? String(error.message) : String(error)
  }
  return String(error)
}

function parseKernelBootstrapArgs(argv: string[]): { sessionId: string; workingDir: string } {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      "session-id": { type: "string" },
      "working-dir": { type: "string" },
    },
  })

  const sessionId = values["session-id"]
  const workingDir = values["working-dir"]

  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new Error("missing --session-id")
  }
  if (typeof workingDir !== "string" || workingDir.trim().length === 0) {
    throw new Error("missing --working-dir")
  }

  return { sessionId, workingDir }
}

function bootstrapOrExit(): { sessionId: string; workingDir: string } {
  let bootstrap: { sessionId: string; workingDir: string }
  try {
    bootstrap = parseKernelBootstrapArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`node_repl invalid kernel bootstrap args: ${errorMessage(err)}`)
    process.exit(1)
  }
  try {
    process.chdir(bootstrap.workingDir)
  } catch (err) {
    console.error(
      `node_repl failed to switch to working directory "${bootstrap.workingDir}": ${errorMessage(err)}`
    )
    process.exit(1)
  }
  return bootstrap
}

function freezeEnvSnapshot(sourceEnv: Record<string, unknown>): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(sourceEnv).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    )
  )
}

function pickEnv(sourceEnv: NodeJS.ProcessEnv, allowlist: string | undefined) {
  const allowedNames = new Set(
    (allowlist ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
  return Object.fromEntries([...allowedNames].map((name) => [name, sourceEnv[name]]))
}

function renderOutputEvents(outputEvents: OutputEvent[]): {
  output: string
  named_outputs: string[]
} {
  let output = ""
  let lastDefaultKind: OutputEvent["kind"] | undefined
  const named = new Map<string, string>()
  for (const event of outputEvents) {
    if (event.item_id !== undefined) {
      named.set(event.item_id, (named.get(event.item_id) ?? "") + event.text)
      continue
    }
    output += event.text
    if (event.kind === "line") {
      output += "\n"
    }
    lastDefaultKind = event.kind
  }
  if (lastDefaultKind === "line" && output.endsWith("\n")) {
    output = output.slice(0, -1)
  }
  return { output, named_outputs: [...named.values()] }
}

function tryReadBindingValue(module: vm.Module | null, bindingName: string): boolean {
  if (!module) {
    return false
  }
  try {
    void (module.namespace as Record<string, unknown>)[bindingName]
    return true
  } catch {
    return false
  }
}

function canReadCommittedBinding(module: vm.Module | null, binding: Binding): boolean {
  if (!module || binding.kind === "var" || binding.kind === "function") {
    return false
  }
  return tryReadBindingValue(module, binding.name)
}

// Failed cells keep prior bindings plus the current-cell bindings whose
// initialization definitely ran before the throw. That means:
// - lexical bindings (`const` / `let` / `class`) can fall back to namespace
//   readability, which preserves names whose initialization already completed
//   even when a later step in the same declarator throws
// - `var` / `function` bindings only persist when an explicit declaration-site
//   or write-site marker fired, so unreached hoisted bindings do not become
//   ghost bindings in later cells
function collectCommittedBindings(
  module: vm.Module | null,
  priorBindings: Binding[],
  currentBindings: Binding[],
  committedCurrentBindingNames: Set<string>
): { bindings: Binding[]; committedCurrentBindingCount: number } {
  const mergedBindings = new Map<string, Binding["kind"]>()
  let committedCurrentBindingCount = 0

  for (const binding of priorBindings) {
    mergedBindings.set(binding.name, binding.kind)
  }

  for (const binding of currentBindings) {
    if (
      committedCurrentBindingNames.has(binding.name) ||
      canReadCommittedBinding(module, binding)
    ) {
      mergedBindings.set(binding.name, binding.kind)
      committedCurrentBindingCount += 1
    }
  }

  return {
    bindings: Array.from(mergedBindings, ([name, kind]) => ({ name, kind })),
    committedCurrentBindingCount,
  }
}

function namespaceOf(module: vm.Module): Record<string, unknown> {
  return module.namespace as Record<string, unknown>
}

const kernelBootstrap = bootstrapOrExit()

const runtimeContext = createRuntimeContext({
  codeGeneration: {
    strings: false,
    wasm: false,
  },
})
const moduleContext: ModuleContext = Object.freeze({
  context: runtimeContext,
  kind: "module",
})

let previousModule: vm.Module | null = null
let previousBindings: Binding[] = []
let cellCounter = 0
let internalBindingCounter = 0
const jsBanner = process.env.NODE_REPL_JS_BANNER
delete process.env.NODE_REPL_JS_BANNER
let jsBannerExecuted = false
const internalBindingSalt = kernelBootstrap.sessionId.replace(/[^A-Za-z0-9_$]/g, "_") || "session"
let fatalExitScheduled = false
let hostServiceRequestCounter = 0
const trustedRpcEnabled = process.env.NODE_REPL_TRUSTED_RPC_ENABLED === "1"

const cwd = process.cwd()
// Use Node's standard temp-dir resolution. Sandboxed launches redirect it by
// setting TMPDIR/TMP/TEMP to the writable workspace root before Node starts.
const tmpDir = os.tmpdir()
const runtime = createWorkerRuntime({
  audioEnabled: process.env.NODE_REPL_ENABLE_AUDIO === "1",
  cwd,
  env: freezeEnvSnapshot(pickEnv(process.env, process.env.NODE_REPL_UNTRUSTED_ENV_ALLOWLIST)),
  homeDir: process.env.HOME ?? null,
  tmpDir,
})
const { execContext, nodeRepl, pendingRequests, send } = runtime
const loader = createModuleLoader({
  context: runtimeContext,
  cwd,
  moduleDirs: (process.env.NODE_REPL_NODE_MODULE_DIRS ?? "").split(path.delimiter),
})

function nextInternalBindingName(): string {
  // We intentionally do not scan user-declared names here. Internal helpers use
  // a per-thread salt plus a counter instead. A user could still collide by
  // deliberately spelling the exact generated name, but the thread-id salt
  // keeps accidental collisions negligible while avoiding more AST bookkeeping.
  return `__codex_internal_commit_${internalBindingSalt}_${internalBindingCounter++}`
}

function sendFatalExecResultSync(kind: string, error: unknown): void {
  if (!execContext.activeId) {
    return
  }
  const payload = {
    type: "exec_result",
    id: execContext.activeId,
    ok: false,
    output: "",
    error: `node_repl kernel ${kind}: ${errorMessage(error)}; kernel reset. Catch or handle async errors (including Promise rejections and EventEmitter 'error' events) to avoid kernel termination.`,
  }
  try {
    fs.writeSync(process.stdout.fd, `${JSON.stringify(payload)}\n`)
  } catch {
    // Best effort only; the host will still surface stdout EOF diagnostics.
  }
}

function scheduleFatalExit(kind: string, error: unknown): void {
  if (fatalExitScheduled) {
    process.exitCode = 1
    return
  }
  fatalExitScheduled = true
  sendFatalExecResultSync(kind, error)

  try {
    fs.writeSync(process.stderr.fd, `node_repl kernel ${kind}: ${errorMessage(error)}\n`)
  } catch {
    // ignore
  }

  // The host will observe stdout EOF, reset kernel state, and restart on demand.
  setImmediate(() => {
    process.exit(1)
  })
}

function withCapturedConsole<T>(ctx: vm.Context, fn: () => Promise<T>): Promise<T> {
  const original = ctx.console ?? console
  ctx.console = runtime.createConsole(original)
  return fn().finally(() => {
    ctx.console = original
  })
}

/** Sends `request` to a host service, which the supervisor forwards to the host services pipe. */
function requestHostService(
  execState: ExecState,
  service: string,
  request: unknown
): Promise<unknown> {
  const id = `${execState.id}-rpc-${hostServiceRequestCounter++}`
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, (response: HostResponse) => {
      if (!response.ok) {
        reject(new Error(response.error || "Host service request failed"))
        return
      }
      resolve(response.value)
    })
    try {
      send({ type: "trusted_service_request", id, exec_id: execState.id, service, request })
    } catch (error) {
      pendingRequests.delete(id)
      reject(error)
    }
  })
}

if (trustedRpcEnabled) {
  nodeRepl.rpc = function rpc(service, request) {
    let execState: ExecState
    try {
      execState = execContext.getCurrent()
      if (typeof service !== "string" || service.length === 0) {
        throw new Error("nodeRepl.rpc expected a nonempty service identifier")
      }
      if (request === undefined || typeof request === "function" || typeof request === "symbol") {
        throw new Error("nodeRepl.rpc expected a JSON-serializable request")
      }
    } catch (error) {
      return makeRejectedThenable(error)
    }

    const operation = requestHostService(execState, service, request)
    return trackExecBackgroundOperation(execState, operation)
  }
}
Object.freeze(nodeRepl)

for (const [name, value] of [
  ["nodeRepl", nodeRepl],
  ["tmpDir", tmpDir],
] as const) {
  Object.defineProperty(runtimeContext, name, {
    value,
    writable: false,
    configurable: false,
    enumerable: false,
  })
}

async function handleExec(message: HostMessage & { id: string }): Promise<void> {
  loader.clearLocalFileModuleCaches()
  execContext.activate(message.id)
  const execState = runtime.createExecState(message)

  let module: vm.SourceTextModule | null = null
  let currentBindings: Binding[] = []
  let nextBindings: Binding[] = []
  let priorBindings: Binding[] = previousBindings
  let moduleLinked = false
  let preludeCompleted = false
  const committedCurrentBindingNames = new Set<string>()
  const markCommittedBindings = (...names: string[]) => {
    for (const name of names) {
      committedCurrentBindingNames.add(name)
    }
  }
  const markPreludeCompleted = () => {
    preludeCompleted = true
  }

  try {
    const code = typeof message.code === "string" ? message.code : ""
    const builtSource = buildModuleSource(code, {
      priorBindings: previousModule ? previousBindings : [],
      nextInternalBindingName,
    })
    const banner =
      !jsBannerExecuted && jsBanner?.trim()
        ? `await (async () => {\n${jsBanner}\n})();\nimport.meta.__codexInternalMarkBannerExecuted();\n`
        : ""
    const source = `${banner}${builtSource.source}`
    currentBindings = builtSource.currentBindings
    nextBindings = builtSource.nextBindings
    priorBindings = builtSource.priorBindings
    // AsyncLocalStorage keeps the current tool-call state available to helper
    // methods and async callbacks without exposing mutable host bookkeeping.
    await execContext.run(execState, async () => {
      await withCapturedConsole(runtimeContext, async () => {
        const cellIdentifier = path.join(cwd, `.node_repl_cell_${cellCounter++}.mjs`)
        const cellModule = new SourceTextModule(source, {
          context: runtimeContext,
          identifier: cellIdentifier,
          initializeImportMeta(meta: CellImportMeta, mod) {
            loader.setImportMeta(meta, mod, moduleContext, true)
            meta.__codexInternalMarkCommittedBindings = markCommittedBindings
            meta.__codexInternalMarkPreludeCompleted = markPreludeCompleted
            if (banner) {
              meta.__codexInternalMarkBannerExecuted = () => {
                jsBannerExecuted = true
                delete meta.__codexInternalMarkBannerExecuted
              }
            }
          },
          importModuleDynamically(specifier, referrer) {
            return loader.importResolved(
              loader.resolveSpecifier(specifier, referrer?.identifier, moduleContext),
              moduleContext
            ) as Promise<vm.Module>
          },
        })
        module = cellModule

        await cellModule.link(async (specifier) => {
          const priorModule = previousModule
          if (specifier === "@prev" && priorModule) {
            const exportNames = previousBindings.map((b) => b.name)
            // Build a synthetic module snapshot of the prior cell's exports.
            // This is the bridge that carries values from cell N to cell N+1.
            return new SyntheticModule(
              exportNames,
              function initSynthetic(this: vm.SyntheticModule) {
                for (const binding of previousBindings) {
                  this.setExport(binding.name, namespaceOf(priorModule)[binding.name])
                }
              },
              { context: runtimeContext }
            )
          }
          throw new Error(
            `Top-level static import "${specifier}" is not supported in node_repl. Use await import("${specifier}") instead.`
          )
        })
        moduleLinked = true

        for (const name of builtSource.warnedConstNames) {
          runtimeContext.console.warn(
            `Warning: ${name} was declared with const; use let for reassignable variables.`
          )
        }
        await cellModule.evaluate()
        await drainExecBackgroundTasks(execState)
      })
    })

    previousModule = module
    previousBindings = nextBindings
    send({
      type: "exec_result",
      id: message.id,
      ok: true,
      ...renderOutputEvents(execState.outputEvents),
      error: null,
    })
  } catch (error) {
    // An error skips the happy-path drain. Let tracked submitted-code work
    // settle before ending its timeout phase.
    try {
      await drainExecBackgroundTasks(execState)
    } catch {}
    const failedModule: vm.SourceTextModule | null = moduleLinked ? module : null
    const { bindings: committedBindings, committedCurrentBindingCount } = collectCommittedBindings(
      failedModule,
      priorBindings,
      currentBindings,
      committedCurrentBindingNames
    )
    // Preserve the last successfully linked module across link-time failures.
    // A module whose link step failed cannot safely back @prev because reading
    // its namespace throws before evaluation ever begins. Likewise, if a
    // linked module failed before its prelude recreated carried bindings, keep
    // the old module so @prev still points at the last cell whose prelude and
    // body actually established the carried values. Once the prelude has run,
    // promote the failed module even if it only updated existing bindings.
    if (
      failedModule &&
      (committedCurrentBindingCount > 0 || (preludeCompleted && priorBindings.length > 0))
    ) {
      const shadowedUncommittedBindings = new Set(
        currentBindings
          .filter(
            (binding) =>
              priorBindings.some((prior) => prior.name === binding.name) &&
              !committedCurrentBindingNames.has(binding.name) &&
              !canReadCommittedBinding(failedModule, binding)
          )
          .map((binding) => binding.name)
      )

      const priorModule = previousModule
      if (shadowedUncommittedBindings.size > 0 && priorModule) {
        const recoveredModule = new SyntheticModule(
          committedBindings.map((binding) => binding.name),
          function initSynthetic(this: vm.SyntheticModule) {
            for (const binding of committedBindings) {
              this.setExport(
                binding.name,
                shadowedUncommittedBindings.has(binding.name)
                  ? namespaceOf(priorModule)[binding.name]
                  : namespaceOf(failedModule)[binding.name]
              )
            }
          },
          { context: runtimeContext }
        )
        await recoveredModule.link(() => {
          throw new Error("Recovered REPL bindings must not import modules")
        })
        await recoveredModule.evaluate()
        previousModule = recoveredModule
      } else {
        previousModule = failedModule
      }
      previousBindings = committedBindings
    }
    send({
      type: "exec_result",
      id: message.id,
      ok: false,
      ...renderOutputEvents(execState.outputEvents),
      // User errors come from the VM realm, so `instanceof Error` is unreliable.
      error: errorMessage(error),
    })
  } finally {
    execContext.clear(message.id)
  }
}

let queue = Promise.resolve()

process.on("uncaughtException", (error) => {
  scheduleFatalExit("uncaught exception", error)
})

process.on("unhandledRejection", (reason) => {
  scheduleFatalExit("unhandled rejection", reason)
})

runtime.listen((message) => {
  if (message.type === "exec") {
    queue = queue.then(() => handleExec(message as HostMessage & { id: string }))
    return
  }
  if (message.type === "add_node_module_dir") {
    loader.addModuleSearchBase(message.path as string)
    return
  }
  runtime.settle(message)
})
