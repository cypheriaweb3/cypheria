import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import type { AgentBrowserResponse } from "../src/host/external/agent-browser.ts"
import { ExternalBrowsersBackend } from "../src/host/external/backend.ts"
import { readDevToolsActivePort } from "../src/host/external/discovery.ts"

const directories: string[] = []
const scratch = () => {
  const directory = mkdtempSync(join(tmpdir(), "cua-ext-"))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

const ok = (data: Record<string, unknown>): AgentBrowserResponse => ({
  data,
  error: null,
  success: true,
})

/** A browser with one user tab; records every agent-browser invocation. */
const fakeBrowser = () => {
  const calls: string[][] = []
  const tabs = [{ targetId: "USER", title: "Inbox", type: "page", url: "https://mail.example" }]
  const runner = async (args: readonly string[]) => {
    const command = args.slice(args.indexOf("15m") + 1)
    calls.push(command)
    if (command[0] === "tab" && command[1] === "list") return ok({ tabs })
    if (command[0] === "tab" && command[1] === "new") {
      tabs.push({ targetId: "NEW", title: "", type: "page", url: command[2] ?? "about:blank" })
      return ok({ targetId: "NEW", url: command[2] })
    }
    if (command[0] === "tab" && command[1] === "close") return ok({ closed: true })
    if (command[0] === "tab") return ok({ targetId: command[1] })
    if (command[0] === "snapshot") return ok({ snapshot: '- button "Send" [ref=e1]' })
    if (command[0] === "get") return ok({ title: "Inbox" })
    return ok({})
  }
  const backend = new ExternalBrowsersBackend({
    installations: () => [
      { executables: [], family: "chrome", name: "Google Chrome", userDataDir: process.cwd() },
    ],
    isPortOpen: async () => true,
    readEndpoint: async () => ({
      port: 9222,
      webSocketUrl: "ws://127.0.0.1:9222/devtools/browser/x",
    }),
    runner,
    scratchDir: scratch(),
  })
  return { backend, calls }
}

describe("external browsers", () => {
  it("reads the DevTools endpoint a browser publishes", async () => {
    const directory = scratch()
    writeFileSync(join(directory, "DevToolsActivePort"), "9333\n/devtools/browser/abc\n")
    await expect(readDevToolsActivePort(directory)).resolves.toEqual({
      port: 9333,
      webSocketUrl: "ws://127.0.0.1:9333/devtools/browser/abc",
    })
    writeFileSync(join(directory, "DevToolsActivePort"), "nope\n")
    await expect(readDevToolsActivePort(directory)).resolves.toBeNull()
  })

  it("acts only in tabs the Thread opened or claimed", async () => {
    const { backend, calls } = fakeBrowser()
    await expect(backend.act("thread", "chrome", "USER", { type: "snapshot" })).rejects.toThrow(
      /does not control/
    )
    await backend.claim("thread", "chrome", "USER")
    const snapshot = await backend.act("thread", "chrome", "USER", { type: "snapshot" })
    expect(snapshot.text).toContain("Send")
    expect(calls).toContainEqual(["tab", "USER"])
    expect(calls).toContainEqual(["snapshot", "-c"])
    await expect(backend.act("other", "chrome", "USER", { type: "snapshot" })).rejects.toThrow(
      /does not control/
    )
  })

  it("closes unmarked owned tabs and releases claimed ones at the end of a turn", async () => {
    const { backend, calls } = fakeBrowser()
    await backend.claim("thread", "chrome", "USER")
    const opened = await backend.newTab("thread", "chrome", "https://example.com")
    expect(opened.id).toBe("NEW")
    await backend.turnEnded("thread")
    expect(calls).toContainEqual(["tab", "close", "NEW"])
    expect(calls).not.toContainEqual(["tab", "close", "USER"])
    await expect(backend.act("thread", "chrome", "USER", { type: "snapshot" })).rejects.toThrow(
      /does not control/
    )
  })

  it("keeps marked tabs until a later turn uses the browser without marking them again", async () => {
    const { backend, calls } = fakeBrowser()
    await backend.newTab("thread", "chrome")
    await backend.act("thread", "chrome", "NEW", { disposition: "deliverable", type: "mark" })
    await backend.turnEnded("thread")
    await backend.turnEnded("thread")
    expect(calls).not.toContainEqual(["tab", "close", "NEW"])
    await backend.tabs("thread", "chrome")
    await backend.turnEnded("thread")
    expect(calls).toContainEqual(["tab", "close", "NEW"])
  })

  it("translates actions into agent-browser commands", async () => {
    const { backend, calls } = fakeBrowser()
    await backend.newTab("thread", "chrome")
    await backend.act("thread", "chrome", "NEW", { key: "Enter", ref: "@e2", type: "press" })
    await backend.act("thread", "chrome", "NEW", { target: [10, 20], type: "click" })
    expect(await backend.act("thread", "chrome", "NEW", { type: "get", what: "title" })).toEqual({
      value: "Inbox",
    })
    expect(calls).toContainEqual(["focus", "@e2"])
    expect(calls).toContainEqual(["press", "Enter"])
    expect(calls).toContainEqual(["mouse", "move", "10", "20"])
    await expect(
      backend.act(
        "thread",
        "chrome",
        "NEW",
        { paths: ["../secret"], ref: "@e1", type: "upload" },
        "/work"
      )
    ).rejects.toThrow(/inside \/work/)
  })

  it("explains how to enable a browser that is not reachable", async () => {
    const backend = new ExternalBrowsersBackend({
      installations: () => [
        { executables: [], family: "edge", name: "Microsoft Edge", userDataDir: process.cwd() },
      ],
      readEndpoint: async () => null,
      runner: async () => ok({}),
      scratchDir: scratch(),
    })
    const [edge] = await backend.list()
    expect(edge?.connectable).toBe(false)
    expect(edge?.setup).toContain("edge://inspect/#remote-debugging")
  })
})
