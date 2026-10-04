import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"

import { CuaHostError } from "../errors.ts"

/** The environment every cua-driver process Cypheria starts receives. */
export const CUA_DRIVER_QUIET_ENV = {
  CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
  CUA_DRIVER_RS_UPDATE_CHECK: "false",
  DO_NOT_TRACK: "1",
} as const

/**
 * Finds a cua-driver executable: `CYPHERIA_CUA_DRIVER_PATH`, the copy a build places in the cua
 * root's `bin/`, the release fetched into `vendor/`, an installed CuaDriver.app, then `PATH`.
 */
export const resolveCuaDriverBinary = (
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null => {
  const exe = platform === "win32" ? ".exe" : ""
  const candidates = [
    env.CYPHERIA_CUA_DRIVER_PATH,
    join(root, "bin", `cua-driver${exe}`),
    join(root, "vendor", "cua-driver", `cua-driver${exe}`),
    platform === "darwin" ? "/Applications/CuaDriver.app/Contents/MacOS/cua-driver" : undefined,
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

/** How the Server reaches a cua-driver runtime. */
export type CuaDriverConnection =
  /** The private daemon Desktop hosts so macOS grants belong to Cypheria. */
  | { readonly kind: "embedded"; readonly binary: string; readonly socketPath: string }
  /** `cua-driver mcp`: on macOS it proxies to an installed CuaDriver.app; elsewhere it owns the runtime. */
  | { readonly kind: "standalone"; readonly binary: string }

export type ToolResult = {
  readonly content: readonly { type: string; text?: string; data?: string; mimeType?: string }[]
  readonly structuredContent?: Record<string, unknown>
  readonly isError?: boolean
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

/**
 * A Model Context Protocol client of `cua-driver mcp`. The proxy process is started on first use
 * and again after it exits; a call in flight when it exits fails rather than being replayed, so
 * an action whose completion is unknown is never repeated.
 */
export class CuaDriverClient {
  readonly #connection: () => CuaDriverConnection | null
  #child: ChildProcessWithoutNullStreams | null = null
  #ready: Promise<void> | null = null
  #nextId = 0
  readonly #pending = new Map<number, Pending>()

  constructor(connection: () => CuaDriverConnection | null) {
    this.#connection = connection
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 60_000
  ): Promise<ToolResult> {
    await this.#start()
    const result = (await this.#request(
      "tools/call",
      { arguments: args, name },
      timeoutMs
    )) as ToolResult
    return result
  }

  close(): void {
    this.#child?.kill()
    this.#child = null
    this.#ready = null
  }

  #start(): Promise<void> {
    if (this.#ready) return this.#ready
    const connection = this.#connection()
    if (!connection) {
      return Promise.reject(
        new CuaHostError(
          "computer_unavailable",
          "Native app control is unavailable: Cypheria Desktop is not running its computer-use service. Ask the user to open Cypheria Desktop and enable Computer Use."
        )
      )
    }
    const args =
      connection.kind === "embedded"
        ? ["mcp", "--embedded", "--socket", connection.socketPath]
        : ["mcp"]
    const child = spawn(connection.binary, args, {
      env: {
        ...process.env,
        ...CUA_DRIVER_QUIET_ENV,
        ...(connection.kind === "embedded" ? { CUA_DRIVER_EMBEDDED: "1" } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#child = child
    createInterface({ input: child.stdout }).on("line", (line) => this.#receive(line))
    child.stderr.resume()
    child.once("exit", () => {
      if (this.#child === child) {
        this.#child = null
        this.#ready = null
      }
      for (const pending of this.#pending.values()) {
        pending.reject(
          new CuaHostError(
            "computer_unavailable",
            "The computer-use service stopped; observe the app again before retrying."
          )
        )
      }
      this.#pending.clear()
    })
    child.once("error", () => undefined)
    this.#ready = this.#request(
      "initialize",
      {
        capabilities: {},
        clientInfo: { name: "cypheria", version: "0.1.0" },
        protocolVersion: "2025-06-18",
      },
      30_000
    ).then(() => {
      this.#notify("notifications/initialized")
    })
    this.#ready.catch(() => this.close())
    return this.#ready
  }

  #request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.#child
    if (!child)
      return Promise.reject(
        new CuaHostError("computer_unavailable", "The computer-use service is not running.")
      )
    const id = ++this.#nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(
          new CuaHostError(
            "timeout",
            `The computer-use service did not answer ${method} in time; observe again before retrying.`
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
      child.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`)
    })
  }

  #notify(method: string): void {
    this.#child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`)
  }

  #receive(line: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } }
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (typeof message.id !== "number") return
    const pending = this.#pending.get(message.id)
    if (!pending) return
    this.#pending.delete(message.id)
    if (message.error)
      pending.reject(
        new CuaHostError("computer_error", message.error.message ?? "cua-driver error")
      )
    else pending.resolve(message.result)
  }
}
