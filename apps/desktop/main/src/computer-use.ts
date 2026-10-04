import { existsSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"

import {
  cuaDriverEndpoint,
  EmbeddedCuaDriverHost,
  resolveCuaDriverBinary,
} from "@cypheria/cua/driver-host"
import {
  ComputerBackend,
  CuaDevice,
  type CuaDeviceContext,
  CuaDriverClient,
  type CuaDriverConnection,
  createAgentBrowserRunner,
  ExternalBrowsersBackend,
  resolveAgentBrowserBinary,
} from "@cypheria/cua/host"
import { desktopCapturer, shell, systemPreferences } from "electron"

import type { ComputerUseStatus } from "../../ipc/src/index.js"

const SUPPORTED: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "linux", "win32"])

const SCREEN_RECORDING_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

export type ComputerUseHostOptions = {
  readonly cypheriaHome: string
  /** Candidate roots of the `cua` package; the first with a package.json wins. */
  readonly roots: readonly string[]
  readonly hostBundleId: string
  /** A private directory for screenshots on their way to the Server. */
  readonly scratchDir: string
}

/**
 * The device side of Computer Use. The Server routes this device's requests through one of its
 * windows, which hands them to `execute`: external browsers through agent-browser, native apps
 * through the cua-driver daemon hosted here. Desktop owns the daemon because on macOS the
 * Accessibility and Screen Recording grants belong to the app that spawns it: started directly
 * from here, the driver acts with Cypheria's grants and never prompts on its own.
 */
export class ComputerUseHost {
  readonly #binary: string | null
  readonly #host: EmbeddedCuaDriverHost | null
  readonly #device: CuaDevice
  readonly #socketPath: string
  #error: string | null = null

  constructor(options: ComputerUseHostOptions) {
    const root =
      options.roots.find((candidate) => existsSync(join(candidate, "package.json"))) ??
      options.roots[0] ??
      ""
    this.#socketPath = cuaDriverEndpoint(options.cypheriaHome)
    this.#binary = SUPPORTED.has(process.platform) ? resolveCuaDriverBinary(root) : null
    this.#host = this.#binary
      ? new EmbeddedCuaDriverHost({
          binary: this.#binary,
          hostBundleId: options.hostBundleId,
          log: (line) => console.info(`[cua-driver] ${line}`),
          onExit: (code, signal) => {
            this.#error = `cua-driver exited (${signal ?? code})`
          },
          socketPath: this.#socketPath,
        })
      : null
    const driver = new CuaDriverClient(() => this.#driverConnection())
    this.#device = new CuaDevice({
      browsers: SUPPORTED.has(process.platform)
        ? new ExternalBrowsersBackend({
            runner: createAgentBrowserRunner(resolveAgentBrowserBinary(root), {
              ...process.env,
              AGENT_BROWSER_NAMESPACE: "cypheria",
            }),
            scratchDir: options.scratchDir,
          })
        : undefined,
      computer: this.#binary
        ? new ComputerBackend((name, args) => driver.callTool(name, args))
        : undefined,
    })
  }

  /** Runs one request the Server routed to this device. */
  execute(request: Record<string, unknown>, context: CuaDeviceContext): Promise<unknown> {
    return this.#device.handle(request, context)
  }

  /**
   * The embedded daemon when it runs, so actions carry Cypheria's grants. Without it, Linux and
   * Windows run `cua-driver mcp` directly, and macOS uses an installed CuaDriver.app.
   */
  #driverConnection(): CuaDriverConnection | null {
    if (!this.#binary) return null
    if (this.#host?.running) {
      return { binary: this.#binary, kind: "embedded", socketPath: this.#socketPath }
    }
    if (process.platform !== "darwin") return { binary: this.#binary, kind: "standalone" }
    return existsSync("/Applications/CuaDriver.app")
      ? { binary: this.#binary, kind: "standalone" }
      : null
  }

  async start(): Promise<void> {
    if (!this.#host) return
    try {
      this.#error = null
      await this.#host.start()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error)
    }
  }

  async stop(): Promise<void> {
    await this.#host?.stop()
  }

  /** macOS caches permission answers per process, so the driver restarts after a change. */
  async restart(): Promise<ComputerUseStatus> {
    await this.#host?.stop()
    await this.start()
    return this.status()
  }

  async requestPermission(
    permission: "accessibility" | "screen-recording"
  ): Promise<ComputerUseStatus> {
    if (process.platform === "darwin") {
      if (permission === "accessibility") {
        systemPreferences.isTrustedAccessibilityClient(true)
      } else if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
        // Attempting a capture registers Cypheria in the Screen Recording list and may prompt;
        // some macOS versions only list it, so open the pane for the person to switch it on.
        await desktopCapturer
          .getSources({ thumbnailSize: { height: 1, width: 1 }, types: ["screen"] })
          .catch(() => [])
        if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
          await shell.openExternal(SCREEN_RECORDING_SETTINGS)
        }
      }
    }
    return this.status()
  }

  status(): ComputerUseStatus {
    const mac = process.platform === "darwin"
    return {
      accessibility: mac ? systemPreferences.isTrustedAccessibilityClient(false) : null,
      deviceName: hostname() || "This computer",
      driver: !SUPPORTED.has(process.platform)
        ? "unsupported"
        : !this.#host
          ? "missing"
          : this.#host.running
            ? "running"
            : "stopped",
      driverError: this.#error,
      screenRecording: mac ? systemPreferences.getMediaAccessStatus("screen") : null,
      surfaces: this.#device.surfaces,
    }
  }
}
