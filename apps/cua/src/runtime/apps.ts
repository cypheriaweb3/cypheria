import type { AppAction, AppBinding, AppInfo, CuaObservation, WindowInfo } from "../protocol.ts"
import type { SnapshotHistory } from "./diff.ts"
import type { Documentation } from "./docs.ts"
import { call, decodeBase64, emitImage, writeText } from "./host.ts"

type Point = [x: number, y: number]
type Target = number | Point
type EmitOption = { emit?: boolean }
type StateOptions = EmitOption & {
  /** Return the whole tree instead of the changes since the last observation. */
  full?: boolean
  /** Keep only rows containing this text, with their ancestors; indices are unchanged. */
  query?: string
}
type ActionResult = { readonly notice?: string }
type Modifier = "cmd" | "ctrl" | "alt" | "shift" | "fn"

/** A bound window of a native app. Element indices come from its latest state. */
export class App {
  /** The device the app runs on. */
  readonly host: string
  readonly #binding: AppBinding
  readonly #history: SnapshotHistory

  constructor(host: string, binding: AppBinding, history: SnapshotHistory) {
    this.host = host
    this.#binding = binding
    this.#history = history
  }

  get name(): string {
    return this.#binding.name
  }
  get pid(): number {
    return this.#binding.pid
  }
  get windowId(): number {
    return this.#binding.windowId
  }

  /** The accessibility tree, as changes since the last observation unless `full`. */
  async getState(options: StateOptions = {}): Promise<string> {
    return (await this.#observe(options, false)).text
  }

  async getScreenshot(options: EmitOption = {}): Promise<Uint8Array> {
    const observation = await call<CuaObservation>({
      handle: this.#handle,
      host: this.host,
      op: "apps.observe",
      screenshot: true,
      tree: false,
    })
    if (!observation.image) throw new Error(`No screenshot is available for ${this.name}.`)
    if (options.emit !== false) await emitImage(observation.image)
    return decodeBase64(observation.image.dataBase64)
  }

  async getStateAndScreenshot(
    options: StateOptions = {}
  ): Promise<{ state: string; screenshot?: Uint8Array }> {
    const observation = await this.#observe(options, true)
    return observation.image
      ? { screenshot: decodeBase64(observation.image.dataBase64), state: observation.text }
      : { state: observation.text }
  }

  click(
    target: Target,
    options: { button?: "left" | "right" | "middle"; count?: number; modifiers?: Modifier[] } = {}
  ): Promise<ActionResult> {
    return this.#act({ ...options, target, type: "click" })
  }

  /** Types into the focused element, or first focuses `element` or the field at `point`. */
  typeText(text: string, options: { element?: number; point?: Point } = {}): Promise<ActionResult> {
    return this.#act({ ...options, text, type: "type" })
  }

  /** Presses a key or chord such as `"Return"`, `"cmd+c"`, or `"shift+Tab"`. */
  pressKey(key: string): Promise<ActionResult> {
    return this.#act({ key, type: "press" })
  }

  scroll(
    target: Target,
    direction: "up" | "down" | "left" | "right",
    amount?: number,
    options: { by?: "line" | "page" } = {}
  ): Promise<ActionResult> {
    return this.#act({ ...options, amount, direction, target, type: "scroll" })
  }

  drag(from: Point, to: Point): Promise<ActionResult> {
    return this.#act({ from, to, type: "drag" })
  }

  setValue(element: number, value: string): Promise<ActionResult> {
    return this.#act({ element, type: "set_value", value })
  }

  /** Invokes an accessibility action the element lists, such as `"AXShowMenu"`. */
  performAction(element: number, action: string): Promise<ActionResult> {
    return this.#act({ action, element, type: "perform" })
  }

  /** Chooses an application menu item by its titles, such as `["File", "New Window"]`. */
  selectMenu(path: string[]): Promise<ActionResult> {
    return this.#act({ path, type: "menu" })
  }

  /** Brings the window to the front. Actions normally run in the background without this. */
  activate(): Promise<ActionResult> {
    return this.#act({ type: "activate" })
  }

  get #handle() {
    return { pid: this.#binding.pid, windowId: this.#binding.windowId }
  }

  get #key() {
    return appKey(this.host, this.#binding)
  }

  async #observe(options: StateOptions, screenshot: boolean): Promise<CuaObservation> {
    const observation = await call<CuaObservation>({
      handle: this.#handle,
      host: this.host,
      op: "apps.observe",
      query: options.query,
      screenshot,
      tree: true,
    })
    const text = options.query
      ? observation.text
      : this.#history.render(this.#key, this.name, observation.text, options.full)
    if (options.emit !== false) {
      writeText(text)
      if (observation.image) await emitImage(observation.image)
    }
    return { ...observation, text }
  }

  async #act(action: AppAction): Promise<ActionResult> {
    const result = await call<ActionResult>({
      action,
      handle: this.#handle,
      host: this.host,
      op: "apps.act",
    })
    if (result.notice) writeText(result.notice)
    return result
  }
}

const appKey = (host: string, binding: AppBinding) =>
  `app:${host}:${binding.pid}:${binding.windowId}`

/** `host` picks the device; by default it is the one the person wrote from. */
type HostOption = { host?: string }

export const createAppsApi = (history: SnapshotHistory, docs: Documentation) => ({
  async getApp(target: string | { windowId: number }, options: HostOption = {}): Promise<App> {
    docs.enter("computer")
    const opened = await call<{ binding: AppBinding; host: string; observation: CuaObservation }>({
      app: target,
      host: options.host,
      op: "apps.get",
    })
    const app = new App(opened.host, opened.binding, history)
    const key = appKey(opened.host, opened.binding)
    history.forget(key)
    writeText(history.render(key, app.name, opened.observation.text))
    if (opened.observation.image) await emitImage(opened.observation.image)
    return app
  },

  async listApps(options: EmitOption & HostOption = {}): Promise<AppInfo[]> {
    docs.enter("computer")
    const apps = await call<AppInfo[]>({ host: options.host, op: "apps.list" })
    if (options.emit !== false) writeText(JSON.stringify(apps))
    return apps
  },

  async listWindows(
    options: EmitOption & HostOption & { pid?: number } = {}
  ): Promise<WindowInfo[]> {
    docs.enter("computer")
    const windows = await call<WindowInfo[]>({
      host: options.host,
      op: "apps.windows",
      pid: options.pid,
    })
    if (options.emit !== false) writeText(JSON.stringify(windows))
    return windows
  },
})
