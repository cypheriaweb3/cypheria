import { INJECTED_SCRIPT_SOURCE } from "../vendor/playwright-injected.ts"
import { EngineError } from "./errors.ts"
import type { CdpEvent, CdpTransport } from "./transport.ts"

/** Where the injected script lives in each page world; a symbol keeps it off enumerable globals. */
const INJECTED_KEY = "cypheria.cua.injected"
const MAX_LOGS = 1_000

type RemoteObject = {
  readonly type: string
  readonly subtype?: string
  readonly value?: unknown
  readonly objectId?: string
  readonly description?: string
  readonly unserializableValue?: string
}

type CallResult = {
  readonly result: RemoteObject
  readonly exceptionDetails?: {
    readonly text: string
    readonly exception?: RemoteObject
  }
}

export type PendingDialog = {
  readonly type: "alert" | "beforeunload" | "confirm" | "prompt"
  readonly message: string
  readonly defaultValue?: string
}

export type ConsoleLog = {
  readonly level: "debug" | "info" | "log" | "warn" | "error"
  readonly message: string
  readonly timestamp: string
  readonly url?: string
}

export type FileChooserEvent = {
  readonly backendNodeId: number
  readonly frameId: string
  readonly mode: "selectSingle" | "selectMultiple"
}

const LEVELS: Record<string, ConsoleLog["level"]> = {
  debug: "debug",
  error: "error",
  info: "info",
  log: "log",
  warning: "warn",
}

const describeRemote = (value: RemoteObject | undefined): string => {
  if (!value) return ""
  if (value.value !== undefined) {
    return typeof value.value === "string" ? value.value : JSON.stringify(value.value)
  }
  return value.description ?? value.unserializableValue ?? value.type
}

/**
 * The engine's view of one page target over CDP. It tracks the main world of every frame,
 * installs Playwright's injected script in a world on first use, and records what happens in
 * the page that a model may ask about later: dialogs, console output, navigations, file choosers.
 */
export class PageSession {
  readonly transport: CdpTransport
  readonly #platform: string
  /** The default execution context of each frame, by frame ID. */
  readonly #contexts = new Map<string, number>()
  /** Contexts where the injected script is known to be installed. */
  readonly #installed = new Set<number>()
  /** The sequence each frame's injected script uses for its accessibility refs. */
  readonly #frameSeq = new Map<string, number>()
  readonly #logs: ConsoleLog[] = []
  readonly #lifecycle = new Set<string>()
  readonly #waiters = new Set<() => void>()
  readonly #fileChoosers: FileChooserEvent[] = []
  readonly #unsubscribe: () => void
  #mainFrameId: string | undefined
  #dialog: PendingDialog | undefined
  #navigations = 0
  #ready: Promise<void> | undefined
  #closed = false

  constructor(transport: CdpTransport, platform: string) {
    this.transport = transport
    this.#platform = platform
    this.#unsubscribe = transport.onEvent((event) => this.#onEvent(event))
    transport.onClose?.(() => {
      this.#closed = true
      this.#wake()
    })
  }

  get platform(): string {
    return this.#platform
  }

  get closed(): boolean {
    return this.#closed
  }

  get dialog(): PendingDialog | undefined {
    return this.#dialog
  }

  get navigations(): number {
    return this.#navigations
  }

  dispose(): void {
    this.#unsubscribe()
    this.#closed = true
    this.#wake()
  }

