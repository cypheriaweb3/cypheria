import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import type { ChromeBrowserInfo } from "../../browser/types.ts"
import { CdpConnection, type TargetInfo } from "../../engine/cdp-connection.ts"
import { freePath } from "../../engine/files.ts"
import type { CdpEvent, CdpTransport } from "../../engine/transport.ts"
import { BROWSER_FAMILY_INFO, type BrowserFamily } from "../../families.ts"
import { CuaHostError } from "../errors.ts"
import {
  type BrowserInstallation,
  browserInstallations,
  COMMON_DEBUGGING_PORTS,
  type DevToolsEndpoint,
  familyFromUserAgent,
  isInstalled,
  isPortOpen,
  type ProbedEndpoint,
  probeDebuggingPort,
  readDevToolsActivePort,
} from "./discovery.ts"
import type { ChromeDriver, DriverTab } from "./driver.ts"
import type { ChromeDriverSource } from "./selection.ts"

const PROFILE_LOOKUP_MS = 3_000

const isUserPage = (target: TargetInfo) =>
  target.type === "page" && !target.url.startsWith("devtools://")

/** A profile of a browser, from the browser's `Local State`. */
type Profile = { readonly dir: string; readonly name?: string; readonly lastUsed: boolean }

/**
 * One running browser reached over its DevTools endpoint. Its profiles share the connection:
 * each is a browser context, which the browser's own `chrome://version` page names. The
 * connection also records when each tab last changed, standing in for the last time it was
 * opened, which CDP does not report.
 */
export class CdpBrowser {
  readonly family: BrowserFamily
  readonly #endpoint: () => Promise<string>
  readonly #suffix: string
  #connection: Promise<CdpConnection> | undefined
  readonly #transports = new Map<string, CdpTransport>()
  readonly #activity = new Map<string, number>()
  /** The profile directory of each browser context, which lasts as long as the browser. */
  readonly #profiles = new Map<string, Promise<string | undefined>>()
  #userDataDir: string | undefined
  readonly #drivers = new Map<string, CdpProfileDriver>()
  readonly #downloadsDir: (() => string) | undefined

  constructor(options: {
    readonly family: BrowserFamily
    readonly endpoint: () => Promise<string>
    /** Distinguishes browsers of one family, such as a probed port; empty for the default. */
    readonly suffix?: string
    /** The user data directory, when known before the profiles are looked up. */
    readonly userDataDir?: string
    /** Where downloads a model waits for are saved. */
    readonly downloadsDir?: () => string
  }) {
    this.family = options.family
    this.#endpoint = options.endpoint
    this.#suffix = options.suffix ?? ""
    this.#userDataDir = options.userDataDir
    this.#downloadsDir = options.downloadsDir
  }

  /** One driver per profile that has a tab open. */
  async drivers(): Promise<CdpProfileDriver[]> {
    const connection = await this.connect()
    const contexts = [
      ...new Set(
        (await connection.targets())
          .filter(isUserPage)
          .map((target) => target.browserContextId ?? "")
          .filter(Boolean)
      ),
    ]
    const profiles = await this.#readProfiles()
    const drivers: CdpProfileDriver[] = []
    for (const context of contexts) {
      const dir = await this.#profileDir(context)
      const profile = dir ? profiles.get(dir) : undefined
      const key = dir ?? context
      let driver = this.#drivers.get(key)
      if (!driver) {
        driver = new CdpProfileDriver(this, key)
        this.#drivers.set(key, driver)
      }
      driver.update(
        context,
        {
          family: this.family,
          id: `${this.family}${this.#suffix}:${key}`,
          name: BROWSER_FAMILY_INFO[this.family].displayName,
          ...(profile?.name ? { profileName: profile.name } : {}),
          ...(profile?.lastUsed ? { lastUsed: true } : {}),
        },
        this.#downloadsDir
      )
      drivers.push(driver)
    }
    return drivers
  }

