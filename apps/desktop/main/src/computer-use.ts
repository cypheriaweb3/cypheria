import { existsSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"

import {
  cuaDriverEndpoint,
  EmbeddedCuaDriverHost,
  resolveCuaDriverBinary,
} from "@cypheria/cua/driver-host"
import {
  CdpDrivers,
  type ChromeImplementationType,
  type ChromeLeaseStore,
  ChromeSessions,
  CodexComputerUseBackend,
  type CodexComputerUseDetection,
  ComputerBackend,
  CuaDevice,
  type CuaDeviceContext,
  CuaDriverClient,
  type CuaDriverConnection,
  codexComputerUseLaunch,
  detectCodexComputerUse,
  type NativeAppsBackend,
  SelectedChromeDrivers,
} from "@cypheria/cua/host"
import type { ComputerHostApproval, ComputerHostApprovalDecision } from "@cypheria/protocol"
import { desktopCapturer, shell, systemPreferences } from "electron"

import type {
  ComputerBackend as ComputerBackendName,
  ComputerUseStatus,
} from "../../ipc/src/index.js"
import type { BrowserExtensionService } from "./browser-extension/index.js"

const SUPPORTED: ReadonlySet<NodeJS.Platform> = new Set(["darwin", "linux", "win32"])

const SCREEN_RECORDING_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

export type ComputerUseHostOptions = {
  readonly cypheriaHome: string
  /** Candidate roots of the `cua` package; the first with a package.json wins. */
  readonly roots: readonly string[]
  readonly hostBundleId: string
  /** The `chrome` implementation type this device's settings select; read on every request. */
  readonly chromeImplementationType: () => ChromeImplementationType
  /** Where the Thread-to-tab leases of the person's browsers are kept between restarts. */
  readonly chromeLeases: ChromeLeaseStore
  /** Where browser downloads a model waits for are saved. */
  readonly downloadsDir: () => string
  /** The `x-browser-agent` value for requests from tabs an agent controls. */
  readonly agentHeader: string
  /** The Cypheria extension's connected browser profiles, the `extension` implementation. */
  readonly browserExtension: BrowserExtensionService
  /** The native app backend this device's settings select; read on every request. */
  readonly computerBackend: () => ComputerBackendName
  /**
   * Cypheria's native Codex executable, which sandboxes ChatGPT's runtime; null when this device
   * has none, such as with a remote Server, and ChatGPT's own Codex is used instead.
   */
  readonly codexCli: () => string | null
  /** The Codex home Cypheria manages, which ChatGPT's runtime uses instead of `~/.codex`. */
  readonly codexHome: string
  /** Asks the people in a Thread whether Computer Use may operate an app. */
  readonly requestApproval: (
    approval: ComputerHostApproval
  ) => Promise<ComputerHostApprovalDecision>
}

/** A device request with the command that carries it, which approvals refer to. */
export type ComputerUseContext = CuaDeviceContext & { readonly commandId: string }

/**
 * The device side of Computer Use. The Server routes this device's requests to Electron main's
 * computer host, which hands them to `execute`: the person's Chromium browsers (`chrome`)
 * through the selected implementation type and the shared engine, native apps through the
 * cua-driver daemon hosted here. Desktop owns the daemon because on macOS the
 * Accessibility and Screen Recording grants belong to the app that spawns it: started directly
 * from here, the driver acts with Cypheria's grants and never prompts on its own.
 */
export class ComputerUseHost {
  readonly #binary: string | null
  readonly #host: EmbeddedCuaDriverHost | null
  readonly #device: CuaDevice
  readonly #chrome: SelectedChromeDrivers
  readonly #socketPath: string
  readonly #chromeImplementationType: () => ChromeImplementationType
  readonly #browserExtension: BrowserExtensionService
  readonly #computerBackend: () => ComputerBackendName
  readonly #codexOptions: Pick<ComputerUseHostOptions, "codexCli" | "codexHome">
  readonly #codex: CodexComputerUseBackend | undefined
  #codexDetection: CodexComputerUseDetection | undefined
  /** A failure the runtime reported that keeps it off until the person changes the setting. */
  #codexFailure: string | null = null
  /** The command each Thread is running here, which its app approvals belong to. */
  readonly #commands = new Map<string, string>()
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
    // The settings choose the `chrome` implementation type: browser profiles with the Cypheria
    // extension, or running browsers that allow remote debugging.
    this.#browserExtension = options.browserExtension
    this.#chrome = new SelectedChromeDrivers({
      selected: options.chromeImplementationType,
      sources: SUPPORTED.has(process.platform)
        ? {
            cdp: new CdpDrivers({ downloadsDir: options.downloadsDir }),
            extension: options.browserExtension.drivers,
          }
        : {},
    })
    const drivers = this.#chrome
    const sessions = new ChromeSessions({
      agentHeader: options.agentHeader,
      downloadsDir: options.downloadsDir,
      drivers: () => drivers.drivers(),
      leases: options.chromeLeases,
      platform: process.platform,
    })
    const chrome = () => (drivers.ready ? sessions : undefined)
    const cuaDriver = this.#binary
      ? new ComputerBackend((name, args) => driver.callTool(name, args))
      : undefined
    this.#computerBackend = options.computerBackend
    this.#codexOptions = { codexCli: options.codexCli, codexHome: options.codexHome }
    // ChatGPT's runtime is macOS only; elsewhere the setting stays on cua-driver.
    this.#codex =
      process.platform === "darwin"
        ? new CodexComputerUseBackend({
            approve: async (threadId, request) => {
              const commandId = this.#commands.get(threadId)
              if (!commandId) return "deny"
              if (request.kind === "audio") {
                return options.requestApproval({
                  allowAlways: request.allowAlways,
                  commandId,
                  kind: "audio",
                  risk: request.risk,
                  threadId,
                })
              }
              return options.requestApproval({
                allowAlways: request.allowAlways,
                app: request.app,
                commandId,
                displayName: request.displayName,
                kind: "app",
                risk: request.risk,
                threadId,
                ...(request.subtitle ? { subtitle: request.subtitle } : {}),
              })
            },
            launch: () => {
              const detection = this.#codexDetection
              if (!detection?.available || this.#codexFailure) return null
              return codexComputerUseLaunch(detection.server, {
                codexCli: detection.codexCli,
                codexHome: this.#codexOptions.codexHome,
              })
            },
            log: (line) => console.info(`[codex-computer-use] ${line}`),
            onUnavailable: (reason) => {
              this.#codexFailure = reason
              this.#codex?.dispose()
            },
            serviceApp: () =>
              this.#codexDetection?.available ? this.#codexDetection.serviceApp : null,
          })
        : undefined
    const computer = (): NativeAppsBackend | undefined => {
      if (this.#computerBackend() !== "codex") return cuaDriver
      return this.#codexDetection?.available && !this.#codexFailure ? this.#codex : undefined
    }
    this.#device = new CuaDevice({ chrome, computer })
    this.#chromeImplementationType = options.chromeImplementationType
  }

  /** Runs one request the Server routed to this device. */
  async execute(request: Record<string, unknown>, context: ComputerUseContext): Promise<unknown> {
    this.#commands.set(context.threadId, context.commandId)
    try {
      return await this.#device.handle(request, context)
    } finally {
      if (this.#commands.get(context.threadId) === context.commandId) {
        this.#commands.delete(context.threadId)
      }
    }
  }

  /** Looks for ChatGPT's Computer Use runtime again, such as after the person installs it. */
  async detectCodex(): Promise<void> {
    if (!this.#codex) return
    this.#codexDetection = await detectCodexComputerUse({ codexCli: this.#codexOptions.codexCli() })
  }

  /** Applies a new native app backend choice: the old backend's runtimes stop. */
  async computerBackendChanged(): Promise<void> {
    this.#codexFailure = null
    if (this.#computerBackend() === "codex") await this.detectCodex()
    else this.#codex?.dispose()
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
    await this.#browserExtension.start()
    await this.detectCodex().catch(() => undefined)
    if (!this.#host) return
    try {
      this.#error = null
      await this.#host.start()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error)
    }
  }

  async stop(): Promise<void> {
    this.#chrome.dispose()
    this.#codex?.dispose()
    await this.#browserExtension.stop()
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
      capabilities: this.#device.capabilities,
      chromeImplementationType: {
        available: this.#chrome.available,
        selected: this.#chromeImplementationType(),
      },
      browserExtension: this.#browserExtension.status(),
      computerBackend: {
        available: [
          ...(this.#binary ? (["cua-driver"] as const) : []),
          ...(this.#codexDetection?.available ? (["codex"] as const) : []),
        ],
        codex: !this.#codex
          ? null
          : {
              serviceApp: this.#codexDetection?.available ? this.#codexDetection.serviceApp : null,
              unavailableReason:
                this.#codexFailure ??
                (this.#codexDetection === undefined
                  ? "Looking for ChatGPT…"
                  : this.#codexDetection.available
                    ? null
                    : this.#codexDetection.reason),
              version: this.#codexDetection?.version ?? null,
            },
        selected: this.#computerBackend(),
      },
    }
  }
}
