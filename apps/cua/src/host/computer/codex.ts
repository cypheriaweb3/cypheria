import { execFile } from "node:child_process"
import { join } from "node:path"
import { promisify } from "node:util"

import type {
  AppAction,
  AppBinding,
  AppHandle,
  AppInfo,
  CuaImage,
  CuaObservation,
  WindowInfo,
} from "../../protocol.ts"
import { CuaHostError } from "../errors.ts"
import type { ToolResult } from "./cua-driver.ts"
import { type McpLaunch, McpStdioClient } from "./mcp-stdio.ts"
import type { NativeAppsBackend } from "./types.ts"

const run = promisify(execFile)

const MARKER = "\u0000cypheria-result:"
const IDLE_MS = 10 * 60_000

/** What the runtime asks before Computer Use first operates an app, or records audio. */
export type AppApprovalRequest =
  | {
      readonly kind: "app"
      /** The app's bundle identifier. */
      readonly app: string
      readonly displayName: string
      readonly risk: "low" | "high"
      readonly subtitle?: string
      /** Whether the person may allow the app for good, not only for this Thread. */
      readonly allowAlways: boolean
    }
  | {
      /** Recording the computer's audio. */
      readonly kind: "audio"
      readonly risk: "low" | "high"
      readonly allowAlways: boolean
    }

export type AppApprovalDecision = "session" | "always" | "deny"

export type CodexComputerUseOptions = {
  /** How to start the runtime; null when it is unavailable, such as before detection. */
  readonly launch: () => McpLaunch | null
  /** Asks the people in the Thread whether Computer Use may operate an app. */
  readonly approve: (threadId: string, request: AppApprovalRequest) => Promise<AppApprovalDecision>
  /** Codex Computer Use.app, whose client reports turn ends to the service. */
  readonly serviceApp?: () => string | null
  /** Reports a failure that makes the runtime unusable until settings change. */
  readonly onUnavailable?: (reason: string) => void
  readonly idleMs?: number
  readonly log?: (line: string) => void
  /** Starts a client, for tests. */
  readonly client?: (launch: McpLaunch, onRequest: McpRequestHandler) => RuntimeClient
  /** Runs `SkyComputerUseClient turn-ended`, for tests. */
  readonly runClient?: (client: string, args: readonly string[]) => Promise<void>
}

type McpRequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>

/** The part of `McpStdioClient` the backend uses. */
export type RuntimeClient = {
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { readonly meta?: Record<string, unknown>; readonly timeoutMs?: number }
  ): Promise<ToolResult>
  close(): void
}

type BoundApp = { readonly app: string; readonly name: string; readonly bundleId?: string }

type ThreadRuntime = {
  client: RuntimeClient
  turn: number
  idle: ReturnType<typeof setTimeout> | undefined
}

type SkyApp = {
  id?: string
  displayName?: string
  isRunning?: boolean
  lastUsedDate?: string
}

type JsOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly name: string; readonly code: unknown; readonly message: string }

/** Errors after which the runtime cannot serve this device until the person acts. */
const FATAL = new Set(["incompatibleClientVersion", "senderProcessNotAuthenticated"])
const STOPPED = new Set(["userStoppedSession", "userIntervened"])

const textOf = (result: ToolResult) =>
  result.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n")

const imageOf = (result: ToolResult): CuaImage | undefined => {
  const image = result.content.find((item) => item.type === "image" && item.data)
  return image?.data
    ? { dataBase64: image.data, mimeType: image.mimeType ?? "image/png" }
    : undefined
}