  async connect(): Promise<CdpConnection> {
    const current = await this.#connection?.catch(() => undefined)
    if (current && !current.closed) return current
    this.#transports.clear()
    this.#profiles.clear()
    this.#connection = (async () => {
      const connection = await CdpConnection.connect(await this.#endpoint())
      connection.onBrowserEvent((event) => this.#onEvent(event))
      await connection.send("Target.setDiscoverTargets", { discover: true })
      return connection
    })()
    this.#connection.catch(() => {
      this.#connection = undefined
    })
    return this.#connection
  }

  async tabs(context: string): Promise<DriverTab[]> {
    const connection = await this.connect()
    return (await connection.targets())
      .filter((target) => isUserPage(target) && target.browserContextId === context)
      .map((target) => {
        const changed = this.#activity.get(target.targetId)
        return {
          id: target.targetId,
          title: target.title,
          url: target.url,
          ...(changed ? { lastOpened: new Date(changed).toISOString() } : {}),
        }
      })
  }

  async openTab(context: string): Promise<string> {
    const connection = await this.connect()
    const { targetId } = await connection.send<{ targetId: string }>("Target.createTarget", {
      background: true,
      browserContextId: context,
      url: "about:blank",
    })
    return targetId
  }

  async closeTab(tabId: string): Promise<void> {
    this.#transports.delete(tabId)
    const connection = await this.connect()
    await connection.send("Target.closeTarget", { targetId: tabId }).catch(() => {})
    // The target leaves the list shortly after the reply; callers list tabs right away.
    for (let attempt = 0; attempt < 20; attempt++) {
      const targets = await connection.targets().catch(() => [])
      if (!targets.some((target) => target.targetId === tabId)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  async transport(tabId: string): Promise<CdpTransport> {
    const existing = this.#transports.get(tabId)
    if (existing) return existing
    const connection = await this.connect()
    const transport = await connection.attach(tabId).catch((error: unknown) => {
      throw new CuaHostError(
        "not_found",
        `Could not reach tab ${tabId}: ${error instanceof Error ? error.message : String(error)}`
      )
    })
    transport.onClose?.(() => this.#transports.delete(tabId))
    this.#transports.set(tabId, transport)
    return transport
  }

  async release(tabId: string): Promise<void> {
    const transport = this.#transports.get(tabId)
    this.#transports.delete(tabId)
    await transport?.detach?.()
  }

  /**
   * Saves the next download a tab of the context starts into `dir`. The browser names the file
   * by its download ID in a private directory while Cypheria waits, then the file moves to a
   * free name; the context's download behavior returns to the browser's own afterward.
   */
  async waitForDownload(
    context: string,
    dir: string,
    timeoutMs: number
  ): Promise<{ path: string; suggestedFilename?: string }> {
    const connection = await this.connect()
    const staging = join(tmpdir(), `cypheria-downloads-${randomUUID()}`)
    await mkdir(staging, { recursive: true })
    await connection.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      browserContextId: context,
      downloadPath: staging,
      eventsEnabled: true,
    })
    let stop = () => {}
    try {
      const { guid, suggestedFilename } = await new Promise<{
        guid: string
        suggestedFilename: string
      }>((resolve, reject) => {
        let started: { guid: string; suggestedFilename: string } | undefined
        const timer = setTimeout(
          () =>
            reject(
              new CuaHostError(
                "timeout",
                started
                  ? `The download did not finish within ${timeoutMs} ms.`
                  : `No download started within ${timeoutMs} ms.`
              )
            ),
          timeoutMs
        )
        const unsubscribe = connection.onBrowserEvent((event) => {
          if (event.method === "Browser.downloadWillBegin" && !started) {
            started = {
              guid: String(event.params.guid),
              suggestedFilename: String(event.params.suggestedFilename ?? "download"),
            }
          } else if (
            event.method === "Browser.downloadProgress" &&
            started &&
            event.params.guid === started.guid
          ) {
            if (event.params.state === "completed") resolve(started)
            if (event.params.state === "canceled")
              reject(new CuaHostError("download_failed", "The download was canceled."))
          }
        })
        stop = () => {
          clearTimeout(timer)
          unsubscribe()
        }
      })
      const path = freePath(dir, suggestedFilename)
      await rename(join(staging, guid), path)
      return { path, suggestedFilename }
    } finally {
      stop()
      await connection
        .send("Browser.setDownloadBehavior", {
          behavior: "default",
          browserContextId: context,
          eventsEnabled: false,
        })
        .catch(() => {})
      await rm(staging, { force: true, recursive: true }).catch(() => {})
    }
  }

  dispose(): void {
    void this.#connection?.then((connection) => connection.close()).catch(() => {})
    this.#connection = undefined
    this.#transports.clear()
    this.#profiles.clear()
  }

  #onEvent(event: CdpEvent): void {
    if (event.method === "Target.targetCreated" || event.method === "Target.targetInfoChanged") {
      const info = event.params.targetInfo as TargetInfo | undefined
      if (info && isUserPage(info)) this.#activity.set(info.targetId, Date.now())
    } else if (event.method === "Target.targetDestroyed") {
      this.#activity.delete(String(event.params.targetId))
    }
  }

  /**
   * The profile directory of a browser context, read from `chrome://version` in a hidden target
   * of that context, which stays out of the tab strip. Unknown when the browser refuses.
   */
  #profileDir(context: string): Promise<string | undefined> {
    let lookup = this.#profiles.get(context)
    if (!lookup) {
      lookup = this.#lookupProfile(context).catch(() => undefined)
      this.#profiles.set(context, lookup)
    }
    return lookup
  }

  async #lookupProfile(context: string): Promise<string | undefined> {
    const connection = await this.connect()
    const { targetId } = await connection.send<{ targetId: string }>("Target.createTarget", {
      browserContextId: context,
      hidden: true,
      url: "chrome://version",
    })
    try {
      const transport = await connection.attach(targetId)
      const deadline = Date.now() + PROFILE_LOOKUP_MS
      while (Date.now() < deadline) {
        const result = await transport
          .send<{ result: { value?: unknown } }>("Runtime.evaluate", {
            expression: "document.getElementById('profile_path')?.textContent ?? ''",
            returnByValue: true,
          })
          .catch(() => undefined)
        const path = result?.result.value
        if (typeof path === "string" && path.trim()) {
          this.#userDataDir ??= dirname(path.trim())
          return basename(path.trim())
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return undefined
    } finally {
      await connection.send("Target.closeTarget", { targetId }).catch(() => {})
    }
  }

  /** The browser's profiles by directory, from `Local State` in its user data directory. */
  async #readProfiles(): Promise<Map<string, Profile>> {
    const profiles = new Map<string, Profile>()
    if (!this.#userDataDir) return profiles
    try {
      const state = JSON.parse(await readFile(join(this.#userDataDir, "Local State"), "utf8")) as {
        profile?: { info_cache?: Record<string, { name?: string }>; last_used?: string }
      }
      for (const [dir, info] of Object.entries(state.profile?.info_cache ?? {})) {
        profiles.set(dir, {
          dir,
          lastUsed: state.profile?.last_used === dir,
          ...(info.name ? { name: info.name } : {}),
        })
      }
    } catch {
      // A profile without a known name is still usable.
    }
    return profiles
  }
}

/** One profile of a `CdpBrowser`, as the `chrome` backend lists it. */
export class CdpProfileDriver implements ChromeDriver {
  readonly userTabs = true
  readonly #browser: CdpBrowser
  readonly key: string
  #context = ""
  #info: ChromeBrowserInfo = { id: "", name: "" }
  #downloadsDir: (() => string) | undefined

  constructor(browser: CdpBrowser, key: string) {
    this.#browser = browser
    this.key = key
  }

  /** The profile's current browser context and info; a restarted browser gives new contexts. */
  update(context: string, info: ChromeBrowserInfo, downloadsDir?: () => string): void {
    this.#context = context
    this.#info = info
    if (downloadsDir) this.#downloadsDir = downloadsDir
  }

  info(): ChromeBrowserInfo {
    return this.#info
  }

  listTabs(): Promise<DriverTab[]> {
    return this.#browser.tabs(this.#context)
  }

  openTab(): Promise<string> {
    return this.#browser.openTab(this.#context)
  }

  closeTab(tabId: string): Promise<void> {
    return this.#browser.closeTab(tabId)
  }

  transport(tabId: string): Promise<CdpTransport> {
    return this.#browser.transport(tabId)
  }

  release(tabId: string): Promise<void> {
    return this.#browser.release(tabId)
  }

  waitForDownload(
    _tabId: string,
    timeoutMs: number
  ): Promise<{ path: string; suggestedFilename?: string }> {
    const dir = this.#downloadsDir?.()
    if (!dir) {
      return Promise.reject(
        new CuaHostError("unsupported", "This device does not save browser downloads.")
      )
    }
    return this.#browser.waitForDownload(this.#context, dir, timeoutMs)
  }

  dispose(): void {}
}

export type CdpDriversOptions = {
  /** Families the person allowed in settings; read on every call. */
  readonly enabledFamilies?: () => ReadonlySet<BrowserFamily>
  /** Where downloads a model waits for are saved. */
  readonly downloadsDir?: () => string
  readonly installations?: () => readonly BrowserInstallation[]
  readonly readEndpoint?: (userDataDir: string) => Promise<DevToolsEndpoint | null>
  readonly isPortOpen?: (port: number) => Promise<boolean>
  /** Ports to probe for browsers started with `--remote-debugging-port`. */
  readonly probePorts?: readonly number[]
  readonly probe?: (port: number) => Promise<ProbedEndpoint | null>
}

/**
 * The `cdp` implementation type of the `chrome` backend: the person's running browsers that
 * allow remote debugging, attached over the Chrome DevTools Protocol. It finds each family's
 * default browser through `DevToolsActivePort` and browsers started on a common debugging port,
 * and lists one browser per open profile.
 */
export class CdpDrivers implements ChromeDriverSource {
  readonly #options: CdpDriversOptions
  readonly #browsers = new Map<string, CdpBrowser>()

  constructor(options: CdpDriversOptions = {}) {
    this.#options = options
  }

  async drivers(): Promise<ChromeDriver[]> {
    const found = await this.#endpoints()
    for (const [key, browser] of this.#browsers) {
      if (!found.has(key)) {
        browser.dispose()
        this.#browsers.delete(key)
      }
    }
    const lists = await Promise.all(
      [...found].map(async ([key, endpoint]) => {
        let browser = this.#browsers.get(key)
        if (!browser) {
          browser = new CdpBrowser({
            endpoint: endpoint.resolve,
            family: endpoint.family,
            ...(endpoint.suffix ? { suffix: endpoint.suffix } : {}),
            ...(endpoint.userDataDir ? { userDataDir: endpoint.userDataDir } : {}),
            ...(this.#options.downloadsDir ? { downloadsDir: this.#options.downloadsDir } : {}),
          })
          this.#browsers.set(key, browser)
        }
        return browser.drivers().catch(() => [])
      })
    )
    return lists.flat()
  }

  dispose(): void {
    for (const browser of this.#browsers.values()) browser.dispose()
    this.#browsers.clear()
  }

  /** The endpoints to connect to, keyed so a browser keeps its connection across calls. */
  async #endpoints(): Promise<
    Map<
      string,
      {
        family: BrowserFamily
        suffix?: string
        userDataDir?: string
        resolve: () => Promise<string>
      }
    >
  > {
    const enabled = this.#options.enabledFamilies?.()
    const installations = (this.#options.installations?.() ?? browserInstallations()).filter(
      (installation) => (!enabled || enabled.has(installation.family)) && isInstalled(installation)
    )
    const endpoints = new Map<
      string,
      {
        family: BrowserFamily
        suffix?: string
        userDataDir?: string
        resolve: () => Promise<string>
      }
    >()
    const ports = new Set<number>()
    await Promise.all(
      installations.map(async (installation) => {
        const endpoint = await this.#endpoint(installation)
        if (!endpoint) return
        ports.add(endpoint.port)
        endpoints.set(installation.family, {
          family: installation.family,
          resolve: async () => {
            const current = await this.#endpoint(installation)
            if (!current) throw this.#notConnected(installation.family)
            return current.webSocketUrl
          },
          userDataDir: installation.userDataDir,
        })
      })
    )
    const probe = this.#options.probe ?? probeDebuggingPort
    await Promise.all(
      (this.#options.probePorts ?? COMMON_DEBUGGING_PORTS)
        .filter((port) => !ports.has(port))
        .map(async (port) => {
          const probed = await probe(port)
          if (!probed) return
          const family = familyFromUserAgent(probed.userAgent)
          if (enabled && !enabled.has(family)) return
          endpoints.set(`${family}@${port}`, {
            family,
            resolve: async () => {
              const current = await probe(port)
              if (!current) throw this.#notConnected(family)
              return current.webSocketUrl
            },
            suffix: `@${port}`,
          })
        })
    )
    return endpoints
  }

  async #endpoint(installation: BrowserInstallation): Promise<DevToolsEndpoint | null> {
    const endpoint = await (this.#options.readEndpoint ?? readDevToolsActivePort)(
      installation.userDataDir
    )
    if (!endpoint) return null
    return (await (this.#options.isPortOpen ?? isPortOpen)(endpoint.port)) ? endpoint : null
  }

  #notConnected(family: BrowserFamily): CuaHostError {
    return new CuaHostError(
      "not_connectable",
      `${BROWSER_FAMILY_INFO[family].displayName} is not connected to Cypheria. Ask the user to check Settings → Computer Use in Cypheria Desktop.`
    )
  }
}
