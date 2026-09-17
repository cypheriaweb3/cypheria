import { type ChildProcess, spawn } from "node:child_process"
import { createServer } from "node:net"
import { join } from "node:path"
import type { AgentOpenCodeCallRequest } from "@cypheria/protocol"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"

import type { AgentInstallReceipt } from "./agent-installer.js"
import type { ToolchainManager } from "./toolchain-manager.js"

const reservePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Unable to allocate an OpenCode port"))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })

export class OpenCodeRuntime {
  readonly #cypheriaHome: string
  readonly #toolchains: ToolchainManager
  #baseUrl: string | undefined
  #client: OpencodeClient | undefined
  #process: ChildProcess | undefined

  constructor(options: { cypheriaHome: string; toolchains: ToolchainManager }) {
    this.#cypheriaHome = options.cypheriaHome
    this.#toolchains = options.toolchains
  }

  get running(): boolean {
    return Boolean(this.#process && this.#baseUrl)
  }

  async start(receipt: AgentInstallReceipt): Promise<void> {
    if (this.running) return
    const port = await reservePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const home = join(this.#cypheriaHome, "agents", "opencode", "home")
    const env = this.#toolchains.environment({
      ...receipt.environment,
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_CONFIG_DIR: join(home, "config"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
    })
    const child = spawn(
      receipt.command,
      [
        ...receipt.args.slice(0, receipt.kind === "npx" ? 1 : 0),
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      { env, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    )
    this.#process = child
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16_384)
    })
    child.once("exit", () => {
      if (this.#process === child) {
        this.#process = undefined
        this.#baseUrl = undefined
        this.#client = undefined
      }
    })
    this.#baseUrl = baseUrl
    this.#client = createOpencodeClient({ baseUrl })
    try {
      await this.#waitUntilReady(child)
    } catch (error) {
      child.kill("SIGTERM")
      this.#process = undefined
      this.#baseUrl = undefined
      this.#client = undefined
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${stderr ? `: ${stderr}` : ""}`
      )
    }
  }

  async stop(): Promise<void> {
    const child = this.#process
    this.#process = undefined
    this.#baseUrl = undefined
    this.#client = undefined
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL")
        resolve()
      }, 5_000).unref()
      child.once("exit", () => {
        clearTimeout(timeout)
        resolve()
      })
      child.kill("SIGTERM")
    })
  }

  async call(payload: AgentOpenCodeCallRequest["payload"]): Promise<{
    data?: unknown
    error?: unknown
    headers: Record<string, string>
    ok: boolean
    status: number
  }> {
    if (!this.#baseUrl) throw new Error("OpenCode is not running")
    const [method, path] = payload.operation.split(" ", 2)
    if (!method || !path?.startsWith("/")) throw new Error("Invalid OpenCode operation")
    if (path === "/v2" || path.startsWith("/v2/")) {
      throw new Error("Experimental OpenCode /v2 endpoints are not supported")
    }
    const url = new URL(path, this.#baseUrl)
    for (const [key, value] of Object.entries(payload.query ?? {})) {
      if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item))
      else if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, {
      body: payload.body === undefined ? undefined : JSON.stringify(payload.body),
      headers: payload.headers,
      method,
    })
    const text = await response.text()
    let value: unknown = null
    if (text) {
      try {
        value = JSON.parse(text)
      } catch {
        value = text
      }
    }
    return {
      [response.ok ? "data" : "error"]: value,
      headers: Object.fromEntries(response.headers.entries()),
      ok: response.ok,
      status: response.status,
    }
  }

  async *events(stream: "event" | "global.event"): AsyncGenerator<unknown> {
    if (!this.#client) throw new Error("OpenCode is not running")
    const result =
      stream === "event" ? await this.#client.event.subscribe() : await this.#client.global.event()
    for await (const event of result.stream) yield event
  }

  async #waitUntilReady(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`OpenCode exited with ${child.exitCode}`)
      try {
        const result = await this.#client?.path.get()
        if (result) return
      } catch {
        // The process is still binding its local HTTP listener.
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error("Timed out waiting for OpenCode")
  }
}
