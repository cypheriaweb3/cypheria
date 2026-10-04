import type { CuaImage, McpAppAction, McpAppInfo } from "../protocol.ts"
import type { SnapshotHistory } from "./diff.ts"
import type { Documentation } from "./docs.ts"
import { call, decodeBase64, emitImage, writeText } from "./host.ts"

type Ref = string
type EmitOption = { emit?: boolean }
type ActionResponse = {
  readonly text?: string
  readonly image?: CuaImage
  readonly notice?: string
}

/** An MCP App open in this task. Input is synthetic DOM events; refs come from its snapshot. */
export class McpAppTab {
  readonly id: string
  readonly title: string
  readonly #history: SnapshotHistory

  constructor(info: McpAppInfo, history: SnapshotHistory) {
    this.id = info.id
    this.title = info.title
    this.#history = history
  }

  async snapshot(options: EmitOption & { full?: boolean } = {}): Promise<string> {
    const response = await this.#act({ type: "snapshot" })
    const text = `MCP App ${this.id}: ${this.title}\n${this.#history.render(`mcpapp:${this.id}`, "this App", response.text ?? "", options.full)}`
    if (options.emit !== false) writeText(text)
    return text
  }

  async screenshot(options: EmitOption = {}): Promise<Uint8Array> {
    const response = await this.#act({ type: "screenshot" })
    if (!response.image) throw new Error("The App returned no screenshot.")
    if (options.emit !== false) await emitImage(response.image)
    return decodeBase64(response.image.dataBase64)
  }

  async click(ref: Ref): Promise<void> {
    await this.#act({ ref, type: "click" })
  }
  async fill(ref: Ref, value: string): Promise<void> {
    await this.#act({ ref, type: "fill", value })
  }
  async type(text: string, options: { ref?: Ref } = {}): Promise<void> {
    await this.#act({ ...options, text, type: "type" })
  }
  async press(key: string, options: { ref?: Ref } = {}): Promise<void> {
    await this.#act({ ...options, key, type: "press" })
  }
  async select(ref: Ref, value: string): Promise<void> {
    await this.#act({ ref, type: "select", value })
  }
  async check(ref: Ref, checked = true): Promise<void> {
    await this.#act({ checked, ref, type: "check" })
  }
  async scroll(options: { dx?: number; dy: number; ref?: Ref }): Promise<void> {
    await this.#act({ deltaX: options.dx, deltaY: options.dy, ref: options.ref, type: "scroll" })
  }

  async #act(action: McpAppAction): Promise<ActionResponse> {
    const response = await call<ActionResponse>({ action, appId: this.id, op: "mcpapps.act" })
    if (response.notice) writeText(response.notice)
    return response
  }
}

export const createMcpAppsApi = (history: SnapshotHistory, docs: Documentation) => {
  const list = () => call<McpAppInfo[]>({ op: "mcpapps.list" })
  return {
    async list(options: EmitOption = {}): Promise<McpAppInfo[]> {
      docs.enter("mcpapps")
      const apps = await list()
      if (options.emit !== false) writeText(JSON.stringify(apps))
      return apps
    },

    async get(id: string): Promise<McpAppTab> {
      docs.enter("mcpapps")
      const info = (await list()).find((app) => app.id === id)
      if (!info) throw new Error(`MCP App ${id} is not open in this task. List them again.`)
      const app = new McpAppTab(info, history)
      history.forget(`mcpapp:${id}`)
      await app.snapshot()
      return app
    },
  }
}
