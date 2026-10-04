import { createHash } from "node:crypto"

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

/** The cua-driver tool calls the backend makes. */
export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<ToolResult>

type DriverApp = {
  name?: string
  bundle_id?: string
  launch_path?: string
  pid?: number
  running?: boolean
  windows?: DriverWindow[]
}
type DriverWindow = {
  window_id: number
  pid: number
  app_name?: string
  title?: string
  is_on_screen?: boolean
  z_index?: number
  layer?: number
}
type DriverElement = { element_index?: number; element_token?: string }

const KEY_ALIASES: Record<string, string> = {
  backspace: "delete",
  enter: "return",
  esc: "escape",
  option: "alt",
  page_down: "pagedown",
  page_up: "pageup",
  super: "cmd",
}

const normalizeKey = (key: string) => {
  const lower = key.trim().toLowerCase().replaceAll(" ", "")
  return KEY_ALIASES[lower] ?? lower
}

const textOf = (result: ToolResult) =>
  result.content
    .filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n")

const imageOf = (result: ToolResult): CuaImage | undefined => {
  const image = result.content.find((item) => item.type === "image" && item.data)
  return image?.data
    ? { dataBase64: image.data, mimeType: image.mimeType ?? "image/png" }
    : undefined
}

const failIfError = (result: ToolResult) => {
  if (result.isError) {
    throw new CuaHostError(
      String(
        result.structuredContent?.code ?? result.structuredContent?.error_code ?? "computer_error"
      ),
      textOf(result) || "The computer-use action failed."
    )
  }
  return result
}

/**
 * Native app control through cua-driver. Each Thread acts in its own driver session, which gives
 * it its own agent cursor. Element indices the model sees map to the opaque element tokens of the
 * latest snapshot of that window.
 */
export class ComputerBackend {
  readonly #call: ToolCaller
  readonly #platform: NodeJS.Platform
  readonly #elements = new Map<string, Map<number, string>>()

  constructor(call: ToolCaller, platform: NodeJS.Platform = process.platform) {
    this.#call = call
    this.#platform = platform
  }

  async listApps(threadId: string): Promise<AppInfo[]> {
    const apps = await this.#apps(threadId)
    return apps.map((app) => ({
      ...(app.bundle_id ? { bundleId: app.bundle_id } : {}),
      name: app.name ?? app.bundle_id ?? "Unknown app",
      ...(app.pid ? { pid: app.pid } : {}),
      running: app.running === true,
    }))
  }

