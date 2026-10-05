import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { chromium } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DomTab } from "../src/dom-engine/index.ts"
import { CdpConnection } from "../src/engine/cdp-connection.ts"
import type { CdpTransport } from "../src/engine/transport.ts"

const executable = chromium.executablePath()
const available = existsSync(executable)

// The page forbids eval, as an MCP App's content security policy may.
const PAGE = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'">
<title>App</title>
<form id="form" onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'sent ' + document.getElementById('name').value">
  <label>Name <input id="name"></label>
  <label><input type="checkbox" id="agree"> Agree</label>
  <select id="color"><option value="r">Red</option><option value="g">Green</option></select>
  <button type="button" id="go" onclick="document.getElementById('out').textContent = 'clicked ' + document.getElementById('name').value">Go</button>
</form>
<p id="out"></p>
<ul><li>One</li><li>Two</li></ul>
<button disabled>Off</button>`

let browser: ChildProcess | undefined
let connection: CdpConnection | undefined
let transport: CdpTransport
let tab: DomTab
let directory: string

const launch = async (): Promise<string> => {
  directory = mkdtempSync(join(tmpdir(), "cua-dom-"))
  writeFileSync(join(directory, "app.html"), PAGE)
  browser = spawn(
    executable,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(directory, "profile")}`,
      `file://${join(directory, "app.html")}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  )
  return new Promise((resolve, reject) => {
    let output = ""
    browser?.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
      const match = /DevTools listening on (ws:\/\/\S+)/u.exec(output)
      if (match) resolve(match[1] as string)
    })
    browser?.once("exit", () => reject(new Error(`Chromium exited: ${output}`)))
  })
}

describe.skipIf(!available)("DomTab", () => {
  beforeAll(async () => {
    connection = await CdpConnection.connect(await launch())
    // The page target can appear after the browser publishes its endpoint.
    let page: Awaited<ReturnType<CdpConnection["targets"]>>[number] | undefined
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
      page = (await connection.targets()).find((target) => target.url.endsWith("app.html"))
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!page) throw new Error("page target missing")
    transport = await connection.attach(page.targetId)
    // Desktop evaluates through Electron's executeJavaScript; Runtime.evaluate behaves alike.
    tab = new DomTab(
      {
        evaluate: async (expression) => {
          const response = await transport.send<{
            result: { value?: unknown }
            exceptionDetails?: { text: string }
          }>("Runtime.evaluate", { awaitPromise: true, expression, returnByValue: true })
          if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
          return response.result.value
        },
        screenshot: async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" }),
      },
      "linux"
    )
  }, 30_000)

  afterAll(() => {
    connection?.close()
    browser?.kill()
    if (directory) rmSync(directory, { force: true, recursive: true })
  })

  it("reads the document and evaluates functions without eval", async () => {
    expect(await tab.call("tab.info", [])).toMatchObject({ title: "App" })
    expect(await tab.call("playwright.evaluate", ["(n) => document.title + n", 1])).toBe("App1")
    expect(await tab.call("playwright.domSnapshot", [])).toContain('<select id="color">')
    expect(await tab.call("locator.count", [], { selector: "li" })).toBe(2)
    expect(await tab.call("locator.allTextContents", [], { selector: "li" })).toEqual([
      "One",
      "Two",
    ])
    expect(
      await tab.call("locator.evaluate", ["(e, suffix) => e.id + suffix", "!"], {
        selector: "#go",
      })
    ).toBe("go!")
    expect(
      await tab.call("locator.evaluateAll", ["(items) => items.length", null], { selector: "li" })
    ).toBe(2)
  })

  it("fills, types, presses, clicks, checks, and selects with DOM events", async () => {
    await tab.call("locator.fill", ["Ada"], { selector: 'internal:label="Name"i' })
    await tab.call("locator.pressSequentially", [" L"], { selector: "#name" })
    await tab.call("locator.click", [], { selector: "#go" })
    expect(await tab.call("locator.textContent", [], { selector: "#out" })).toBe("clicked Ada L")
    await tab.call("locator.press", ["Enter"], { selector: "#name" })
    expect(await tab.call("locator.textContent", [], { selector: "#out" })).toBe("sent Ada L")
    await tab.call("locator.check", [], { selector: "#agree" })
    expect(await tab.call("playwright.evaluate", ["() => agree.checked", null])).toBe(true)
    await tab.call("locator.uncheck", [], { selector: "#agree" })
    expect(await tab.call("playwright.evaluate", ["() => agree.checked", null])).toBe(false)
    expect(await tab.call("locator.selectOption", [["Green"]], { selector: "#color" })).toEqual([
      "g",
    ])
  })

  it("reports strict mode, disabled elements, and unsupported members", async () => {
    await expect(tab.call("locator.click", [], { selector: "li" })).rejects.toMatchObject({
      code: "strict_mode",
    })
    await expect(
      tab.call("locator.click", [{ timeoutMs: 300 }], { selector: "text=Off" })
    ).rejects.toMatchObject({ code: "timeout", message: expect.stringContaining("disabled") })
    expect(await tab.call("locator.isEnabled", [], { selector: "text=Off" })).toBe(false)
    expect(await tab.call("tab.screenshot", [])).toMatchObject({ dataBase64: "AQID" })
    await expect(tab.call("tab.goto", ["https://example.com"])).rejects.toMatchObject({
      code: "unsupported",
    })
  })
})