  /** Enables the domains the engine needs; idempotent and shared by concurrent callers. */
  ready(): Promise<void> {
    this.#ready ??= (async () => {
      await this.transport.send("Page.enable")
      // A background tab produces no frames, so Chrome holds input acknowledgements until they
      // time out. Emulating focus lets it handle input without bringing the tab to the front.
      await this.transport
        .send("Emulation.setFocusEmulationEnabled", { enabled: true })
        .catch(() => {})
      await this.transport.send("Page.setLifecycleEventsEnabled", { enabled: true })
      await this.transport.send("Runtime.enable")
      const tree = await this.transport.send<{ frameTree: { frame: { id: string } } }>(
        "Page.getFrameTree"
      )
      this.#mainFrameId = tree.frameTree.frame.id
      const state = await this.evaluateRaw("document.readyState").catch(() => "loading")
      if (state === "interactive" || state === "complete") this.#lifecycle.add("DOMContentLoaded")
      if (state === "complete") this.#lifecycle.add("load")
    })().catch((error: unknown) => {
      this.#ready = undefined
      throw error
    })
    return this.#ready
  }

  async mainFrameId(): Promise<string> {
    await this.ready()
    if (!this.#mainFrameId) throw new EngineError("page_gone", "The tab has no page.")
    return this.#mainFrameId
  }

  logs(): readonly ConsoleLog[] {
    return this.#logs
  }

  /** The next file chooser the page opens, once interception is on. */
  takeFileChooser(): FileChooserEvent | undefined {
    return this.#fileChoosers.shift()
  }

  /** Waits until `predicate` holds, re-checking after every page event, up to `timeoutMs`. */
  async waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (this.#closed) throw new EngineError("page_gone", "The tab closed.")
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new EngineError("timeout", `Timed out after ${timeoutMs} ms waiting for ${what}.`, {
          retryable: true,
        })
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.min(remaining, 250))
        function done() {
          clearTimeout(timer)
          resolve()
        }
        this.#waiters.add(done)
      })
    }
  }

  /** Resolves once the page shows a JavaScript dialog, which blocks input until it closes. */
  dialogOpened(): Promise<void> {
    if (this.#dialog || this.#closed) return Promise.resolve()
    return new Promise((resolve) => {
      const check = () => {
        if (this.#dialog || this.#closed) resolve()
        else this.#waiters.add(check)
      }
      this.#waiters.add(check)
    })
  }

  hasLifecycle(name: string): boolean {
    return this.#lifecycle.has(name)
  }

  /** Throws when a dialog blocks the page, since scripts would hang until it closes. */
  assertNoDialog(): void {
    if (this.#dialog) {
      throw new EngineError(
        "dialog_open",
        `The page is showing a ${this.#dialog.type} dialog ("${this.#dialog.message}"). Handle it with tab.getJsDialog() first.`
      )
    }
  }

  /** Evaluates an expression in the main frame's page world and returns its JSON value. */
  async evaluateRaw(expression: string): Promise<unknown> {
    const response = await this.transport.send<CallResult>("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
      userGesture: true,
    })
    if (response.exceptionDetails) throw this.#scriptError(response.exceptionDetails)
    return response.result.value
  }

  async #context(frameId: string | undefined): Promise<number> {
    await this.ready()
    const frame = frameId ?? this.#mainFrameId
    if (!frame) throw new EngineError("page_gone", "The tab has no page.")
    const known = this.#contexts.get(frame)
    if (known !== undefined) return known
    await this.waitFor(() => this.#contexts.has(frame), 5_000, "the frame's script context")
    return this.#contexts.get(frame) as number
  }

  async #install(contextId: number, frameId: string): Promise<void> {
    if (this.#installed.has(contextId)) return
    let seq = this.#frameSeq.get(frameId)
    if (seq === undefined) {
      seq = frameId === this.#mainFrameId ? 0 : this.#frameSeq.size + 1
      this.#frameSeq.set(frameId, seq)
    }
    const options = {
      browserName: "chromium",
      customEngines: [],
      frameSeq: seq,
      isUnderTest: false,
      isUtilityWorld: false,
      sdkLanguage: "javascript",
      shouldPrependErrorPrefix: false,
      stableRafCount: 1,
      testIdAttributeName: "data-testid",
    }
    const expression = `(() => {
      const key = Symbol.for(${JSON.stringify(INJECTED_KEY)});
      if (globalThis[key]) return true;
      const module = {};
      ${INJECTED_SCRIPT_SOURCE}
      const injected = new (module.exports.InjectedScript())(globalThis, ${JSON.stringify(options)});
      Object.defineProperty(globalThis, key, { value: injected, configurable: true });
      return true;
    })()`
    const response = await this.transport.send<CallResult>("Runtime.evaluate", {
      contextId,
      expression,
      returnByValue: true,
    })
    if (response.exceptionDetails) throw this.#scriptError(response.exceptionDetails)
    this.#installed.add(contextId)
  }

  /**
   * Calls `fn(injected, ...args)` in a frame's page world with Playwright's injected script.
   * `fn` is function source text. Returns the JSON value, or a remote object ID with `handle`.
   */
  async call(
    fn: string,
    args: readonly unknown[],
    options: { frameId?: string; handle?: boolean; objectArgs?: readonly string[] } = {}
  ): Promise<unknown> {
    this.assertNoDialog()
    const frameId = options.frameId ?? (await this.mainFrameId())
    for (let attempt = 0; ; attempt++) {
      const contextId = await this.#context(frameId)
      try {
        await this.#install(contextId, frameId)
        const response = await this.transport.send<CallResult>("Runtime.callFunctionOn", {
          arguments: [
            ...(options.objectArgs ?? []).map((objectId) => ({ objectId })),
            ...args.map((value) => ({ value })),
          ],
          awaitPromise: true,
          executionContextId: contextId,
          functionDeclaration: `function(...args) {
            const injected = globalThis[Symbol.for(${JSON.stringify(INJECTED_KEY)})];
            return (${fn})(injected, ...args);
          }`,
          returnByValue: !options.handle,
          userGesture: true,
        })
        if (response.exceptionDetails) throw this.#scriptError(response.exceptionDetails)
        if (options.handle) return response.result.objectId
        return response.result.value
      } catch (error) {
        // A navigation destroys the context between lookup and call; try the new one once.
        if (attempt === 0 && isContextLost(error)) {
          this.#contexts.delete(frameId)
          this.#installed.delete(contextId)
          continue
        }
        throw error
      }
    }
  }

  /** Calls `fn(element, ...args)` on a remote element by its object ID. */
  async callOn(objectId: string, fn: string, args: readonly unknown[] = []): Promise<unknown> {
    return this.callDeclaration(`function(...args) { return (${fn})(this, ...args); }`, args, {
      objectId,
    })
  }

  /**
   * Calls a complete function declaration with `this` bound to `objectId`, or in a frame's page
   * world. Model-written functions run through here, since `eval` is blocked on strict pages.
   */
  async callDeclaration(
    declaration: string,
    args: readonly unknown[],
    options: { objectId?: string; frameId?: string; handle?: boolean } = {}
  ): Promise<unknown> {
    this.assertNoDialog()
    const target = options.objectId
      ? { objectId: options.objectId }
      : { executionContextId: await this.#context(options.frameId) }
    const response = await this.transport.send<CallResult>("Runtime.callFunctionOn", {
      ...target,
      arguments: args.map((value) => ({ value })),
      awaitPromise: true,
      functionDeclaration: declaration,
      returnByValue: !options.handle,
      userGesture: true,
    })
    if (response.exceptionDetails) throw this.#scriptError(response.exceptionDetails)
    return options.handle ? response.result.objectId : response.result.value
  }

  /** Releases a remote object without waiting, since a dialog would hold the reply back. */
  async release(objectId: string | undefined): Promise<void> {
    if (objectId) void this.transport.send("Runtime.releaseObject", { objectId }).catch(() => {})
  }

  /** The frame an `<iframe>` element hosts, when it renders in this target. */
  async childFrame(objectId: string): Promise<string> {
    const described = await this.transport.send<{ node: { frameId?: string } }>(
      "DOM.describeNode",
      { objectId }
    )
    const frameId = described.node.frameId
    if (!frameId) throw new EngineError("not_a_frame", "The element is not a frame.")
    await this.ready()
    if (!this.#contexts.has(frameId)) {
      await this.waitFor(() => this.#contexts.has(frameId), 2_000, "the frame").catch(() => {
        throw new EngineError(
          "cross_origin_frame",
          "The frame's content runs in another process and cannot be reached from this tab. Interact with it through screenshots and coordinates."
        )
      })
    }
    return frameId
  }

  #scriptError(details: NonNullable<CallResult["exceptionDetails"]>): EngineError {
    const message = describeRemote(details.exception) || details.text
    return new EngineError("script_error", message.replace(/^Error: /u, ""))
  }

  #onEvent(event: CdpEvent): void {
    const params = event.params
    switch (event.method) {
      case "Runtime.executionContextCreated": {
        const context = params.context as {
          id: number
          auxData?: { frameId?: string; isDefault?: boolean }
        }
        if (context.auxData?.isDefault && context.auxData.frameId) {
          this.#contexts.set(context.auxData.frameId, context.id)
        }
        break
      }
      case "Runtime.executionContextDestroyed": {
        const id = params.executionContextId as number
        this.#installed.delete(id)
        for (const [frame, context] of this.#contexts) {
          if (context === id) this.#contexts.delete(frame)
        }
        break
      }
      case "Runtime.executionContextsCleared":
        this.#contexts.clear()
        this.#installed.clear()
        break
      case "Page.frameNavigated": {
        const frame = params.frame as { id: string; parentId?: string }
        if (!frame.parentId) {
          this.#mainFrameId = frame.id
          this.#navigations++
          this.#lifecycle.clear()
        }
        break
      }
      case "Page.navigatedWithinDocument":
        if (params.frameId === this.#mainFrameId) this.#navigations++
        break
      case "Page.lifecycleEvent":
        if (params.frameId === this.#mainFrameId) {
          const name = params.name as string
          if (name === "init") this.#lifecycle.clear()
          this.#lifecycle.add(name)
        }
        break
      case "Page.loadEventFired":
        this.#lifecycle.add("load")
        break
      case "Page.domContentEventFired":
        this.#lifecycle.add("DOMContentLoaded")
        break
      case "Page.javascriptDialogOpening":
        this.#dialog = {
          message: String(params.message ?? ""),
          type: params.type as PendingDialog["type"],
          ...(params.type === "prompt" ? { defaultValue: String(params.defaultPrompt ?? "") } : {}),
        }
        break
      case "Page.javascriptDialogClosed":
        this.#dialog = undefined
        break
      case "Page.fileChooserOpened":
        if (typeof params.backendNodeId === "number") {
          this.#fileChoosers.push({
            backendNodeId: params.backendNodeId,
            frameId: String(params.frameId),
            mode: params.mode as FileChooserEvent["mode"],
          })
        }
        break
      case "Runtime.consoleAPICalled": {
        const args = (params.args as RemoteObject[] | undefined) ?? []
        const trace = params.stackTrace as { callFrames?: { url?: string }[] } | undefined
        const url = trace?.callFrames?.[0]?.url
        this.#log({
          level: LEVELS[params.type as string] ?? "log",
          message: args.map(describeRemote).join(" "),
          timestamp: new Date().toISOString(),
          ...(url ? { url } : {}),
        })
        break
      }
      case "Runtime.exceptionThrown": {
        const details = params.exceptionDetails as {
          text: string
          url?: string
          exception?: RemoteObject
        }
        this.#log({
          level: "error",
          message: describeRemote(details.exception) || details.text,
          timestamp: new Date().toISOString(),
          ...(details.url ? { url: details.url } : {}),
        })
        break
      }
      case "Inspector.detached":
      case "Target.detachedFromTarget":
        this.#closed = true
        break
    }
    this.#wake()
  }

  #log(entry: ConsoleLog): void {
    this.#logs.push(entry)
    if (this.#logs.length > MAX_LOGS) this.#logs.splice(0, this.#logs.length - MAX_LOGS)
  }

  #wake(): void {
    const waiters = [...this.#waiters]
    this.#waiters.clear()
    for (const wake of waiters) wake()
  }
}

const isContextLost = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("Cannot find context") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Inspected target navigated or closed")
  )
}
