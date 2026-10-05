import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createInterface } from "node:readline"

import { CuaHostError } from "../errors.ts"
import type { ToolResult } from "./cua-driver.ts"

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

export type McpLaunch = {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly cwd?: string
}

export type McpStdioClientOptions = {
  readonly launch: McpLaunch
  /** Answers the server's requests, such as `elicitation/create`. */
  readonly onRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  readonly onStderr?: (line: string) => void
  readonly spawn?: typeof spawn
}

/**
 * A Model Context Protocol client over a child process's standard input and output, which
 * answers the server's own requests. A call in flight when the process exits fails rather than
 * being replayed, so an action whose completion is unknown never repeats.
 */
export class McpStdioClient {
  readonly #options: McpStdioClientOptions
  #child: ChildProcessWithoutNullStreams | null = null
  #ready: Promise<void> | null = null
  #nextId = 0
  readonly #pending = new Map<number, Pending>()

  constructor(options: McpStdioClientOptions) {
    this.#options = options
  }

  get running(): boolean {
    return this.#child !== null
  }

  start(): Promise<void> {
    if (this.#ready) return this.#ready
    const { launch } = this.#options
    const child = (this.#options.spawn ?? spawn)(launch.command, [...launch.args], {
      env: { ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
    }) as ChildProcessWithoutNullStreams
    this.#child = child
    createInterface({ input: child.stdout }).on("line", (line) => this.#receive(line))
    createInterface({ input: child.stderr }).on("line", (line) => this.#options.onStderr?.(line))
    child.once("exit", (code, signal) => {
      if (this.#child === child) {
        this.#child = null
        this.#ready = null
      }
      for (const pending of this.#pending.values()) {
        pending.reject(
          new CuaHostError(
            "computer_unavailable",
            "The computer-use runtime stopped; observe the app again before retrying."
          )
        )
      }
      this.#pending.clear()
      this.#options.onExit?.(code, signal)
    })
    child.once("error", () => undefined)
    this.#ready = this.#request(
      "initialize",
      {
        capabilities: { elicitation: {} },
        clientInfo: { name: "cypheria", version: "0.1.0" },
        protocolVersion: "2025-06-18",
      },
      120_000
    ).then(() => {
      this.#send({ jsonrpc: "2.0", method: "notifications/initialized" })
    })
    this.#ready.catch(() => this.close())
    return this.#ready
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { readonly meta?: Record<string, unknown>; readonly timeoutMs?: number } = {}
  ): Promise<ToolResult> {
    await this.start()
    return (await this.#request(
      "tools/call",
      { arguments: args, name, ...(options.meta ? { _meta: options.meta } : {}) },
      options.timeoutMs ?? 120_000
    )) as ToolResult
  }

  close(): void {
    this.#child?.stdin.end()
    this.#child?.kill()
    this.#child = null
    this.#ready = null
  }

  #request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.#child) {
      return Promise.reject(
        new CuaHostError("computer_unavailable", "The computer-use runtime is not running.")
      )
    }
    const id = ++this.#nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(
          new CuaHostError(
            "timeout",
            `The computer-use runtime did not answer ${method} in time; observe again before retrying.`
          )
        )
      }, timeoutMs)
      this.#pending.set(id, {
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
      })
      this.#send({ id, jsonrpc: "2.0", method, params })
    })
  }

  #send(message: unknown): void {
    this.#child?.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #receive(line: string): void {
    let message: {
      id?: number | string
      method?: string
      params?: Record<string, unknown>
      result?: unknown
      error?: { message?: string }
    }
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.method !== undefined) {
      if (message.id === undefined) return
      const id = message.id
      const handler = this.#options.onRequest
      void (async () => {
        try {
          if (!handler) throw new Error(`Unsupported request ${message.method}.`)
          const result = await handler(message.method ?? "", message.params ?? {})
          this.#send({ id, jsonrpc: "2.0", result })
        } catch (error) {
          this.#send({
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : String(error),
            },
            id,
            jsonrpc: "2.0",
          })
        }
      })()
      return
    }
    if (typeof message.id !== "number") return
    const pending = this.#pending.get(message.id)
    if (!pending) return
    this.#pending.delete(message.id)
    if (message.error) {
      pending.reject(
        new CuaHostError("computer_error", message.error.message ?? "computer-use runtime error")
      )
    } else {
      pending.resolve(message.result)
    }
  }
}
