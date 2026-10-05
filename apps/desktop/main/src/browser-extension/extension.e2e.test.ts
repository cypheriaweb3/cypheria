import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NATIVE_HOST_NAME } from "@cypheria/browser-extension/protocol"
import type { BrowserHostCall, TabInfo, UserTabInfo } from "@cypheria/cua/browser"
import { ChromeSessions } from "@cypheria/cua/host"
import { chromium } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ExtensionDrivers } from "./drivers.js"
import { ExtensionEndpoint } from "./endpoint.js"
import { hostBinaryName, nativeHostManifest } from "./install.js"

const repository = join(import.meta.dirname, "..", "..", "..", "..", "..")
const extensionDir = join(repository, "apps", "browser-extension")
const hostDir = join(repository, "apps", "browser-extension-host")
const executable = chromium.executablePath()
const hasGo = (() => {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()
const available = existsSync(executable) && hasGo && process.platform !== "win32"

/**
 * The extension implementation end to end: Chromium loads the unpacked extension, which starts
 * the Go native host from the test's user data directory, which connects to Desktop's endpoint;
 * the `chrome` backend then drives tabs through `chrome.debugger`.
 */
describe.skipIf(!available)("the Cypheria extension in Chromium", () => {
  let directory: string
  let browser: ChildProcess | undefined
  let endpoint: ExtensionEndpoint
  let sessions: ChromeSessions
  let server: Server
  let origin: string
  let browserId: string
  const headers: string[] = []

  beforeAll(async () => {
    // Unix socket paths are short on macOS, so keep the home near the root.
    directory = mkdtempSync(join(tmpdir(), "cbx-"))
    const home = join(directory, "h")
    const userData = join(directory, "u")
    const downloads = join(directory, "d")
    for (const dir of [home, userData, downloads, join(userData, "Default")]) {
      mkdirSync(dir, { recursive: true })
    }
    execFileSync("pnpm", ["exec", "wxt", "build"], { cwd: extensionDir, stdio: "ignore" })
    const binary = join(home, "bin", hostBinaryName())
    execFileSync("go", ["build", "-o", binary, "./cmd/cypheria-browser-host"], {
      cwd: hostDir,
      stdio: "ignore",
    })
    mkdirSync(join(userData, "NativeMessagingHosts"))
    writeFileSync(
      join(userData, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`),
      JSON.stringify(nativeHostManifest(binary))
    )
    writeFileSync(
      join(userData, "Default", "Preferences"),
      JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } })
    )
    server = createServer((request, response) => {
      headers.push(String(request.headers["x-browser-agent"] ?? ""))
      if (request.url === "/pic.png") {
        const signedIn = String(request.headers.cookie ?? "").includes("session=1")
        response.writeHead(signedIn ? 200 : 403, { "content-type": "image/png" })
        response.end(signedIn ? "PNGDATA" : "")
        return
      }
      if (request.url === "/upload") {
        response.writeHead(200, { "content-type": "text/html" })
        response.end('<title>Upload</title><input id="file" type="file">')
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
      response.writeHead(200, { "content-type": "text/html", "set-cookie": "session=1" })
      response.end(
        '<title>Served</title><button>Go</button><a href="/file">Download</a><img id="pic" src="/pic.png">'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    endpoint = new ExtensionEndpoint({ cypheriaHome: home, desktopVersion: "9.9.9" })
    await endpoint.start()
    const drivers = new ExtensionDrivers(() => endpoint.sessions)
    sessions = new ChromeSessions({
      agentHeader: "Cypheria/test",
      downloadsDir: () => downloads,
      drivers: () => drivers.drivers(),
      platform: process.platform,
    })
    browser = spawn(
      executable,
      [
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${userData}`,
        `--disable-extensions-except=${join(extensionDir, ".output", "chrome-mv3")}`,
        `--load-extension=${join(extensionDir, ".output", "chrome-mv3")}`,
        "data:text/html,<title>User inbox</title><h1>Inbox</h1>",
      ],
      { stdio: "ignore" }
    )
    for (let attempt = 0; attempt < 200 && endpoint.sessions.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const [info] = await sessions.list()
    if (!info) throw new Error("The extension did not connect to the endpoint.")
    browserId = info.id
  }, 60_000)

  afterAll(async () => {
    if (browser && browser.exitCode === null) {
      const exited = new Promise((resolve) => browser?.once("exit", resolve))
      browser.kill()
      await exited
    }
    await endpoint?.stop()
    server?.close()
    if (directory) rmSync(directory, { force: true, recursive: true })
  })

  const call = (threadId: string, member: string, args: unknown[] = [], extra = {}) =>
    sessions.call(
      {
        args,
        backend: "chrome",
        browser: browserId,
        member,
        op: "browser.call",
        ...extra,
      } as BrowserHostCall,
      { threadId }
    )

  it("lists the profile as a chrome browser", async () => {
    const [info] = await sessions.list()
    expect(info).toMatchObject({ family: "chromium", lastUsed: true, name: "Chromium" })
  })

  it("drives agent tabs and claims the person's tabs", async () => {
    await call("a", "browser.nameSession", ["Research"])
    const tab = (await call("a", "tabs.new")) as TabInfo
    await call("a", "tab.goto", [`${origin}/page`], { tab: tab.id })
    expect(headers.at(-1)).toBe("Cypheria/test")
    const state = (await call("a", "ax.get", ["state"], { tab: tab.id })) as { state: string }
    expect(state.state).toContain("Title: Served")
    expect(state.state).toMatch(/button "Go" \[\d+\]/u)
    const open = (await call("b", "user.openTabs")) as UserTabInfo[]
    expect(open.find((candidate) => candidate.id === tab.id)?.tabGroup).toBe("Research")
    const inbox = open.find((candidate) => candidate.title === "User inbox")
    expect(inbox).toBeDefined()
    const claimed = (await call("b", "user.claimTab", [inbox?.id])) as TabInfo
    expect(claimed.title).toBe("User inbox")
    expect(
      await call("b", "playwright.evaluate", ["() => document.title", null], { tab: claimed.id })
    ).toBe("User inbox")
  })

  it("saves downloads and closes agent tabs at turn end", async () => {
    const tab = (await call("d", "tabs.new")) as TabInfo
    await call("d", "tab.goto", [`${origin}/page`], { tab: tab.id })
    const handle = (await call(
      "d",
      "playwright.waitForEvent",
      ["download", { timeoutMs: 15_000 }],
      {
        tab: tab.id,
      }
    )) as { handle: string }
    await call("d", "locator.click", [], { selector: "text=Download", tab: tab.id })
    const path = (await call("d", "download.path", [], {
      handle: handle.handle,
      tab: tab.id,
    })) as string
    expect(readFileSync(path, "utf8")).toBe("report")
    const media = (await call("d", "locator.downloadMedia", [], {
      selector: "#pic",
      tab: tab.id,
    })) as string
    expect(readFileSync(media, "utf8")).toBe("PNGDATA")
    await sessions.turnEnded("d")
    const open = (await call("e", "user.openTabs")) as UserTabInfo[]
    expect(open.some((candidate) => candidate.id === tab.id)).toBe(false)
  })

  it("uploads files from the working directory", async () => {
    writeFileSync(join(directory, "note.txt"), "hello")
    const tab = (await call("u", "tabs.new")) as TabInfo
    await call("u", "tab.goto", [`${origin}/upload`], { tab: tab.id })
    const waiting = call("u", "playwright.waitForEvent", ["filechooser", { timeoutMs: 10_000 }], {
      tab: tab.id,
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await call("u", "locator.click", [], { selector: "#file", tab: tab.id })
    const chooser = (await waiting) as { handle: string }
    await sessions.call(
      {
        args: [["note.txt"]],
        backend: "chrome",
        browser: browserId,
        handle: chooser.handle,
        member: "fileChooser.setFiles",
        op: "browser.call",
        tab: tab.id,
      } as BrowserHostCall,
      { cwd: directory, threadId: "u" }
    )
    expect(
      await call(
        "u",
        "playwright.evaluate",
        ["() => document.getElementById('file').files[0]?.name ?? null", null],
        { tab: tab.id }
      )
    ).toBe("note.txt")
  })
})
