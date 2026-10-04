import { type ChildProcess, spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { connect } from "node:net"
import { dirname } from "node:path"

import { CUA_DRIVER_QUIET_ENV } from "../host/computer/cua-driver.ts"

export { cuaDriverEndpoint } from "../endpoint.ts"
export { resolveCuaDriverBinary } from "../host/computer/cua-driver.ts"

export type EmbeddedCuaDriverHostOptions = {
  readonly binary: string
  readonly socketPath: string
  /** The host app's bundle identifier, echoed in cua-driver diagnostics. */
  readonly hostBundleId: string
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  readonly log?: (line: string) => void
}

const canConnect = (socketPath: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect(socketPath)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })

/**
 * Hosts a private `cua-driver serve --embedded` daemon for the Server to connect to. It must be
 * started by the app that holds the macOS Accessibility and Screen Recording grants: spawning it
 * directly keeps it in the app's responsibility chain, so the grants apply and the driver never
 * shows its own permission prompts. Launching it through `open` or a separate gateway would not.
 */
export class EmbeddedCuaDriverHost {
  readonly #options: EmbeddedCuaDriverHostOptions
  #child: ChildProcess | null = null
  #starting: Promise<void> | null = null

  constructor(options: EmbeddedCuaDriverHostOptions) {
    this.#options = options
  }

  get running(): boolean {
    return this.#child !== null
  }

  get socketPath(): string {
    return this.#options.socketPath
  }

  start(): Promise<void> {
    if (this.#child) return Promise.resolve()
    this.#starting ??= this.#spawn().finally(() => {
      this.#starting = null
    })
    return this.#starting
  }

  async stop(): Promise<void> {
    const child = this.#child
    this.#child = null
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve))
      child.kill("SIGTERM")
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))])
      if (child.exitCode === null) child.kill("SIGKILL")
    }
    this.#removeSocket()
  }

  /** Restarts the daemon, which macOS needs to see permission changes. */
  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async #spawn(): Promise<void> {
    const { binary, hostBundleId, socketPath } = this.#options
    if (process.platform !== "win32") {
      mkdirSync(dirname(socketPath), { mode: 0o700, recursive: true })
      try {
        chmodSync(dirname(socketPath), 0o700)
      } catch {
        // A shared temporary directory keeps its own permissions; the socket itself is private.
      }
    }
    if (await canConnect(socketPath)) {
      throw new Error(`Another cua-driver daemon already listens on ${socketPath}`)
    }
    this.#removeSocket()
    const child = spawn(binary, ["serve", "--embedded", "--socket", socketPath], {
      env: {
        ...process.env,
        ...CUA_DRIVER_QUIET_ENV,
        CUA_DRIVER_EMBEDDED: "1",
        CUA_DRIVER_HOST_BUNDLE_ID: hostBundleId,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#child = child
    const log = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) this.#options.log?.(line)
    }
    child.stdout?.on("data", log)
    child.stderr?.on("data", log)
    child.once("exit", (code, signal) => {
      if (this.#child === child) {
        this.#child = null
        this.#removeSocket()
        this.#options.onExit?.(code, signal)
      }
    })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (this.#child !== child) throw new Error("cua-driver exited before it was ready")
      if (await canConnect(socketPath)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await this.stop()
    throw new Error(`cua-driver did not open ${socketPath}`)
  }

  #removeSocket(): void {
    if (process.platform !== "win32" && existsSync(this.#options.socketPath)) {
      rmSync(this.#options.socketPath, { force: true })
    }
  }
}