/** One `js` call against the raw `sky` API, which reports its own outcome after a marker. */
const skyCall = (method: string, input: unknown, emitScreenshot: boolean) => `await (async () => {
  try {
    const value = await cua.computer.${method}(${JSON.stringify(input)});
    if (${emitScreenshot} && value?.screenshot?.url) await nodeRepl.emitImage(value.screenshot.url);
    // Pixels and recordings stay out of the text: screenshots return as images, and audio is read
    // from the file the runtime saved.
    const plain = value && typeof value === "object" && !Array.isArray(value) ? { ...value, screenshot: undefined, bytes: undefined, data_url: undefined } : value ?? null;
    nodeRepl.write(${JSON.stringify(MARKER)} + JSON.stringify({ ok: true, value: plain }));
  } catch (error) {
    nodeRepl.write(${JSON.stringify(MARKER)} + JSON.stringify({ ok: false, name: String(error?.errorName ?? error?.name ?? "Error"), code: error?.code ?? null, message: String(error?.message ?? error) }));
  }
})()`

/**
 * Native app control through the Computer Use runtime of the person's installed ChatGPT, on
 * macOS. Each Thread gets its own runtime process, as Codex runs one MCP connection set per
 * thread; Cypheria is its MCP client and turns each request into one `js` call against the raw
 * `sky` API. The runtime keeps its own app policy; its approval requests become Cypheria
 * approvals that any client of the Thread can answer.
 */
export class CodexComputerUseBackend implements NativeAppsBackend {
  readonly #options: CodexComputerUseOptions
  readonly #threads = new Map<string, ThreadRuntime>()
  /** The apps each Thread bound, by the handle the model holds. */
  readonly #apps = new Map<string, Map<number, BoundApp>>()
  #nextHandle = 1

  constructor(options: CodexComputerUseOptions) {
    this.#options = options
  }

  async listApps(threadId: string): Promise<AppInfo[]> {
    const apps = (await this.#sky(threadId, "list_apps", undefined)).value as SkyApp[]
    return (Array.isArray(apps) ? apps : []).flatMap((app) =>
      app.id
        ? [
            {
              bundleId: app.id,
              name: app.displayName ?? app.id,
              running: app.isRunning === true,
            },
          ]
        : []
    )
  }

  listWindows(_threadId: string, _pid?: number): Promise<WindowInfo[]> {
    return Promise.reject(
      new CuaHostError(
        "unsupported",
        "Codex Computer Use binds apps, not windows: call cua.getApp() with the app's name or bundle ID."
      )
    )
  }

  async getApp(
    threadId: string,
    target: string | { windowId: number }
  ): Promise<{ binding: AppBinding; observation: CuaObservation }> {
    if (typeof target !== "string") {
      throw new CuaHostError(
        "unsupported",
        "Codex Computer Use binds apps by name or bundle ID, not by window."
      )
    }
    const state = await this.#sky(threadId, "get_app_state", { app: target, disableDiff: true })
    const value = (state.value ?? {}) as { app?: unknown; text?: unknown }
    const apps = await this.listApps(threadId).catch(() => [])
    const wanted = target.toLowerCase()
    const known = apps.find(
      (app) => app.bundleId?.toLowerCase() === wanted || app.name.toLowerCase() === wanted
    )
    const bound: BoundApp = {
      app: known?.bundleId ?? target,
      name: known?.name ?? target,
      ...(known?.bundleId ? { bundleId: known.bundleId } : {}),
    }
    const handle = this.#nextHandle++
    let threadApps = this.#apps.get(threadId)
    if (!threadApps) {
      threadApps = new Map()
      this.#apps.set(threadId, threadApps)
    }
    threadApps.set(handle, bound)
    return {
      binding: {
        name: bound.name,
        pid: handle,
        windowId: handle,
        ...(bound.bundleId ? { bundleId: bound.bundleId } : {}),
      },
      observation: { text: typeof value.text === "string" ? value.text : "" },
    }
  }

  async observe(
    threadId: string,
    handle: AppHandle,
    options: { screenshot?: boolean; tree?: boolean; query?: string }
  ): Promise<CuaObservation> {
    const { app } = this.#bound(threadId, handle)
    const tree = options.tree !== false
    const screenshot = options.screenshot === true || !tree
    // Cypheria's runtime diffs states itself, so the device always reads the full tree.
    const outcome = await this.#sky(
      threadId,
      "get_app_state",
      { app, disableDiff: true },
      screenshot
    )
    const value = (outcome.value ?? {}) as { text?: unknown }
    let text = tree && typeof value.text === "string" ? value.text : ""
    if (tree && options.query) {
      const query = options.query.toLowerCase()
      text = text
        .split("\n")
        .filter((line) => line.toLowerCase().includes(query))
        .join("\n")
    }
    return { text, ...(outcome.image ? { image: outcome.image } : {}) }
  }

