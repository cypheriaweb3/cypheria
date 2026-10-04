import { CuaDeviceRequestSchema, type ParsedCuaDeviceRequest } from "../protocol.ts"
import type { ComputerBackend } from "./computer/backend.ts"
import { CuaHostError } from "./errors.ts"
import type { ExternalBrowsersBackend } from "./external/backend.ts"

/** The Thread a device request runs for, as the Server stated it. */
export type CuaDeviceContext = { readonly threadId: string; readonly cwd?: string }

export type CuaDeviceOptions = {
  /** The person's external browsers on this device; absent when agent-browser is missing. */
  readonly browsers?: ExternalBrowsersBackend
  /** Native apps on this device; absent where cua-driver is unsupported or missing. */
  readonly computer?: ComputerBackend
}

/**
 * The device side of Computer Use: it runs on the client that hosts the person's browsers and
 * apps, executing what the Server routed to it. The Server owns policy and audit; this side
 * re-validates every request and keeps per-Thread state, such as tabs a Thread opened.
 */
export class CuaDevice {
  readonly #options: CuaDeviceOptions

  constructor(options: CuaDeviceOptions) {
    this.#options = options
  }

  /** Whether this device can act on its external browsers and its native apps. */
  get surfaces(): { readonly browsers: boolean; readonly computer: boolean } {
    return { browsers: this.#options.browsers !== undefined, computer: !!this.#options.computer }
  }

  async handle(input: unknown, context: CuaDeviceContext): Promise<unknown> {
    const parsed = CuaDeviceRequestSchema.safeParse(input)
    if (!parsed.success) {
      throw new CuaHostError(
        "invalid",
        `Invalid device request: ${parsed.error.issues[0]?.message ?? "malformed"}`
      )
    }
    return this.#dispatch(parsed.data, context)
  }

  async #dispatch(request: ParsedCuaDeviceRequest, context: CuaDeviceContext): Promise<unknown> {
    const { threadId } = context
    switch (request.op) {
      case "device.turnEnded":
        await this.#options.browsers?.turnEnded(threadId)
        return null
      case "device.closeThread":
        this.#options.browsers?.closeThread(threadId)
        this.#options.computer?.closeThread(threadId)
        return null
      case "apps.list":
        return this.#computer().listApps(threadId)
      case "apps.windows":
        return this.#computer().listWindows(threadId, request.pid)
      case "apps.get":
        return this.#computer().getApp(threadId, request.app)
      case "apps.observe":
        return this.#computer().observe(threadId, request.handle, request)
      case "apps.act":
        return this.#computer().act(threadId, request.handle, request.action)
      case "browsers.list":
        return this.#browsers().list()
      case "browsers.tabs":
        return this.#browsers().tabs(threadId, request.browserId)
      case "browsers.new":
        return this.#browsers().newTab(threadId, request.browserId, request.url)
      case "browsers.claim":
        return this.#browsers().claim(threadId, request.browserId, request.tabId)
      case "browsers.act":
        return this.#browsers().act(
          threadId,
          request.browserId,
          request.tabId,
          request.action,
          context.cwd
        )
    }
  }

  #browsers(): ExternalBrowsersBackend {
    if (!this.#options.browsers) {
      throw new CuaHostError(
        "unavailable",
        "External browser control is unavailable on this device."
      )
    }
    return this.#options.browsers
  }

  #computer(): ComputerBackend {
    if (!this.#options.computer) {
      throw new CuaHostError("unavailable", "Native app control is unavailable on this device.")
    }
    return this.#options.computer
  }
}