  async listWindows(threadId: string, pid?: number): Promise<WindowInfo[]> {
    return (await this.#windows(threadId, pid)).map((window) => ({
      app: window.app_name ?? "",
      onScreen: window.is_on_screen !== false,
      pid: window.pid,
      ...(window.title ? { title: window.title } : {}),
      windowId: window.window_id,
    }))
  }

  /** Binds an app's frontmost window, opening the app in the background on macOS if needed. */
  async getApp(
    threadId: string,
    target: string | { windowId: number }
  ): Promise<{ binding: AppBinding; observation: CuaObservation }> {
    let window: DriverWindow
    let app: DriverApp | undefined
    if (typeof target === "object") {
      const found = (await this.#windows(threadId)).find(
        (item) => item.window_id === target.windowId
      )
      if (!found) throw new CuaHostError("not_found", `Window ${target.windowId} is not open.`)
      window = found
      app = (await this.#apps(threadId)).find((item) => item.pid === found.pid)
    } else {
      if (this.#platform !== "darwin") {
        throw new CuaHostError(
          "invalid",
          "On this platform getApp needs { windowId } from cua.listWindows()."
        )
      }
      app = await this.#resolveApp(threadId, target)
      const windows = await this.#appWindows(threadId, app)
      const chosen = windows.sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0]
      if (!chosen) {
        throw new CuaHostError(
          "no_window",
          `${app.name ?? target} has no open window. Ask the user to open one, or use selectMenu after binding another window.`
        )
      }
      window = chosen
    }
    const binding: AppBinding = {
      ...(app?.bundle_id ? { bundleId: app.bundle_id } : {}),
      name: app?.name ?? window.app_name ?? String(window.pid),
      pid: window.pid,
      windowId: window.window_id,
    }
    const observation = await this.observe(threadId, binding, { screenshot: false, tree: true })
    const others = (await this.#windows(threadId, window.pid)).filter(
      (item) => item.window_id !== window.window_id && (item.layer ?? 0) === 0
    )
    const note = others.length
      ? `\nOther windows of ${binding.name}: ${others.map((item) => `${item.window_id} "${item.title ?? ""}"`).join(", ")}. Bind one with cua.getApp({ windowId }).`
      : ""
    return {
      binding,
      observation: {
        ...observation,
        text: `${binding.name} — window ${binding.windowId}${window.title ? ` "${window.title}"` : ""}${note}\n${observation.text}`,
      },
    }
  }

  async observe(
    threadId: string,
    handle: AppHandle,
    options: { screenshot?: boolean; tree?: boolean; query?: string }
  ): Promise<CuaObservation> {
    const tree = options.tree !== false
    const result = failIfError(
      await this.#call("get_window_state", {
        include_accessibility_tree: tree,
        include_screenshot: options.screenshot === true || !tree,
        pid: handle.pid,
        ...(options.query ? { query: options.query } : {}),
        session: this.#session(threadId),
        window_id: handle.windowId,
      })
    )
    const structured = result.structuredContent ?? {}
    if (tree) {
      const elements = new Map<number, string>()
      for (const element of (structured.elements as DriverElement[] | undefined) ?? []) {
        if (typeof element.element_index === "number" && element.element_token) {
          elements.set(element.element_index, element.element_token)
        }
      }
      this.#elements.set(this.#key(threadId, handle), elements)
    }
    const markdown =
      typeof structured.tree_markdown === "string" ? structured.tree_markdown : textOf(result)
    const flags = [
      structured.truncated ? "The tree was truncated; narrow it with { query }." : "",
      typeof structured.degraded_reason === "string"
        ? `The accessibility tree is degraded (${structured.degraded_reason}); use the screenshot and coordinates.`
        : "",
    ].filter(Boolean)
    const image = imageOf(result)
    return {
      text: tree ? [markdown, ...flags].join("\n") : flags.join("\n"),
      ...(image ? { image } : {}),
    }
  }

  async act(threadId: string, handle: AppHandle, action: AppAction): Promise<{ notice?: string }> {
    const base = { pid: handle.pid, session: this.#session(threadId), window_id: handle.windowId }
    const element = (index: number) => {
      const token = this.#elements.get(this.#key(threadId, handle))?.get(index)
      if (!token) {
        throw new CuaHostError(
          "stale_element",
          `Element ${index} is not in the latest state of this window. Call getState() and use its indices.`
        )
      }
      return { element_token: token }
    }
    const at = (target: number | readonly [number, number]) =>
      typeof target === "number" ? element(target) : { x: target[0], y: target[1] }
    let tool: string
    let args: Record<string, unknown>
    switch (action.type) {
      case "click":
        tool = action.button === "right" && action.count === undefined ? "right_click" : "click"
        args = {
          ...base,
          ...at(action.target),
          ...(action.button && tool === "click" ? { button: action.button } : {}),
          ...(action.count ? { count: action.count } : {}),
          ...(action.modifiers?.length ? { modifier: action.modifiers } : {}),
        }
        break
      case "type":
        tool = "type_text"
        args = {
          ...base,
          text: action.text,
          ...(action.element !== undefined ? element(action.element) : {}),
          ...(action.point ? { x: action.point[0], y: action.point[1] } : {}),
        }
        break
      case "press": {
        const parts = action.key.split("+").map(normalizeKey).filter(Boolean)
        if (parts.length > 1) {
          tool = "hotkey"
          args = { ...base, keys: parts }
        } else {
          tool = "press_key"
          args = { ...base, key: parts[0] }
        }
        break
      }
      case "scroll":
        tool = "scroll"
        args = {
          ...base,
          ...at(action.target),
          direction: action.direction,
          ...(action.amount ? { amount: action.amount } : {}),
          ...(action.by ? { by: action.by } : {}),
        }
        break
      case "drag":
        tool = "drag"
        args = {
          ...base,
          from_x: action.from[0],
          from_y: action.from[1],
          to_x: action.to[0],
          to_y: action.to[1],
        }
        break
      case "set_value":
        tool = "set_value"
        args = { ...base, ...element(action.element), value: action.value }
        break
      case "perform":
        tool = "click"
        args = { ...base, ...element(action.element), action: action.action }
        break
      case "menu":
        tool = "invoke_menu"
        args = { ...base, path: action.path }
        break
      case "activate":
        tool = "bring_to_front"
        args = base
        break
    }
    const result = failIfError(await this.#call(tool, args))
    return this.#notice(result)
  }

  /** Forgets the element tokens of a Thread's windows. */
  closeThread(threadId: string): void {
    const prefix = `${threadId}:`
    for (const key of this.#elements.keys()) if (key.startsWith(prefix)) this.#elements.delete(key)
  }

  #notice(result: ToolResult): { notice?: string } {
    const structured = result.structuredContent ?? {}
    const effect = typeof structured.effect === "string" ? structured.effect : undefined
    const escalation = structured.escalation as
      | { recommended?: string; reason?: string }
      | undefined
    if (
      !escalation?.recommended &&
      (effect === undefined || effect === "confirmed" || effect === "unverifiable")
    ) {
      return {}
    }
    const next = {
      foreground: "retry it with activate() first, then observe",
      page: "for web content, use the browser APIs instead",
      px: "retry with coordinates from a screenshot",
    }[escalation?.recommended ?? ""]
    return {
      notice: `The action's effect was ${effect ?? "not confirmed"}${escalation?.reason ? ` (${escalation.reason})` : ""}.${next ? ` If the UI did not change, ${next}.` : ""}`,
    }
  }

  #session(threadId: string): string {
    return `cypheria-${createHash("sha256").update(threadId).digest("hex").slice(0, 12)}`
  }

  #key(threadId: string, handle: AppHandle): string {
    return `${threadId}:${handle.pid}:${handle.windowId}`
  }

  async #apps(threadId: string): Promise<DriverApp[]> {
    const result = failIfError(await this.#call("list_apps", { session: this.#session(threadId) }))
    return (result.structuredContent?.apps as DriverApp[] | undefined) ?? []
  }

  async #windows(threadId: string, pid?: number): Promise<DriverWindow[]> {
    const result = failIfError(
      await this.#call("list_windows", {
        ...(pid ? { pid } : {}),
        session: this.#session(threadId),
      })
    )
    return ((result.structuredContent?.windows as DriverWindow[] | undefined) ?? []).filter(
      (window) => (window.layer ?? 0) === 0
    )
  }

  async #resolveApp(threadId: string, target: string): Promise<DriverApp> {
    const apps = await this.#apps(threadId)
    const wanted = target.toLowerCase()
    const matches = apps.filter(
      (app) =>
        app.name?.toLowerCase() === wanted ||
        app.bundle_id?.toLowerCase() === wanted ||
        app.launch_path?.toLowerCase() === wanted
    )
    const running = matches.filter((app) => app.running)
    if (running.length > 1) {
      throw new CuaHostError(
        "ambiguous",
        `Several running apps match "${target}": ${running.map((app) => `${app.name} [${app.bundle_id}] pid ${app.pid}`).join("; ")}. Use a bundle ID.`
      )
    }
    if (running[0]) return running[0]
    const installed = matches[0]
    if (!installed) {
      throw new CuaHostError(
        "not_found",
        `No app named "${target}". Check cua.listApps() for its name or bundle ID.`
      )
    }
    const launched = failIfError(
      await this.#call("launch_app", {
        ...(installed.bundle_id ? { bundle_id: installed.bundle_id } : { name: installed.name }),
        session: this.#session(threadId),
      })
    )
    const structured = launched.structuredContent ?? {}
    return {
      ...installed,
      pid: typeof structured.pid === "number" ? structured.pid : installed.pid,
      running: true,
      windows: (structured.windows as DriverWindow[] | undefined) ?? [],
    }
  }

  async #appWindows(threadId: string, app: DriverApp): Promise<DriverWindow[]> {
    if (!app.pid) return []
    const windows = await this.#windows(threadId, app.pid)
    if (windows.length > 0) return windows
    return (app.windows ?? []).map((window) => ({ ...window, pid: window.pid ?? app.pid }))
  }
}