  async act(threadId: string, handle: AppHandle, action: AppAction): Promise<{ notice?: string }> {
    const { app } = this.#bound(threadId, handle)
    const at = (target: number | readonly [number, number]) =>
      typeof target === "number" ? { element_index: target } : { x: target[0], y: target[1] }
    switch (action.type) {
      case "click":
        if (action.modifiers?.length) {
          throw new CuaHostError(
            "unsupported",
            "Codex Computer Use clicks without modifier keys; hold them with pressKey instead."
          )
        }
        await this.#sky(threadId, "click", {
          app,
          ...at(action.target),
          ...(action.button ? { mouse_button: action.button } : {}),
          ...(action.count ? { click_count: action.count } : {}),
        })
        return {}
      case "type":
        if (action.element !== undefined || action.point) {
          await this.#sky(threadId, "click", {
            app,
            ...(action.element !== undefined
              ? { element_index: action.element }
              : { x: action.point?.[0], y: action.point?.[1] }),
          })
        }
        await this.#sky(threadId, "type_text", { app, text: action.text })
        return {}
      case "press":
        await this.#sky(threadId, "press_key", { app, key: action.key })
        return {}
      case "scroll": {
        const pages = action.pixels
          ? action.pixels / 600
          : action.by === "line"
            ? (action.amount ?? 3) / 10
            : (action.amount ?? 1)
        await this.#sky(threadId, "scroll", {
          app,
          ...at(action.target),
          direction: action.direction,
          pages: Math.max(0.1, Math.round(pages * 10) / 10),
        })
        return {}
      }
      case "drag":
        await this.#sky(threadId, "drag", {
          app,
          from_x: action.from[0],
          from_y: action.from[1],
          to_x: action.to[0],
          to_y: action.to[1],
        })
        return {}
      case "set_value":
        await this.#sky(threadId, "set_value", {
          app,
          element_index: action.element,
          value: action.value,
        })
        return {}
      case "perform":
        await this.#sky(threadId, "perform_secondary_action", {
          action: action.action,
          app,
          element_index: action.element,
        })
        return {}
      case "paste":
        await this.#sky(threadId, "paste", {
          app,
          format: action.format ?? "text",
          text: action.text,
        })
        return {}
      case "select_text":
        await this.#sky(threadId, "select_text", {
          app,
          element_index: action.element,
          text: action.text,
          ...(action.prefix ? { prefix: action.prefix } : {}),
          ...(action.suffix ? { suffix: action.suffix } : {}),
          ...(action.selectionType ? { selection_type: action.selectionType } : {}),
        })
        return {}
      case "menu":
        throw new CuaHostError(
          "unsupported",
          "Codex Computer Use has no menu API: click the menu bar items, or use the app's keyboard shortcuts."
        )
      case "activate":
        // The runtime acts in the background and never needs the app in front.
        return {}
    }
  }

  async launchApp(threadId: string, app: string): Promise<void> {
    await this.#sky(threadId, "get_app_state", { app, disableDiff: true })
  }

  async startAudioRecording(threadId: string, maxDurationMs?: number): Promise<void> {
    await this.#sky(
      threadId,
      "start_audio_recording",
      maxDurationMs === undefined ? {} : { max_duration_ms: maxDurationMs }
    )
  }

  async stopAudioRecording(threadId: string): Promise<{ path: string; mimeType: string }> {
    const value = (await this.#sky(threadId, "stop_audio_recording", undefined)).value as {
      filepath?: unknown
    } | null
    if (typeof value?.filepath !== "string" || !value.filepath) {
      throw new CuaHostError("computer_error", "Computer Use did not return the recording.")
    }
    return { mimeType: "audio/wav", path: value.filepath }
  }

  /** Tells the runtime and its service that the Thread's turn ended, as Codex does. */
  async turnEnded(threadId: string): Promise<void> {
    const runtime = this.#threads.get(threadId)
    if (!runtime) return
    const turnId = this.#turnId(threadId, runtime)
    runtime.turn++
    await runtime.client
      .callTool(
        "turn_ended",
        { hook_event_name: "Stop", session_id: threadId, turn_id: turnId },
        { timeoutMs: 10_000 }
      )
      .catch(() => undefined)
    const serviceApp = this.#options.serviceApp?.()
    if (!serviceApp) return
    const client = join(
      serviceApp,
      "Contents",
      "SharedSupport",
      "SkyComputerUseClient.app",
      "Contents",
      "MacOS",
      "SkyComputerUseClient"
    )
    const payload = JSON.stringify({
      "thread-id": threadId,
      "turn-id": turnId,
      type: "agent-turn-complete",
    })
    await (this.#options.runClient ?? defaultRunClient)(client, ["turn-ended", payload]).catch(
      (error: unknown) =>
        this.#options.log?.(
          `turn-ended failed: ${error instanceof Error ? error.message : String(error)}`
        )
    )
  }

  closeThread(threadId: string): void {
    const runtime = this.#threads.get(threadId)
    this.#threads.delete(threadId)
    this.#apps.delete(threadId)
    if (runtime) {
      clearTimeout(runtime.idle)
      runtime.client.close()
    }
  }

  /** Stops every runtime, such as when the device switches backends. */
  dispose(): void {
    for (const threadId of [...this.#threads.keys()]) this.closeThread(threadId)
  }

  #bound(threadId: string, handle: AppHandle): BoundApp {
    const bound = this.#apps.get(threadId)?.get(handle.windowId)
    if (!bound || handle.pid !== handle.windowId) {
      throw new CuaHostError(
        "not_found",
        "That app is not bound in this task; call cua.getApp() again."
      )
    }
    return bound
  }

  #turnId(threadId: string, runtime: ThreadRuntime): string {
    return `${threadId}:${runtime.turn}`
  }

  #runtime(threadId: string): ThreadRuntime {
    let runtime = this.#threads.get(threadId)
    if (!runtime) {
      const launch = this.#options.launch()
      if (!launch) {
        throw new CuaHostError(
          "computer_unavailable",
          "Codex Computer Use is unavailable on this device. Ask the user to check Settings → Computer Use in Cypheria Desktop."
        )
      }
      const onRequest: McpRequestHandler = (method, params) =>
        this.#onRequest(threadId, method, params)
      const client =
        this.#options.client?.(launch, onRequest) ??
        new McpStdioClient({
          launch,
          onExit: () => {
            const current = this.#threads.get(threadId)
            if (current?.client === client) {
              clearTimeout(current.idle)
              this.#threads.delete(threadId)
            }
          },
          onRequest,
          onStderr: (line) => this.#options.log?.(line),
        })
      runtime = { client, idle: undefined, turn: 1 }
      this.#threads.set(threadId, runtime)
    }
    clearTimeout(runtime.idle)
    const current = runtime
    current.idle = setTimeout(() => {
      if (this.#threads.get(threadId) !== current) return
      this.#threads.delete(threadId)
      current.client.close()
    }, this.#options.idleMs ?? IDLE_MS)
    current.idle.unref?.()
    return current
  }

  async #sky(
    threadId: string,
    method: string,
    input: unknown,
    screenshot = false
  ): Promise<{ value: unknown; image?: CuaImage }> {
    const runtime = this.#runtime(threadId)
    const result = await runtime.client.callTool(
      "js",
      { code: skyCall(method, input ?? {}, screenshot), timeout_ms: 120_000 },
      {
        meta: {
          "x-codex-turn-metadata": {
            session_id: threadId,
            turn_id: this.#turnId(threadId, runtime),
          },
        },
        timeoutMs: 150_000,
      }
    )
    const text = textOf(result)
    const at = text.lastIndexOf(MARKER)
    if (at < 0) {
      throw new CuaHostError(
        "computer_error",
        text.trim().slice(0, 2_000) || "The computer-use runtime returned no result."
      )
    }
    const outcome = JSON.parse(text.slice(at + MARKER.length).split("\n")[0] ?? "null") as JsOutcome
    if (!outcome.ok) throw this.#error(outcome)
    const image = imageOf(result)
    return { value: outcome.value, ...(image ? { image } : {}) }
  }

  #error(outcome: Extract<JsOutcome, { ok: false }>): CuaHostError {
    if (FATAL.has(outcome.name)) {
      const reason =
        outcome.name === "incompatibleClientVersion"
          ? "ChatGPT's Computer Use service does not accept this runtime version. Update ChatGPT, or switch to cua-driver."
          : "ChatGPT's Computer Use service did not accept the runtime. Turn Computer Use off and on in ChatGPT, or switch to cua-driver."
      this.#options.onUnavailable?.(reason)
      return new CuaHostError("computer_unavailable", reason)
    }
    if (STOPPED.has(outcome.name)) {
      return new CuaHostError(
        "user_stopped",
        "The user stopped Computer Use. Do not continue in this app unless they ask again."
      )
    }
    return new CuaHostError("computer_error", outcome.message || outcome.name)
  }

  /**
   * The runtime's requests: its app approvals become Cypheria approvals, and its own approval of
   * the JavaScript Cypheria sends is granted, since Cypheria wrote that code.
   */
  async #onRequest(
    threadId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    if (method !== "elicitation/create") throw new Error(`Unsupported request ${method}.`)
    const meta = (params._meta ?? {}) as Record<string, unknown>
    if (meta.connector_id === "node_repl") return { action: "accept", content: {} }
    if (meta.connector_id !== "computer-use") return { action: "decline" }
    const persist = Array.isArray(meta.persist) ? meta.persist : []
    const risk = meta.riskLevel === "high" ? "high" : "low"
    if (meta.tool_name === "start_audio_recording") {
      return this.#answer(
        await this.#options
          .approve(threadId, { allowAlways: persist.includes("always"), kind: "audio", risk })
          .catch(() => "deny" as const)
      )
    }
    const toolParams = (meta.tool_params ?? {}) as { app?: unknown }
    const display = Array.isArray(meta.tool_params_display)
      ? (meta.tool_params_display as { name?: unknown; value?: unknown }[]).find(
          (item) => item.name === "app"
        )
      : undefined
    const app = typeof toolParams.app === "string" ? toolParams.app : ""
    if (!app) return { action: "decline" }
    const decision = await this.#options
      .approve(threadId, {
        allowAlways: persist.includes("always"),
        app,
        displayName: typeof display?.value === "string" ? display.value : app,
        kind: "app",
        risk,
        ...(typeof meta.subtitle === "string" ? { subtitle: meta.subtitle } : {}),
      })
      .catch(() => "deny" as const)
    return this.#answer(decision)
  }

  #answer(decision: AppApprovalDecision) {
    if (decision === "deny") return { action: "decline" }
    return { _meta: { persist: decision }, action: "accept", content: {} }
  }
}

const defaultRunClient = async (client: string, args: readonly string[]): Promise<void> => {
  await run(client, [...args], { timeout: 10_000 })
}
