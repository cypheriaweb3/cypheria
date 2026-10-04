import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  cuaDriverEndpoint,
  EmbeddedCuaDriverHost,
  resolveCuaDriverBinary,
} from "@cypheria/cua/driver-host"
import { desktopCapturer, shell, systemPreferences } from "electron"

import type { ComputerUseStatus } from "../../ipc/src/index.js"

const SUPPORTED: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "linux", "win32"])

const SCREEN_RECORDING_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

/**
 * Hosts the cua-driver daemon that the Server uses for native app control. Desktop owns it
 * because on macOS the Accessibility and Screen Recording grants belong to the app that spawns
 * it: started directly from here, the driver acts with Cypheria's grants and never prompts on its
 * own. The Server finds the daemon at the endpoint both derive from the Cypheria home.
 */
export class ComputerUseHost {
  readonly #binary: string | null
  readonly #host: EmbeddedCuaDriverHost | null
  #error: string | null = null

  constructor(options: { cypheriaHome: string; roots: readonly string[]; hostBundleId: string }) {
    const root = options.roots.find((candidate) => existsSync(join(candidate, "package.json")))
    this.#binary = SUPPORTED.has(process.platform)
      ? resolveCuaDriverBinary(root ?? options.roots[0] ?? "")
      : null
    this.#host = this.#binary
      ? new EmbeddedCuaDriverHost({
          binary: this.#binary,
          hostBundleId: options.hostBundleId,
          log: (line) => console.info(`[cua-driver] ${line}`),
          onExit: (code, signal) => {
            this.#error = `cua-driver exited (${signal ?? code})`
          },
          socketPath: cuaDriverEndpoint(options.cypheriaHome),
        })
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
      driver: !SUPPORTED.has(process.platform)
        ? "unsupported"
        : !this.#host
          ? "missing"
          : this.#host.running
            ? "running"
            : "stopped",
      driverError: this.#error,
      screenRecording: mac ? systemPreferences.getMediaAccessStatus("screen") : null,
    }
  }
}
