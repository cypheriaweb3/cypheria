import { chmodSync, rmSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { CUA_SERVICE } from "@cypheria/cua"
import type { CuaHost } from "@cypheria/cua/host"
import type { Logger } from "pino"

export type NodeReplHostServiceOptions = {
  readonly cua: Pick<CuaHost, "handle">
  readonly threadId: string
  readonly pipePath?: string
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
  error?: { code: number; message: string }
}

/** A short per-Thread socket path: Unix socket paths are limited to about 100 bytes. */
export const hostServicePipePath = (threadId: string): string =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\cypheria-cua-${threadId}`
    : join(tmpdir(), `cypheria-cua-${threadId.replaceAll("-", "").slice(-16)}.sock`)

/**
 * The host services socket of one Thread's `cua_repl`. Model code reaches it through
 * `nodeRepl.rpc`, so every request is validated and scoped to this Thread by the `cua` host.
 */
export class NodeReplHostService {
  readonly pipePath: string
  readonly #server: Server
  readonly #cua: Pick<CuaHost, "handle">
  readonly #threadId: string
  readonly #cwd?: string
  readonly #logger?: Logger
  readonly #sockets = new Set<Socket>()
  #listening: Promise<string> | null = null

  constructor(options: NodeReplHostServiceOptions) {
    this.#cua = options.cua
    this.#threadId = options.threadId
    this.#cwd = options.cwd
    this.#logger = options.logger
    this.pipePath = options.pipePath ?? hostServicePipePath(options.threadId)
    this.#server = createServer((socket) => this.#handleConnection(socket))
  }

  start(): Promise<string> {
    this.#listening ??= new Promise((resolve, reject) => {
      if (process.platform !== "win32") rmSync(this.pipePath, { force: true })
      this.#server.once("error", reject)
      this.#server.listen(this.pipePath, () => {
        this.#server.removeListener("error", reject)
        if (process.platform !== "win32") {
          try {
            chmodSync(this.pipePath, 0o600)
          } catch {
            // Best-effort tightening; the socket lives in the user's temporary directory.
          }
        }
        this.#logger?.info?.({ pipePath: this.pipePath }, "cua host services listening")
        resolve(this.pipePath)
      })
    })
    return this.#listening
  }

  async close(): Promise<void> {
    if (!this.#listening) return
    this.#listening = null
    for (const socket of this.#sockets) socket.destroy()
    this.#sockets.clear()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
    if (process.platform !== "win32") rmSync(this.pipePath, { force: true })
  }

  #handleConnection(socket: Socket): void {
    this.#sockets.add(socket)
    socket.once("close", () => this.#sockets.delete(socket))
    createInterface({ input: socket }).on("line", async (line) => {
      if (!line.trim()) return
      let request: RpcRequest
      try {
        request = JSON.parse(line) as RpcRequest
      } catch {
        if (!socket.destroyed) {
          socket.write(
            `${JSON.stringify({ error: { code: -32700, message: "Parse error" }, id: null, jsonrpc: "2.0" })}\n`
          )
        }
        return
      }
      const response = await this.#dispatch(request)
      if (response && !socket.destroyed) socket.write(`${JSON.stringify(response)}\n`)
    })
  }

  async #dispatch(request: RpcRequest): Promise<RpcResponse | null> {
    if (request.id === undefined || request.id === null) return null
    if (request.method !== CUA_SERVICE) {
      return {
        error: { code: -32601, message: `Unsupported host service: ${request.method}` },
        id: request.id,
        jsonrpc: "2.0",
      }
    }
    try {
      const result = await this.#cua.handle(request.params, {
        threadId: this.#threadId,
        ...(this.#cwd ? { cwd: this.#cwd } : {}),
      })
      return { id: request.id, jsonrpc: "2.0", result: result ?? null }
    } catch (error) {
      return {
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        id: request.id,
        jsonrpc: "2.0",
      }
    }
  }
}
