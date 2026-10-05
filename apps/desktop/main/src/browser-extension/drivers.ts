import { createHash } from "node:crypto"
import { basename } from "node:path"
import { BROWSER_FAMILY_INFO, isBrowserFamily } from "@cypheria/cua"
import type { ChromeBrowserInfo } from "@cypheria/cua/browser"
import type { CdpTransport } from "@cypheria/cua/engine"
import {
  type ChromeDriver,
  type ChromeDriverSource,
  CuaHostError,
  type DriverTab,
} from "@cypheria/cua/host"

import type { ExtensionSession } from "./session.js"

/** The tab group key of a Thread: stable, and opaque to the extension. */
const groupKey = (threadId: string): string =>
  createHash("sha256").update(threadId).digest("hex").slice(0, 24)

const tabNumber = (tabId: string): number => {
  const id = Number(tabId)
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new CuaHostError("not_found", `Tab ${tabId} is not a tab of this browser.`)
  }
  return id
}

/** One browser profile with the Cypheria extension, as the `chrome` backend drives it. */
export class ExtensionDriver implements ChromeDriver {
  readonly userTabs = true
  readonly session: ExtensionSession
  #lastUsed = false

  constructor(session: ExtensionSession) {
    this.session = session
  }

  set lastUsed(value: boolean) {
    this.#lastUsed = value
  }

  info(): ChromeBrowserInfo {
    const info = this.session.info
    const family = info?.family ?? "chrome"
    return {
      family,
      id: `${family}:${(info?.instanceId ?? "unknown").slice(0, 8)}`,
      name: isBrowserFamily(family) ? BROWSER_FAMILY_INFO[family].displayName : family,
      ...(info?.profileName ? { profileName: info.profileName } : {}),
      ...(this.#lastUsed ? { lastUsed: true } : {}),
    }
  }

  async listTabs(): Promise<DriverTab[]> {
    return (await this.session.request("listTabs", {})).map((tab) => ({
      active: tab.active,
      id: String(tab.id),
      title: tab.title,
      url: tab.url,
      ...(tab.lastAccessed ? { lastOpened: new Date(tab.lastAccessed).toISOString() } : {}),
      ...(tab.groupTitle ? { tabGroup: tab.groupTitle } : {}),
    }))
  }

  async openTab(threadId: string, sessionName: string | undefined): Promise<string> {
    const { id } = await this.session.request("openTab", {
      group: groupKey(threadId),
      ...(sessionName ? { title: sessionName } : {}),
    })
    return String(id)
  }

  async nameSession(threadId: string, name: string): Promise<void> {
    await this.session.request("nameGroup", { group: groupKey(threadId), title: name })
  }

  async closeTab(tabId: string): Promise<void> {
    await this.session.request("closeTab", { tabId: tabNumber(tabId) })
  }

  transport(tabId: string): Promise<CdpTransport> {
    return this.session.transport(tabNumber(tabId)).catch((error: unknown) => {
      throw new CuaHostError(
        "not_found",
        `Could not reach tab ${tabId}: ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }

  async release(tabId: string): Promise<void> {
    await this.session.request("detach", { tabId: tabNumber(tabId) })
  }

  /** Waits for the next download the browser starts and finishes, wherever it saves it. */
  waitForDownload(
    _tabId: string,
    timeoutMs: number
  ): Promise<{ path: string; suggestedFilename?: string }> {
    return new Promise((resolve, reject) => {
      let started: number | undefined
      const timer = setTimeout(() => {
        stop()
        reject(
          new CuaHostError(
            "timeout",
            started === undefined
              ? `No download started within ${timeoutMs} ms.`
              : `The download did not finish within ${timeoutMs} ms.`
          )
        )
      }, timeoutMs)
      const stop = this.session.onDownload((change) => {
        if (started === undefined && change.state === "in_progress") started = change.id
        if (change.id !== started) return
        if (change.state === "complete" && change.filename) {
          clearTimeout(timer)
          stop()
          resolve({ path: change.filename, suggestedFilename: basename(change.filename) })
        } else if (change.state === "interrupted") {
          clearTimeout(timer)
          stop()
          reject(
            new CuaHostError(
              "download_failed",
              `The download failed: ${change.error ?? "interrupted"}.`
            )
          )
        }
      })
    })
  }

  dispose(): void {}
}

/**
 * The `extension` implementation type of the `chrome` backend: every connected profile with the
 * Cypheria extension. A family name resolves to the profile that connected last.
 */
export class ExtensionDrivers implements ChromeDriverSource {
  readonly #sessions: () => readonly ExtensionSession[]
  readonly #drivers = new WeakMap<ExtensionSession, ExtensionDriver>()

  constructor(sessions: () => readonly ExtensionSession[]) {
    this.#sessions = sessions
  }

  async drivers(): Promise<ExtensionDriver[]> {
    const sessions = this.#sessions().filter((session) => !session.isClosed && session.info)
    const latest = new Map<string, ExtensionSession>()
    for (const session of sessions) {
      const family = session.info?.family ?? ""
      const current = latest.get(family)
      if (!current || current.connectedAt < session.connectedAt) latest.set(family, session)
    }
    return sessions.map((session) => {
      let driver = this.#drivers.get(session)
      if (!driver) {
        driver = new ExtensionDriver(session)
        this.#drivers.set(session, driver)
      }
      driver.lastUsed = latest.get(session.info?.family ?? "") === session
      return driver
    })
  }
}
