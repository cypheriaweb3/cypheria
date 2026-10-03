import { chmodSync, rmSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import type { Logger } from "pino"

import type { BrowserToolsService } from "../browser-tools/service.js"
import { apiManifest } from "./api-manifest.js"

export const DEFAULT_DISABLED_MEMBER_IDS = [
  "Agent.documentation",
  "Documentation.get",
  "Browsers.getForUrl",
  "Browser.user",
  "Browser.history",
  "Browser.nameSession",
  "Tabs.content",
  "Tab.ax",
  "Tab.cua",
  "Tab.dom_cua",
  "Tab.clipboard",
  "Tab.content",
  "Tab.dev",
]

export type NodeReplHostServiceOptions = {
  readonly browserTools: BrowserToolsService
  readonly pipePath?: string
  readonly threadId?: string
  readonly cwd?: string
  readonly logger?: Logger
}

type RpcRequest = {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params?: unknown
}

type RpcResponse = {
  jsonrpc: "2.0"
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * Host services server listening on a Unix domain socket or Windows named pipe,
 * providing browser, chrome, and computer use (sky) RPC services to node_repl.
 */
export class NodeReplHostService {
  readonly pipePath: string
  readonly #server: Server
  readonly #browserTools: BrowserToolsService
  readonly #threadId?: string
  readonly #cwd?: string
  readonly #logger?: Logger
  readonly #sockets = new Set<Socket>()
  #listening = false

  constructor(options: NodeReplHostServiceOptions) {
    this.#browserTools = options.browserTools
    this.#threadId = options.threadId
    this.#cwd = options.cwd
    this.#logger = options.logger

    if (options.pipePath) {
      this.pipePath = options.pipePath
    } else {
      const id = options.threadId ?? `host-${Date.now().toString(16)}`
      this.pipePath =
        process.platform === "win32"
          ? `\\\\.\\pipe\\cypheria-node-repl-${id}`
          : join(tmpdir(), `cypheria-node-repl-${id}.sock`)
    }

    this.#server = createServer((socket) => this.#handleConnection(socket))
  }

  async start(): Promise<string> {
    if (this.#listening) return this.pipePath

    if (process.platform !== "win32") {
      try {
        rmSync(this.pipePath, { force: true })
      } catch {
        // Ignore removal failure of non-existent socket
      }
    }

    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject)
      this.#server.listen(this.pipePath, () => {
        this.#server.removeListener("error", reject)
        if (process.platform !== "win32") {
          try {
            chmodSync(this.pipePath, 0o600)
          } catch {
            // Best effort file permission tightening
          }
        }
        this.#listening = true
        this.#logger?.info?.({ pipePath: this.pipePath }, "node_repl host services listening")
        resolve()
      })
    })

    return this.pipePath
  }

  async close(): Promise<void> {
    if (!this.#listening) return
    this.#listening = false

    for (const socket of this.#sockets) {
      socket.destroy()
    }
    this.#sockets.clear()

    await new Promise<void>((resolve) => {
      this.#server.close(() => resolve())
    })

    if (process.platform !== "win32") {
      try {
        rmSync(this.pipePath, { force: true })
      } catch {
        // Ignore error
      }
    }
  }

  #handleConnection(socket: Socket): void {
    this.#sockets.add(socket)
    socket.once("close", () => {
      this.#sockets.delete(socket)
    })

    const lines = createInterface({ input: socket })
    lines.on("line", async (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const req = JSON.parse(trimmed) as RpcRequest
        const resp = await this.#dispatch(req)
        if (resp && !socket.destroyed) {
          socket.write(`${JSON.stringify(resp)}\n`)
        }
      } catch {
        if (!socket.destroyed) {
          socket.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            })}\n`
          )
        }
      }
    })
  }

  async #dispatch(req: RpcRequest): Promise<RpcResponse | null> {
    if (req.id === undefined || req.id === null) {
      // Notification
      return null
    }

    try {
      switch (req.method) {
        case "ensureService":
          return { jsonrpc: "2.0", id: req.id, result: { ok: true } }

        case "browser":
          return {
            jsonrpc: "2.0",
            id: req.id,
            result: await this.#handleBrowser(req.params),
          }

        case "chrome":
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: {
              code: -32601,
              message: "Chrome extension browser service is a placeholder and not yet implemented",
            },
          }

        case "sky":
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: {
              code: -32601,
              message: "Computer use (sky) service is a placeholder and not yet implemented",
            },
          }

        default:
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: {
              code: -32601,
              message: `Unsupported host service: ${req.method}`,
            },
          }
      }
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  async #handleBrowser(params: unknown): Promise<unknown> {
    const payload = (params ?? {}) as { method?: string; params?: unknown }
    const method = payload.method ?? "execute"
    const commandPayload = payload.params ?? payload

    switch (method) {
      case "setup":
        return {
          apiManifest,
          disabledMemberIds: DEFAULT_DISABLED_MEMBER_IDS,
          credentialRecoveryErrorVersion: 1,
        }

      case "execute":
        return await this.#executeBrowserCommand(commandPayload)

      case "executeWithRecovery": {
        try {
          const value = await this.#executeBrowserCommand(commandPayload)
          return { ok: true, value }
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }

      default:
        throw new Error(`Unsupported browser service method: ${method}`)
    }
  }

  async #executeBrowserCommand(cmdObj: unknown): Promise<unknown> {
    const cmd = (cmdObj ?? {}) as Record<string, unknown>
    const type = String(cmd.type ?? cmd.command ?? "")

    switch (type) {
      case "list_browsers":
        return [{ id: "iab", name: "In-App Browser", type: "iab", family: "iab" }]

      case "get_browser":
      case "get_default_browser":
      case "get_browser_for_url":
        return {
          id: "iab",
          name: "In-App Browser",
          type: "iab",
          family: "iab",
          capabilities: { browser: [], tab: [] },
        }

      case "create_tab": {
        const outcome = await this.#browserTools.execute({
          command: { args: {}, command: "new_tab" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        if (outcome.result.command !== "new_tab") throw new Error("Unexpected result for new_tab")
        const res = outcome.result
        return {
          id: res.browserId,
          browser_id: "iab",
          title: "",
          url: res.url,
        }
      }

      case "list_tabs": {
        const outcome = await this.#browserTools.execute({
          command: { args: {}, command: "list_tabs" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        if (outcome.result.command !== "list_tabs")
          throw new Error("Unexpected result for list_tabs")
        return {
          tabs: outcome.result.tabs.map((t) => ({
            id: t.browserId,
            browser_id: "iab",
            title: t.title,
            url: t.url,
          })),
        }
      }

      case "selected_tab": {
        const outcome = await this.#browserTools.execute({
          command: { args: {}, command: "list_tabs" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        if (outcome.result.command !== "list_tabs")
          throw new Error("Unexpected result for list_tabs")
        const first = outcome.result.tabs[0]
        return first
          ? { id: first.browserId, browser_id: "iab", title: first.title, url: first.url }
          : {}
      }

      case "get_tab":
        return {
          id: String(cmd.tab_id ?? ""),
          browser_id: String(cmd.browser_id ?? "iab"),
        }

      case "close_tab": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId }, command: "close_tab" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "navigate_tab_url": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const url = String(cmd.url ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId, url }, command: "navigate" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "navigate_tab_back": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId }, command: "back" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "navigate_tab_forward": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId }, command: "forward" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "navigate_tab_reload": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId }, command: "reload" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "tab_screenshot": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const fullPage = Boolean(cmd.full_page)
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId, fullPage }, command: "screenshot" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        if (outcome.result.command !== "screenshot")
          throw new Error("Unexpected result for screenshot")
        return { data: outcome.result.dataBase64 }
      }

      case "playwright_dom_snapshot": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId }, command: "snapshot" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        if (outcome.result.command !== "snapshot") throw new Error("Unexpected result for snapshot")
        return { dom_snapshot: outcome.result.snapshot }
      }

      case "playwright_locator_click": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const selector = typeof cmd.selector === "string" ? cmd.selector : undefined
        const ref = typeof cmd.ref === "string" ? cmd.ref : undefined
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId, ref, selector }, command: "click" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "playwright_locator_fill": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const selector = typeof cmd.selector === "string" ? cmd.selector : undefined
        const ref = typeof cmd.ref === "string" ? cmd.ref : undefined
        const value = String(cmd.value ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId, ref, selector, value }, command: "fill" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "playwright_locator_type": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const selector = typeof cmd.selector === "string" ? cmd.selector : undefined
        const ref = typeof cmd.ref === "string" ? cmd.ref : undefined
        const text = String(cmd.text ?? cmd.value ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId, ref, selector, text }, command: "type" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "playwright_locator_press": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const key = String(cmd.value ?? cmd.key ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId, key }, command: "keypress" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "playwright_evaluate": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const expr = String(cmd.expression ?? cmd.fn ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId, function: expr }, command: "evaluate" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        if (outcome.result.command !== "evaluate") throw new Error("Unexpected result for evaluate")
        const parsed = outcome.result.resultJson ? JSON.parse(outcome.result.resultJson) : null
        return { value: parsed }
      }

      case "mark_tab": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const status = String(cmd.status ?? "deliverable")
        const command = status === "handoff" ? "mark_handoff" : "mark_deliverable"
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId }, command },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "tab_manual_handoff_request": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const reason = String(cmd.reason ?? "Manual user action required")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId, reason }, command: "request_manual_handoff" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return {}
      }

      case "scan_qr": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId }, command: "scan_qr" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return outcome.result
      }

      case "extract_assets": {
        const browserId = String(cmd.tab_id ?? cmd.browserId ?? "")
        const outcome = await this.#browserTools.execute({
          command: { args: { browserId }, command: "extract_assets" },
          cwd: this.#cwd,
          threadId: this.#threadId,
        })
        if (!outcome.ok) throw new Error(outcome.error.message)
        return outcome.result
      }

      default: {
        // Fallback for native Cypheria browser commands
        if (typeof cmd.command === "string") {
          const outcome = await this.#browserTools.execute({
            command: cmd as never,
            cwd: this.#cwd,
            threadId: this.#threadId,
          })
          if (!outcome.ok) throw new Error(outcome.error.message)
          return outcome.result
        }
        throw new Error(`Unsupported browser automation command: ${type}`)
      }
    }
  }
}
