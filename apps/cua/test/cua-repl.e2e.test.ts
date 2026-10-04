import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { CuaHost, type DesktopSurfaces } from "../src/host/index.ts"
import type { IabTabInfo } from "../src/protocol.ts"

const root = fileURLToPath(new URL("../", import.meta.url))
const nodeRepl = fileURLToPath(
  new URL(
    `../../node-repl/dist/node_repl${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url
  )
)
const available = existsSync(nodeRepl) && existsSync(join(root, "dist", "cua-repl.mjs"))

/** A built-in browser stand-in with one page whose button changes a heading. */
const fakeDesktop = (): DesktopSurfaces & { clicks: string[] } => {
  const tabs: IabTabInfo[] = []
  const clicks: string[] = []
  return {
    clicks,
    async command(_context, tabId, command, args) {
      if (command === "snapshot") {
        return {
          result: {
            snapshot: [
              clicks.length ? '- heading "Clicked"' : '- heading "Hello"',
              '- button "Go" [ref=e1]',
              ...Array.from({ length: 20 }, (_, index) => `- listitem "Row ${index}"`),
            ].join("\n"),
            title: "Fixture",
            truncated: false,
            url: tabs.find((tab) => tab.id === tabId)?.url ?? "",
          },
        }
      }
      if (command === "click") {
        clicks.push(String(args.ref))
        return { result: {} }
      }
      throw new Error(`unexpected ${command}`)
    },
    async listMcpApps() {
      return []
    },
    async listTabs() {
      return tabs
    },
    async mcpApp() {
      return {}
    },
    async newTab(_context, options) {
      const tab = {
        active: true,
        id: "11111111-1111-4111-8111-111111111111",
        kind: options.kind,
        title: "",
        url: options.url ?? "about:blank",
      }
      tabs.push(tab)
      return tab
    },
  }
}

describe.skipIf(!available)("cua_repl end to end", () => {
  let directory: string
  let server: Server
  let child: ChildProcessWithoutNullStreams
  const desktop = fakeDesktop()
  const responses = new Map<number, (message: Record<string, unknown>) => void>()
  let nextId = 0

  const request = (method: string, params: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = ++nextId
      responses.set(id, resolve)
      child.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`)
    })

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "cua-e2e-"))
    const pipe = join(directory, "host.sock")
    const host = new CuaHost({ desktop, surfaces: () => new Set(["iab"]) })
    server = createServer((socket) => {
      createInterface({ input: socket }).on("line", async (line) => {
        const message = JSON.parse(line)
        try {
          const result =
            message.method === "cua"
              ? await host.handle(message.params, { threadId: "thread-1" })
              : {}
          socket.write(`${JSON.stringify({ id: message.id, jsonrpc: "2.0", result })}\n`)
        } catch (error) {
          socket.write(
            `${JSON.stringify({ error: { code: -32000, message: (error as Error).message }, id: message.id, jsonrpc: "2.0" })}\n`
          )
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(pipe, resolve))
    child = spawn(process.execPath, [join(root, "dist", "cua-repl.mjs")], {
      env: {
        ...process.env,
        CUA_REPL_ENABLED_SURFACES: "iab",
        CUA_REPL_NODE_REPL_PATH: nodeRepl,
        NODE_REPL_HOST_SERVICES_PIPE_PATH: pipe,
        NODE_REPL_NODE_PATH: process.execPath,
      },
    })
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line)
      responses.get(message.id)?.(message)
    })
    await request("initialize", { capabilities: {}, protocolVersion: "2024-11-05" })
  }, 30_000)

  afterAll(() => {
    child?.kill()
    server?.close()
    rmSync(directory, { force: true, recursive: true })
  })

  it("describes only the enabled surfaces", async () => {
    const listed = (await request("tools/list", {})).result as {
      tools: { name: string; description: string }[]
    }
    const js = listed.tools.find((tool) => tool.name === "js")
    expect(js?.description).toContain("cua.iab.getTab")
    expect(js?.description).not.toContain("cua.getApp(")
    expect(js?.description).toContain("native apps (`cua.getApp`)")
  })

  it("opens a tab, shows documentation once, and diffs later snapshots", async () => {
    const first = (await request("tools/call", {
      arguments: { code: 'let tab = await cua.iab.newTab("localhost:3000");' },
      name: "js",
    })) as { result: { content: { text: string }[]; isError: boolean } }
    const firstText = first.result.content.map((item) => item.text).join("\n")
    expect(first.result.isError).toBe(false)
    expect(firstText).toContain("Computer use in Cypheria")
    expect(firstText).toContain("Built-in browser (`cua.iab`)")
    expect(firstText).toContain('heading "Hello"')
    expect(firstText).toContain("http://localhost:3000")

    const second = (await request("tools/call", {
      arguments: { code: 'await tab.click("e1"); await tab.snapshot();' },
      name: "js",
    })) as { result: { content: { text: string }[]; isError: boolean } }
    const secondText = second.result.content.map((item) => item.text).join("\n")
    expect(desktop.clicks).toEqual(["@e1"])
    expect(secondText).not.toContain("Computer use in Cypheria")
    expect(secondText).toContain('- - heading "Hello"')
    expect(secondText).toContain('+ - heading "Clicked"')
  }, 30_000)

  it("reports disabled surfaces", async () => {
    const result = (await request("tools/call", {
      arguments: { code: 'await cua.getApp("Calendar");' },
      name: "js",
    })) as { result: { content: { text: string }[]; isError: boolean } }
    expect(result.result.isError).toBe(true)
    expect(result.result.content[0]?.text).toContain("Native app control is disabled")
  })
})
