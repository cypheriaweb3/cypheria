import {
  CYPHERIA_DAPP_BROWSER_PARTITION,
  CYPHERIA_WEB_BROWSER_PARTITION,
} from "../../../ipc/src/browser-channels.js"
import type { BrowserClearData } from "../../../ipc/src/index.js"
import { installThirdPartyCookieFilter } from "./third-party-cookies.js"

export type BrowserProfileKind = "web" | "dapp"

const STORAGE_TYPES = [
  "cookies",
  "filesystem",
  "indexdb",
  "localstorage",
  "serviceworkers",
  "cachestorage",
  "shadercache",
] as const

type ProfileSession = {
  clearAuthCache(): Promise<void>
  clearCache(): Promise<void>
  clearStorageData(options: {
    origin?: string
    storages: Array<(typeof STORAGE_TYPES)[number]>
  }): Promise<void>
  setPermissionCheckHandler(handler: () => boolean): void
  setPermissionRequestHandler(
    handler: (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void
    ) => void
  ): void
}

type Sessions<T extends ProfileSession> = {
  fromPartition(partition: string, options?: { cache: boolean }): T
}

type Guest = {
  readonly id: number
  readonly session: object
  getType(): string
  isDestroyed(): boolean
  reload(): void
}

export const partitionForKind = (kind: BrowserProfileKind): string =>
  kind === "dapp" ? CYPHERIA_DAPP_BROWSER_PARTITION : CYPHERIA_WEB_BROWSER_PARTITION

export const kindForPartition = (partition: string | undefined): BrowserProfileKind | null =>
  partition === CYPHERIA_WEB_BROWSER_PARTITION
    ? "web"
    : partition === CYPHERIA_DAPP_BROWSER_PARTITION
      ? "dapp"
      : null

/** The two browser profiles. Sessions are created once and configured before first use. */
export class BrowserProfiles<
  T extends ProfileSession & Parameters<typeof installThirdPartyCookieFilter>[0],
> {
  readonly dapp: T
  readonly web: T

  constructor(sessions: Sessions<T>) {
    this.web = sessions.fromPartition(CYPHERIA_WEB_BROWSER_PARTITION, { cache: true })
    this.dapp = sessions.fromPartition(CYPHERIA_DAPP_BROWSER_PARTITION, { cache: true })
    for (const profile of [this.web, this.dapp]) {
      // Browser tabs never receive camera, microphone, location, notification, or similar access.
      profile.setPermissionCheckHandler(() => false)
      profile.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    }
    installThirdPartyCookieFilter(this.dapp)
  }

  session(kind: BrowserProfileKind): T {
    return kind === "dapp" ? this.dapp : this.web
  }

  /** Clears browsing data, then reloads affected tabs so pages do not keep stale in-memory state. */
  async clear(input: BrowserClearData, guests: readonly Guest[]): Promise<void> {
    const profile = input.scope === "web" ? this.web : this.dapp
    if (input.scope === "dapp-origin") {
      await profile.clearStorageData({
        origin: new URL(input.origin).origin,
        storages: [...STORAGE_TYPES],
      })
    } else {
      await Promise.all([
        profile.clearStorageData({ storages: [...STORAGE_TYPES] }),
        profile.clearCache(),
        profile.clearAuthCache(),
      ])
    }
    for (const guest of guests) {
      if (guest.isDestroyed() || guest.session !== profile) continue
      if (guest.getType() !== "webview" && guest.getType() !== "window") continue
      try {
        guest.reload()
      } catch {
        // A guest may be closing while the profile is cleared.
      }
    }
  }
}
