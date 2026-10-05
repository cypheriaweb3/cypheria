import { AUDIO_CHUNK_BYTES } from "../audio.ts"
import type {
  AppAction,
  AppBinding,
  AppInfo,
  CuaAudioRecording,
  CuaObservation,
  WindowInfo,
} from "../protocol.ts"
import type { SnapshotHistory } from "./diff.ts"
import type { Documentation } from "./docs.ts"
import { call, decodeBase64, emitImage, writeText } from "./host.ts"

type Vec2 = [x: number, y: number]
type ObservationOptions = { emit?: boolean }
type StateOptions = ObservationOptions & {
  disableDiffing?: boolean
  /** Keep only rows containing this text, with their ancestors; indices are unchanged. */
  query?: string
}
type ActionResult = { readonly notice?: string }

const DIRECTIONS: Record<string, "up" | "down" | "left" | "right"> = {
  d: "down",
  down: "down",
  l: "left",
  left: "left",
  r: "right",
  right: "right",
  u: "up",
  up: "up",
}

const button = (value: string | undefined) =>
  value === "r" || value === "right"
    ? "right"
    : value === "m" || value === "middle"
      ? "middle"
      : "left"

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

  async getAXState(options: StateOptions = {}): Promise<string> {
    return (await this.#observe(options, false)).text
  }

  async getScreenshot(options: ObservationOptions = {}): Promise<Uint8Array> {
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

  async getAXStateAndScreenshot(
    options: StateOptions = {}
  ): Promise<{ state: string; screenshot?: Uint8Array }> {
    const observation = await this.#observe(options, true)
    return observation.image
      ? { screenshot: decodeBase64(observation.image.dataBase64), state: observation.text }
      : { state: observation.text }
  }

  async click(
    target: number | Vec2,
    options: {
      mouseButton?: string
      clickCount?: number
      modifiers?: ("cmd" | "ctrl" | "alt" | "shift" | "fn")[]
    } = {}
  ): Promise<void> {
    await this.#act({
      button: button(options.mouseButton),
      ...(options.clickCount ? { count: options.clickCount } : {}),
      ...(options.modifiers ? { modifiers: options.modifiers } : {}),
      target,
      type: "click",
    })
  }

  async drag(from: Vec2, to: Vec2): Promise<void> {
    await this.#act({ from, to, type: "drag" })
  }

  async scroll(
    target: number | Vec2,
    direction: string,
    distance?: number | { pixels: number }
  ): Promise<void> {
    const resolved = DIRECTIONS[direction]
    if (!resolved) throw new Error("direction must be up, down, left, or right.")
    await this.#act({
      direction: resolved,
      target,
      type: "scroll",
      ...(typeof distance === "number" ? { amount: distance, by: "page" as const } : {}),
      ...(typeof distance === "object" ? { pixels: distance.pixels } : {}),
    })
  }

  async selectText(
    elementIndex: number,
    text: string,
    options: {
      prefix?: string
      suffix?: string
      selectionType?: "text" | "cursor_before" | "cursor_after"
    } = {}
  ): Promise<void> {
    await this.#act({ element: elementIndex, text, type: "select_text", ...options })
  }

  async setValue(elementIndex: number, value: string): Promise<void> {
    await this.#act({ element: elementIndex, type: "set_value", value })
  }

  async performSecondaryAction(elementIndex: number, action: string): Promise<void> {
    await this.#act({ action, element: elementIndex, type: "perform" })
  }

  async paste(text: string, options: { format?: "text" | "md" | "html" } = {}): Promise<void> {
    await this.#act({ text, type: "paste", ...options })
  }

  async pressKey(key: string): Promise<void> {
    await this.#act({ key, type: "press" })
  }

  async typeText(text: string): Promise<void> {
    await this.#act({ text, type: "type" })
  }

  /** Chooses an application menu item by its titles, such as `["File", "New Window"]`. */
  async selectMenu(path: string[]): Promise<void> {
    await this.#act({ path, type: "menu" })
  }

  /** Brings the window to the front. Actions normally run in the background without this. */
  async activate(): Promise<void> {
    await this.#act({ type: "activate" })
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
      : this.#history.render(this.#key, this.name, observation.text, options.disableDiffing)
    if (options.emit !== false) {
      writeText(text)
      if (observation.image) await emitImage(observation.image)
    }
    return { ...observation, text }
  }

  async #act(action: AppAction): Promise<void> {
    const result = await call<ActionResult>({
      action,
      handle: this.#handle,
      host: this.host,
      op: "apps.act",
    })
    if (result.notice) writeText(result.notice)
  }
}

const appKey = (host: string, binding: AppBinding) =>
  `app:${host}:${binding.pid}:${binding.windowId}`

/** `host` picks the device; by default it is the one the person wrote from. */
type HostOption = { host?: string }

const TARGETS: Record<string, "mac" | "linux" | "windows"> = {
  darwin: "mac",
  linux: "linux",
  win32: "windows",
}

/** Records the computer's audio, which the model hears through `nodeRepl.emitAudio`. */
const audioApi = (docs: Documentation) => ({
  async start_audio_recording(
    input: { max_duration_ms?: number } & HostOption = {}
  ): Promise<void> {
    docs.enterApps()
    await call({
      host: input.host,
      maxDurationMs: input.max_duration_ms,
      op: "apps.audio.start",
    })
  },

  async stop_audio_recording(input: HostOption = {}): Promise<{ data_url: string }> {
    const recording = await call<CuaAudioRecording>({ host: input.host, op: "apps.audio.stop" })
    let base64 = ""
    for (let offset = 0; offset < recording.size; offset += AUDIO_CHUNK_BYTES) {
      base64 += await call<string>({
        host: input.host,
        length: AUDIO_CHUNK_BYTES,
        offset,
        op: "apps.audio.read",
      })
    }
    return { data_url: `data:${recording.mimeType};base64,${base64}` }
  },
})

export const createAppsApi = (history: SnapshotHistory, docs: Documentation, platform: string) => ({
  computer: {
    async launch_app(input: { app: string } & HostOption): Promise<void> {
      docs.enterApps()
      await call({ app: input.app, host: input.host, op: "apps.launch" })
    },
    target: TARGETS[platform] ?? "mac",
    ...(docs.audio ? audioApi(docs) : {}),
  },

  async getApp(target: string | { windowId: number }, options: HostOption = {}): Promise<App> {
    docs.enterApps()
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

  async listApps(options: ObservationOptions & HostOption = {}): Promise<AppInfo[]> {
    docs.enterApps()
    const apps = await call<AppInfo[]>({ host: options.host, op: "apps.list" })
    if (options.emit !== false) writeText(JSON.stringify(apps))
    return apps
  },

  async listWindows(
    options: ObservationOptions & HostOption & { pid?: number } = {}
  ): Promise<WindowInfo[]> {
    docs.enterApps()
    const windows = await call<WindowInfo[]>({
      host: options.host,
      op: "apps.windows",
      pid: options.pid,
    })
    if (options.emit !== false) writeText(JSON.stringify(windows))
    return windows
  },
})
