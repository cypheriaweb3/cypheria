import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"

import { BROWSER_FAMILY_INFO, type BrowserFamily } from "../../families.ts"
import type { CuaImage, ExternalBrowserInfo, ExternalTabInfo, PageAction } from "../../protocol.ts"
import { CuaHostError } from "../errors.ts"
import {
  type AgentBrowserResponse,
  type AgentBrowserRunner,
  AgentBrowserSession,
} from "./agent-browser.ts"
import {
  type BrowserInstallation,
  browserInstallations,
  type DevToolsEndpoint,
  isInstalled,
  isPortOpen,
  readDevToolsActivePort,
} from "./discovery.ts"

export type ExternalActionResponse = {
  readonly text?: string
  readonly image?: CuaImage
  readonly value?: unknown
  readonly notice?: string
  readonly tab?: ExternalTabInfo
}

type Disposition = "temporary" | "deliverable" | "handoff"
type ControlledTab = { owned: boolean; disposition: Disposition }
type ThreadBrowser = {
  session: AgentBrowserSession
  tabs: Map<string, ControlledTab>
  /** Marks from an ended turn; they clear when a later turn uses this browser again. */
  staleMarks: boolean
}

export type ExternalBrowsersBackendOptions = {
  readonly runner: AgentBrowserRunner
  /** A private directory for screenshots on their way to the model. */
  readonly scratchDir: string
  /** Families the person allowed in settings; read on every call. */
  readonly enabledFamilies?: () => ReadonlySet<BrowserFamily>
  readonly installations?: () => readonly BrowserInstallation[]
  readonly readEndpoint?: (userDataDir: string) => Promise<DevToolsEndpoint | null>
  readonly isPortOpen?: (port: number) => Promise<boolean>
}

const sessionName = (threadId: string, family: BrowserFamily) =>
  `cypheria-${createHash("sha256").update(threadId).digest("hex").slice(0, 16)}-${family}`

const tabsOf = (response: AgentBrowserResponse) =>
  ((response.data?.tabs as Record<string, unknown>[] | undefined) ?? []).filter(
    (tab) => tab.type === undefined || tab.type === "page"
  )

/**
 * The user's external Chromium browsers, driven by agent-browser over each browser's DevTools
 * endpoint. A Thread acts only in tabs it opened or claimed. At the end of a turn, unmarked tabs
 * it opened close and unmarked tabs it claimed are released. Marked tabs stay; their marks clear
 * when a later turn uses the browser again, so they must be marked again to outlive that turn.
 */
export class ExternalBrowsersBackend {
  readonly #options: ExternalBrowsersBackendOptions
  readonly #threads = new Map<string, Map<BrowserFamily, ThreadBrowser>>()

  constructor(options: ExternalBrowsersBackendOptions) {
    this.#options = options
  }

