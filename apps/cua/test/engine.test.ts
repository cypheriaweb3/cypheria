import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { chromium } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { CdpConnection } from "../src/engine/cdp-connection.ts"
import { CdpTab, VirtualClipboard } from "../src/engine/tab.ts"

const executable = chromium.executablePath()
const available = existsSync(executable)

const PAGE = `<!doctype html>
<title>Engine test</title>
<h1>Form</h1>
<label>Name <input id="name"></label>
<label><input type="checkbox" id="agree"> Agree</label>
<select id="color"><option value="r">Red</option><option value="g">Green</option></select>
<button id="go" onclick="document.getElementById('out').textContent = 'clicked ' + document.getElementById('name').value">Submit</button>
<p id="out"></p>
<textarea id="notes">alpha beta gamma</textarea>
<button id="alert" onclick="window.answer = confirm('Proceed?')">Ask</button>
<input type="file" id="upload">
<iframe id="frame" srcdoc="<button onclick='parent.framed = true'>Inside</button>"></iframe>
<a href="#second" id="link">Next</a>`

let browser: ChildProcess | undefined
let connection: CdpConnection | undefined
let tab: CdpTab
let directory: string

const launch = async (): Promise<string> => {
  directory = mkdtempSync(join(tmpdir(), "cua-engine-"))
  writeFileSync(join(directory, "page.html"), PAGE)
  mkdirSync(join(directory, "work"))
  writeFileSync(join(directory, "work", "upload.txt"), "upload")
  browser = spawn(
    executable,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(directory, "profile")}`,
      `file://${join(directory, "page.html")}`,
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

describe.skipIf(!available)("CdpTab", () => {
  beforeAll(async () => {
    connection = await CdpConnection.connect(await launch())
    const page = (await connection.targets()).find((target) => target.url.endsWith("page.html"))
    if (!page) throw new Error("page target missing")
    tab = new CdpTab(await connection.attach(page.targetId), "linux", {
      clipboard: new VirtualClipboard(),
    })
    await tab.call("playwright.waitForLoadState", [{ state: "load" }])
  }, 30_000)

  afterAll(() => {
    tab?.dispose()
    connection?.close()
    browser?.kill()
    if (directory) rmSync(directory, { force: true, recursive: true })
  })

  const state = async () => ((await tab.call("ax.get", ["state"])) as { state: string }).state
  const indexOf = (text: string, label: string) => {
    const line = text.split("\n").find((candidate) => candidate.includes(label))
    const match = line ? /\[(\d+)\]/u.exec(line) : null
    if (!match) throw new Error(`no index for ${label} in:\n${text}`)
    return Number(match[1])
  }
  const read = (expression: string) => tab.call("playwright.evaluate", [expression, undefined])

  it("renders the accessibility state with numeric indices, frames included", async () => {
    const text = await state()
    expect(text).toContain("Title: Engine test")
    expect(text).toMatch(/textbox "Name" \[\d+\]/u)
    expect(text).toMatch(/button "Submit" \[\d+\]/u)
    expect(text).toMatch(/button "Inside" \[\d+\]/u)
  })

  it("keeps an element's index across states", async () => {
    const first = indexOf(await state(), 'button "Submit"')
    const second = indexOf(await state(), 'button "Submit"')
    expect(second).toBe(first)
  })

  it("types, sets values, and clicks by index", async () => {
    let text = await state()
    await tab.call("ax.setValue", [indexOf(text, 'textbox "Name"'), "Ada"])
    await tab.call("ax.typeText", [indexOf(text, 'textbox "Name"'), " L"])
    text = await state()
    await tab.call("ax.click", [indexOf(text, 'button "Submit"')])
    expect(await read("document.getElementById('out').textContent")).toBe("clicked Ada L")
  })

  it("selects text and presses keys", async () => {
    const text = await state()
    const notes = indexOf(text, "textbox")
    const area = text.split("\n").find((line) => line.includes("alpha beta gamma"))
    expect(area).toBeDefined()
    const index = /\[(\d+)\]/u.exec(area as string)?.[1]
    await tab.call("ax.selectText", [Number(index ?? notes), "beta"])
    await tab.call("ax.pressKey", [null, "BackSpace"])
    expect(await read("document.getElementById('notes').value")).toBe("alpha  gamma")
  })

  it("acts through Playwright locators, frames included", async () => {
    await tab.call("locator.fill", ["Grace"], { selector: 'internal:label="Name"i' })
    expect(await read("document.getElementById('name').value")).toBe("Grace")
    await tab.call("locator.check", [], { selector: "#agree" })
    expect(await read("document.getElementById('agree').checked")).toBe(true)
    expect(await tab.call("locator.selectOption", [["Green"]], { selector: "#color" })).toEqual([
      "g",
    ])
    expect(await tab.call("locator.count", [], { selector: "button" })).toBe(2)
    await tab.call("locator.click", [], {
      selector: '#frame >> internal:control=enter-frame >> internal:role=button[name="Inside"i]',
    })
    expect(await read("window.framed")).toBe(true)
    await expect(
      tab.call("locator.click", [{ timeoutMs: 500 }], { selector: "button" })
    ).rejects.toThrow(/matches 2 elements/u)
  })

  it("reports and answers dialogs", async () => {
    const click = tab.call("locator.click", [], { selector: "#alert" })
    await click
    expect(await tab.call("tab.getJsDialog", [])).toMatchObject({
      message: "Proceed?",
      type: "confirm",
    })
    await expect(state()).rejects.toThrow(/showing a confirm dialog/u)
    await tab.call("dialog.accept", [])
    expect(await read("window.answer")).toBe(true)
  })

  it("sets files on a file chooser within the working directory", async () => {
    const chooser = tab.call("playwright.waitForEvent", ["filechooser", { timeoutMs: 5_000 }])
    await tab.call("locator.click", [], { selector: "#upload" })
    const handle = (await chooser) as { handle: string; isMultiple: boolean }
    expect(handle.isMultiple).toBe(false)
    await expect(
      tab.call("fileChooser.setFiles", [["/etc/hosts"]], {
        context: { cwd: join(directory, "work") },
        handle: handle.handle,
      })
    ).rejects.toThrow(/outside/u)
    await tab.call("fileChooser.setFiles", [["upload.txt"]], {
      context: { cwd: join(directory, "work") },
      handle: handle.handle,
    })
    expect(await read("document.getElementById('upload').files[0].name")).toBe("upload.txt")
  })

  it("navigates and waits for URLs", async () => {
    const before = (await tab.call("playwright.navigationCount", [])) as number
    await tab.call("locator.click", [], { selector: "#link" })
    await tab.call("playwright.waitForURL", ["**/page.html#second"])
    expect(await tab.call("playwright.navigationCount", [])).toBeGreaterThan(before)
    expect(((await tab.call("tab.info", [])) as { url: string }).url).toMatch(/#second$/u)
  })

  it("captures screenshots and console logs", async () => {
    await read("console.warn('careful')")
    const shot = (await tab.call("tab.screenshot", [])) as { dataBase64: string; mimeType: string }
    expect(shot.mimeType).toBe("image/png")
    expect(Buffer.from(shot.dataBase64, "base64").subarray(1, 4).toString()).toBe("PNG")
    expect(await tab.call("dev.logs", [{ levels: ["warn"] }])).toEqual([
      expect.objectContaining({ level: "warn", message: "careful" }),
    ])
  })
})
