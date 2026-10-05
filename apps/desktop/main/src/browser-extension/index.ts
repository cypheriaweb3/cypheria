import { existsSync } from "node:fs"

import { EXTENSION_IDS } from "@cypheria/browser-extension/protocol"
import { BROWSER_FAMILY_INFO, isBrowserFamily } from "@cypheria/cua"

import type { BrowserExtensionStatus } from "../../../ipc/src/index.js"
import { ExtensionDrivers } from "./drivers.js"
import { ExtensionEndpoint } from "./endpoint.js"
import { installNativeHost, type NativeHostInstallation } from "./install.js"

export { ExtensionDrivers } from "./drivers.js"

export type BrowserExtensionServiceOptions = {
  readonly cypheriaHome: string
  readonly desktopVersion: string
  /** Candidate host binaries this build ships; the first that exists is installed. */
  readonly hostBinaries: readonly string[]
  /** Candidate unpacked extension directories for development builds. */
  readonly unpackedExtensions: readonly string[]
  /** Called when a browser profile connects or disconnects. */
  readonly onChange?: () => void
}

/**
 * The Cypheria extension's side of Desktop: the native host installation, the endpoint the host
 * connects to, and the connected browser profiles as `chrome` drivers.
 */
export class BrowserExtensionService {
  readonly #options: BrowserExtensionServiceOptions
  readonly #endpoint: ExtensionEndpoint
  readonly drivers: ExtensionDrivers
  #installation: NativeHostInstallation | undefined
  #error: string | null = null

  constructor(options: BrowserExtensionServiceOptions) {
    this.#options = options
    this.#endpoint = new ExtensionEndpoint({
      cypheriaHome: options.cypheriaHome,
      desktopVersion: options.desktopVersion,
      log: (line) => console.info(`[browser-extension] ${line}`),
      ...(options.onChange ? { onChange: options.onChange } : {}),
    })
    this.drivers = new ExtensionDrivers(() => this.#endpoint.sessions)
  }

  async start(): Promise<void> {
    try {
      await this.#endpoint.start()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error)
    }
    this.#installation = await installNativeHost({
      cypheriaHome: this.#options.cypheriaHome,
      source: this.#options.hostBinaries.find((path) => existsSync(path)) ?? null,
    })
    for (const error of this.#installation.errors) console.warn(`[browser-extension] ${error}`)
  }

  stop(): Promise<void> {
    return this.#endpoint.stop()
  }

  status(): BrowserExtensionStatus {
    const installation = this.#installation
    return {
      browsers: this.#endpoint.sessions.flatMap((session) => {
        const info = session.info
        if (!info) return []
        return [
          {
            extensionVersion: info.extensionVersion,
            family: info.family,
            name: isBrowserFamily(info.family)
              ? BROWSER_FAMILY_INFO[info.family].displayName
              : info.family,
          },
        ]
      }),
      endpointError: this.#error,
      extensionIds: [...EXTENSION_IDS],
      host: !installation ? "pending" : installation.binary ? "installed" : "missing",
      hostErrors: [...(installation?.errors ?? [])],
      registeredBrowsers: [...(installation?.manifests ?? [])],
      unpackedPath: this.#options.unpackedExtensions.find((path) => existsSync(path)) ?? null,
    }
  }
}