  async list(): Promise<ExternalBrowserInfo[]> {
    const enabled = this.#options.enabledFamilies?.()
    const installations = this.#installations().filter(
      (installation) => !enabled || enabled.has(installation.family)
    )
    return Promise.all(
      installations.map(async (installation) => {
        const installed = isInstalled(installation)
        const setup = installed ? await this.#setupProblem(installation) : undefined
        return {
          connectable: installed && setup === undefined,
          id: installation.family,
          installed,
          name: installation.name,
          ...(installed && setup ? { setup } : {}),
        }
      })
    )
  }

  async tabs(threadId: string, family: BrowserFamily): Promise<ExternalTabInfo[]> {
    const browser = await this.#browser(threadId, family)
    const response = await browser.session.inTab(null, [["tab", "list"]])
    this.#check(response)
    return tabsOf(response).map((tab) => this.#tabInfo(browser, tab))
  }

  async newTab(threadId: string, family: BrowserFamily, url?: string): Promise<ExternalTabInfo> {
    const browser = await this.#browser(threadId, family)
    const response = await browser.session.inTab(null, [["tab", "new", ...(url ? [url] : [])]], {
      activeAfter: (result) => (result.success ? String(result.data?.targetId) : undefined),
    })
    this.#check(response)
    const id = String(response.data?.targetId)
    browser.tabs.set(id, { disposition: "temporary", owned: true })
    return { controlled: true, id, title: "", url: String(response.data?.url ?? url ?? "") }
  }

  async claim(threadId: string, family: BrowserFamily, tabId: string): Promise<ExternalTabInfo> {
    const browser = await this.#browser(threadId, family)
    const listed = await browser.session.inTab(null, [["tab", "list"]])
    this.#check(listed)
    const tab = tabsOf(listed).find((item) => item.targetId === tabId)
    if (!tab) throw new CuaHostError("not_found", `Tab ${tabId} is not open in ${family}.`)
    if (!browser.tabs.has(tabId))
      browser.tabs.set(tabId, { disposition: "temporary", owned: false })
    return { ...this.#tabInfo(browser, tab), controlled: true }
  }

  async act(
    threadId: string,
    family: BrowserFamily,
    tabId: string,
    action: PageAction,
    cwd?: string
  ): Promise<ExternalActionResponse> {
    const browser = await this.#browser(threadId, family)
    const controlled = browser.tabs.get(tabId)
    if (!controlled) {
      throw new CuaHostError(
        "not_controlled",
        `This task does not control tab ${tabId}. Claim it with claimTab() or open a new tab first.`
      )
    }
    if (action.type === "mark") {
      controlled.disposition = action.disposition
      return {}
    }
    if (action.type === "close") {
      if (controlled.owned) {
        this.#check(await browser.session.inTab(null, [["tab", "close", tabId]]))
      }
      browser.tabs.delete(tabId)
      return {}
    }
    const screenshotPath =
      action.type === "screenshot" ? join(this.#options.scratchDir, `${randomUUID()}.png`) : null
    if (screenshotPath) await mkdir(this.#options.scratchDir, { recursive: true })
    const commands = this.#commands(action, screenshotPath, cwd)
    const response = await browser.session.inTab(tabId, commands)
    const staleNotice =
      response.switched && !response.success && /unknown ref/iu.test(response.error ?? "")
        ? " Refs belong to the latest snapshot of the tab you last used in this browser; take a snapshot of this tab first."
        : ""
    if (!response.success) {
      if (screenshotPath) await rm(screenshotPath, { force: true })
      throw new CuaHostError(
        "browser_error",
        `${response.error ?? "The browser action failed."}${staleNotice}`
      )
    }
    return this.#result(action, response, screenshotPath)
  }

  /** Applies the end-of-turn tab rules for one Thread. */
  async turnEnded(threadId: string): Promise<void> {
    const browsers = this.#threads.get(threadId)
    if (!browsers) return
    for (const browser of browsers.values()) {
      for (const [tabId, tab] of [...browser.tabs]) {
        if (tab.disposition !== "temporary") {
          browser.staleMarks = true
          continue
        }
        browser.tabs.delete(tabId)
        if (tab.owned)
          await browser.session.inTab(null, [["tab", "close", tabId]]).catch(() => undefined)
      }
    }
  }

  /** Forgets a Thread. The browsers and the user's tabs stay open. */
  closeThread(threadId: string): void {
    this.#threads.delete(threadId)
  }

  #installations(): readonly BrowserInstallation[] {
    return this.#options.installations?.() ?? browserInstallations()
  }

  async #endpoint(installation: BrowserInstallation): Promise<DevToolsEndpoint | null> {
    const endpoint = await (this.#options.readEndpoint ?? readDevToolsActivePort)(
      installation.userDataDir
    )
    if (!endpoint) return null
    return (await (this.#options.isPortOpen ?? isPortOpen)(endpoint.port)) ? endpoint : null
  }

  async #setupProblem(installation: BrowserInstallation): Promise<string | undefined> {
    if (await this.#endpoint(installation)) return undefined
    const info = BROWSER_FAMILY_INFO[installation.family]
    return `${info.displayName} is not accepting connections. Ask the user to open ${info.displayName}, visit ${info.inspectUrl}, turn on remote debugging, and allow the connection when ${info.displayName} asks.`
  }

  async #browser(threadId: string, family: BrowserFamily): Promise<ThreadBrowser> {
    const enabled = this.#options.enabledFamilies?.()
    if (enabled && !enabled.has(family)) {
      throw new CuaHostError(
        "disabled",
        `${BROWSER_FAMILY_INFO[family].displayName} is disabled in Cypheria's Computer Use settings.`
      )
    }
    const installation = this.#installations().find((entry) => entry.family === family)
    if (!installation)
      throw new CuaHostError("unsupported", `${family} is not supported on this platform.`)
    let browsers = this.#threads.get(threadId)
    if (!browsers) {
      browsers = new Map()
      this.#threads.set(threadId, browsers)
    }
    let browser = browsers.get(family)
    if (!browser) {
      const endpoint = async () => {
        const found = await this.#endpoint(installation)
        if (!found) {
          throw new CuaHostError("not_connectable", (await this.#setupProblem(installation)) ?? "")
        }
        return found.webSocketUrl
      }
      browser = {
        session: new AgentBrowserSession(
          sessionName(threadId, family),
          this.#options.runner,
          endpoint
        ),
        staleMarks: false,
        tabs: new Map(),
      }
      browsers.set(family, browser)
    }
    if (browser.staleMarks) {
      browser.staleMarks = false
      for (const tab of browser.tabs.values()) tab.disposition = "temporary"
    }
    return browser
  }

  #check(response: AgentBrowserResponse): void {
    if (!response.success) {
      throw new CuaHostError("browser_error", response.error ?? "The browser action failed.")
    }
  }

  #tabInfo(browser: ThreadBrowser, tab: Record<string, unknown>): ExternalTabInfo {
    const id = String(tab.targetId)
    return {
      controlled: browser.tabs.has(id),
      id,
      title: String(tab.title ?? ""),
      url: String(tab.url ?? ""),
    }
  }

  #commands(
    action: Exclude<PageAction, { type: "mark" | "close" }>,
    screenshotPath: string | null,
    cwd: string | undefined
  ): string[][] {
    const point = (value: readonly [number, number]) => [String(value[0]), String(value[1])]
    switch (action.type) {
      case "snapshot":
        return [["snapshot", ...(action.interactive ? ["-i"] : []), "-c"]]
      case "screenshot":
        return [
          [
            "screenshot",
            ...(action.fullPage ? ["--full"] : []),
            ...(action.annotate ? ["--annotate"] : []),
            screenshotPath as string,
          ],
        ]
      case "click": {
        if (Array.isArray(action.target)) {
          const button = action.button ?? "left"
          const clicks = action.double ? 2 : 1
          return [
            ["mouse", "move", ...point(action.target)],
            ...Array.from({ length: clicks }, () => [
              ["mouse", "down", button],
              ["mouse", "up", button],
            ]).flat(),
          ]
        }
        if (action.button && action.button !== "left") {
          throw new CuaHostError(
            "unsupported",
            "Right and middle clicks need coordinates: take an annotated screenshot and click a point."
          )
        }
        return [[action.double ? "dblclick" : "click", action.target as string]]
      }
      case "fill":
        return [["fill", action.ref, action.value]]
      case "type":
        return action.ref
          ? [["type", action.ref, action.text]]
          : [["keyboard", "type", action.text]]
      case "press":
        return [...(action.ref ? [["focus", action.ref]] : []), ["press", action.key]]
      case "hover":
        return Array.isArray(action.target)
          ? [["mouse", "move", ...point(action.target)]]
          : [["hover", action.target as string]]
      case "select":
        return [["select", action.ref, ...action.values]]
      case "check":
        return [[action.checked ? "check" : "uncheck", action.ref]]
      case "scroll":
        return [
          ...(action.ref ? [["scrollintoview", action.ref]] : []),
          ["scroll", action.direction, String(action.pixels ?? 300)],
        ]
      case "drag":
        return [["drag", action.from, action.to]]
      case "upload":
        return [["upload", action.ref, ...action.paths.map((path) => this.#uploadPath(path, cwd))]]
      case "get":
        return [["get", action.what, ...(action.ref ? [action.ref] : [])]]
      case "evaluate":
        return [["eval", action.script]]
      case "wait":
        if (action.text) return [["wait", "--text", action.text]]
        if (action.url) return [["wait", "--url", action.url]]
        if (action.selector) return [["wait", action.selector]]
        return [["wait", String(action.ms ?? 1_000)]]
      case "goto":
        return [["open", action.url]]
      case "back":
      case "forward":
      case "reload":
        return [[action.type]]
      case "dialog":
        return [
          ["dialog", action.accept ? "accept" : "dismiss", ...(action.text ? [action.text] : [])],
        ]
    }
  }

  #uploadPath(path: string, cwd: string | undefined): string {
    if (!cwd) throw new CuaHostError("denied", "Uploads need a task working directory.")
    const absolute = isAbsolute(path) ? path : resolve(cwd, path)
    const inside = relative(cwd, absolute)
    if (inside.startsWith("..") || isAbsolute(inside)) {
      throw new CuaHostError("denied", `Upload paths must be inside ${cwd}.`)
    }
    return absolute
  }

  async #result(
    action: PageAction,
    response: AgentBrowserResponse,
    screenshotPath: string | null
  ): Promise<ExternalActionResponse> {
    const data = response.data ?? {}
    const warning = typeof data.warning === "string" ? data.warning : undefined
    const base: ExternalActionResponse = warning ? { notice: `Browser: ${warning}` } : {}
    switch (action.type) {
      case "snapshot":
        return { ...base, text: String(data.snapshot ?? "") }
      case "screenshot": {
        const path = screenshotPath as string
        const bytes = await readFile(path)
        await rm(path, { force: true })
        const annotations = Array.isArray(data.annotations)
          ? (data.annotations as { number: number; ref: string; role: string; name?: string }[])
              .map(
                (item) =>
                  `[${item.number}] @${item.ref} ${item.role}${item.name ? ` "${item.name}"` : ""}`
              )
              .join("\n")
          : undefined
        return {
          ...base,
          image: { dataBase64: bytes.toString("base64"), mimeType: "image/png" },
          ...(annotations ? { text: annotations } : {}),
        }
      }
      case "get":
        return { ...base, value: data[action.what] ?? data.text ?? data.value }
      case "evaluate":
        return { ...base, value: data.result }
      default:
        return base
    }
  }
}
