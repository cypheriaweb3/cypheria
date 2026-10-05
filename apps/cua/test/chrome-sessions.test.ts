import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { chromium } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BrowserHostCall } from "../src/browser/protocol.ts"
import type { ChromeBrowserInfo, TabInfo, UserTabInfo } from "../src/browser/types.ts"
import { CdpDrivers } from "../src/host/chrome/cdp.ts"
import type { ChromeDriver } from "../src/host/chrome/driver.ts"
import { type ChromeLeaseState, ChromeSessions } from "../src/host/chrome/sessions.ts"

const executable = chromium.executablePath()
const available = existsSync(executable)

describe.skipIf(!available)("chrome sessions over CDP", () => {
  let browser: ChildProcess | undefined
  let server: Server
  let origin: string
  let directory: string
  let drivers: CdpDrivers
  let sessions: ChromeSessions
  let saved: ChromeLeaseState | undefined
  const headers: string[] = []

  const userData = () => join(directory, "user-data")
  const newSessions = () =>
    new ChromeSessions({
      agentHeader: "Cypheria/test",
      downloadsDir: () => join(directory, "downloads"),
      drivers: () => drivers.drivers(),
      leases: {
        load: async () => saved,
        save: async (state) => {
          saved = state
        },
      },
      platform: "linux",
    })

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "cua-chrome-"))
    mkdirSync(join(directory, "downloads"))
    server = createServer((request, response) => {
      headers.push(String(request.headers["x-browser-agent"] ?? ""))
      if (request.url === "/media") {
        response.writeHead(200, { "content-type": "text/html", "set-cookie": "session=1" })
        response.end('<title>Media</title><img id="pic" src="/pic.png" alt="pic">')
        return
      }
      if (request.url === "/pic.png") {
        const signedIn = String(request.headers.cookie ?? "").includes("session=1")
        response.writeHead(signedIn ? 200 : 403, { "content-type": "image/png" })
        response.end(signedIn ? "PNGDATA" : "")
        return
      }
      if (request.url === "/file") {
        response.writeHead(200, {
          "content-disposition": 'attachment; filename="report.txt"',
          "content-type": "text/plain",
        })
        response.end("report")
        return
      }
      response.writeHead(200, { "content-type": "text/html" })
      response.end('<title>Served</title><a href="/file">Download</a>')
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    // A profile with a name, as `Local State` records it.
    mkdirSync(userData())
    writeFileSync(
      join(userData(), "Local State"),
      JSON.stringify({
        profile: { info_cache: { Default: { name: "Work" } }, last_used: "Default" },
      })
    )
    browser = spawn(
      executable,
      [
        "--headless=new",
        "--no-first-run",
        "--remote-debugging-port=0",
        `--user-data-dir=${userData()}`,
        "data:text/html,<title>User inbox</title><h1>Inbox</h1>",
      ],
      { stdio: "ignore" }
    )
    for (
      let attempt = 0;
      attempt < 100 && !existsSync(join(userData(), "DevToolsActivePort"));
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    drivers = new CdpDrivers({
      downloadsDir: () => join(directory, "downloads"),
      installations: () => [
        { executables: [], family: "chrome", name: "Google Chrome", userDataDir: userData() },
      ],
      probePorts: [],
    })
    sessions = newSessions()
  }, 30_000)

  afterAll(() => {
    drivers?.dispose()
    browser?.kill()
    server?.close()
    if (directory) rmSync(directory, { force: true, recursive: true })
  })

  const profile = async (): Promise<ChromeDriver> => {
    const [driver] = await drivers.drivers()
    if (!driver) throw new Error("no profile")
    return driver
  }

  const call = (threadId: string, member: string, args: unknown[] = [], tab?: string) =>
    sessions.call(
      {
        args,
        backend: "chrome",
        browser: "chrome:Default",
        member,
        op: "browser.call",
        ...(tab ? { tab } : {}),
      } as BrowserHostCall,
      { threadId }
    )

  it("lists one browser per open profile with the profile's name", async () => {
    expect((await profile()).info()).toEqual({
      family: "chrome",
      id: "chrome:Default",
      lastUsed: true,
      name: "Google Chrome",
      profileName: "Work",
    } satisfies ChromeBrowserInfo)
  })

  it("scopes tabs to the Thread that opened or claimed them", async () => {
    const opened = (await call("a", "tabs.new")) as TabInfo
    await call(
      "a",
      "tab.goto",
      ["data:text/html,<title>Agent</title><button>Go</button>"],
      opened.id
    )
    const state = (await call("a", "ax.get", ["state"], opened.id)) as { state: string }
    expect(state.state).toContain("Title: Agent")
    expect(state.state).toMatch(/button "Go" \[\d+\]/u)
    expect(((await call("a", "tabs.list")) as TabInfo[]).map((tab) => tab.id)).toEqual([opened.id])
    expect(await call("b", "tabs.list")).toEqual([])
    await expect(call("b", "tab.reload", [], opened.id)).rejects.toThrow(/does not control tab/u)

    const user = ((await call("b", "user.openTabs")) as UserTabInfo[]).find(
      (tab) => tab.title === "User inbox"
    )
    expect(user).toBeDefined()
    const claimed = (await call("b", "user.claimTab", [user?.id])) as TabInfo
    expect(claimed.title).toBe("User inbox")
  })

  it("marks agent requests, shows the pointer, and saves downloads", async () => {
    const tab = (await call("d", "tabs.new")) as TabInfo
    await call("d", "tab.goto", [`${origin}/page`], tab.id)
    expect(headers.at(-1)).toBe("Cypheria/test")
    const handle = (await call(
      "d",
      "playwright.waitForEvent",
      ["download", { timeoutMs: 10_000 }],
      tab.id
    )) as { handle: string }
    await sessions.call(
      {
        args: [],
        backend: "chrome",
        browser: "chrome:Default",
        member: "locator.click",
        op: "browser.call",
        selector: "text=Download",
        tab: tab.id,
      } as BrowserHostCall,
      { threadId: "d" }
    )
    expect(
      await call(
        "d",
        "playwright.evaluate",
        ["() => !!document.getElementById('__cypheria_agent_cursor__')", null],
        tab.id
      )
    ).toBe(true)
    const path = (await sessions.call(
      {
        args: [],
        backend: "chrome",
        browser: "chrome:Default",
        handle: handle.handle,
        member: "download.path",
        op: "browser.call",
        tab: tab.id,
      } as BrowserHostCall,
      { threadId: "d" }
    )) as string
    expect(path).toBe(join(directory, "downloads", "report.txt"))
    expect(readFileSync(path, "utf8")).toBe("report")
  })

  it("keeps leases across a restart of the device", async () => {
    const kept = (await call("e", "tabs.new")) as TabInfo
    expect(saved?.threads.find((thread) => thread.threadId === "e")).toBeDefined()
    sessions = newSessions()
    expect(((await call("e", "tabs.list")) as TabInfo[]).map((tab) => tab.id)).toEqual([kept.id])
  })

  it("closes unmarked agent tabs and releases claimed tabs at turn end", async () => {
    const kept = (await call("c", "tabs.new")) as TabInfo
    const dropped = (await call("c", "tabs.new")) as TabInfo
    await call("c", "tab.markDeliverable", [], kept.id)
    await sessions.turnEnded("c")
    const open = (await (await profile()).listTabs()).map((tab) => tab.id)
    expect(open).toContain(kept.id)
    expect(open).not.toContain(dropped.id)
    await sessions.turnEnded("b")
    expect((await (await profile()).listTabs()).some((tab) => tab.title === "User inbox")).toBe(
      true
    )
    expect(await call("b", "tabs.list")).toEqual([])
  })

  it("downloads media through the browser with the page's cookies", async () => {
    const tab = (await call("m", "tabs.new")) as TabInfo
    await call("m", "tab.goto", [`${origin}/media`], tab.id)
    const path = (await sessions.call(
      {
        args: [],
        backend: "chrome",
        browser: "chrome:Default",
        member: "locator.downloadMedia",
        op: "browser.call",
        selector: "#pic",
        tab: tab.id,
      } as BrowserHostCall,
      { threadId: "m" }
    )) as string
    expect(path).toBe(join(directory, "downloads", "pic.png"))
    expect(readFileSync(path, "utf8")).toBe("PNGDATA")
  })
})
