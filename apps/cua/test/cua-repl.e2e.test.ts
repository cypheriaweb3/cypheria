import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { BrowserHostCall } from "../src/browser/protocol.ts"
import { CuaHost, type DesktopBrowsers } from "../src/host/index.ts"

const root = fileURLToPath(new URL("../", import.meta.url))
const nodeRepl = fileURLToPath(
  new URL(
    `../../node-repl/dist/node_repl${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url
  )
)
const available = existsSync(nodeRepl) && existsSync(join(root, "dist", "cua-repl.mjs"))

/** A built-in browser stand-in with one page whose button changes a heading. */
const fakeDesktop = (): DesktopBrowsers & { clicks: unknown[]; url: string } => {
  const state = { clicks: [] as unknown[], url: "about:blank" }
  return {
    get clicks() {
      return state.clicks
    },
    get url() {
      return state.url
    },
    async call(_context, _backend, call: BrowserHostCall) {
      switch (call.member) {
        case "tabs.new":
          return { id: "tab-1", title: "", url: "about:blank" }
        case "tabs.list":
          return [{ id: "tab-1", title: "Fixture", url: state.url }]
        case "tab.goto":
          state.url = String(call.args[0])
          return null
        case "ax.get":
          return {
            state: [
              "Title: Fixture",
              `URL: ${state.url}`,
              state.clicks.length ? '- heading "Clicked" [level=1]' : '- heading "Hello" [level=1]',
              '- button "Go" [1]',
              ...Array.from({ length: 20 }, (_, index) => `- listitem: Row ${index}`),
            ].join("\n"),
          }
        case "ax.click":
          state.clicks.push(call.args[0])
          return null
        default:
          throw new Error(`unexpected ${call.member}`)
      }
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
    const host = new CuaHost({
      desktop,
      hosts: {
        device: async () => {
          throw new Error("no device requests in this test")
        },
        list: () => [{ capabilities: ["iab", "mcpapps"], id: "desktop-1", name: "Studio Mac" }],
      },
      backends: () => new Set(["iab"]),
      surfaces: () => new Set(["browser"]),
    })
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
        CUA_REPL_BROWSER_BACKENDS: "iab",
        CUA_REPL_ENABLED_SURFACES: "browser",
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

  it("describes only the enabled surfaces and backends", async () => {
    const listed = (await request("tools/list", {})).result as {
      tools: { name: string; description: string }[]
    }
    const js = listed.tools.find((tool) => tool.name === "js")
    expect(js?.description).toContain("cua.createBrowserTab(browserId, url")
    expect(js?.description).toContain('`"iab"`')
    expect(js?.description).not.toContain('`"mcpapps"`')
    expect(js?.description).not.toContain('cua.getApp("Calendar")')
    expect(js?.description).toContain("native apps (`cua.getApp`)")
  })

  it("opens a tab, shows documentation once, and diffs later states", async () => {
    const first = (await request("tools/call", {
      arguments: { code: 'let tab = await cua.createBrowserTab("iab", "localhost:3000");' },
      name: "js",
    })) as { result: { content: { text: string }[]; isError: boolean } }
    const firstText = first.result.content.map((item) => item.text).join("\n")
    expect(first.result.isError).toBe(false)
    expect(firstText).toContain("## Computer use")
    expect(firstText).toContain("## Cypheria's built-in browser (`iab`)")
    expect(firstText).toContain('heading "Hello"')
    expect(desktop.url).toBe("http://localhost:3000")

    const second = (await request("tools/call", {
      arguments: { code: "await tab.click(1); await tab.getAXState();" },
      name: "js",
    })) as { result: { content: { text: string }[]; isError: boolean } }
    const secondText = second.result.content.map((item) => item.text).join("\n")
    expect(desktop.clicks).toEqual([1])
    expect(secondText).not.toContain("## Computer use")
    expect(secondText).toContain('- - heading "Hello" [level=1]')
    expect(secondText).toContain('+ - heading "Clicked" [level=1]')
  }, 30_000)

  it("exposes the agent API with only supported members", async () => {
    const result = (await request("tools/call", {
      arguments: {
        code: 'const b = await agent.browsers.get("iab"); nodeRepl.write(JSON.stringify({ user: b.user === undefined, tabs: typeof b.tabs.new }));',
      },
      name: "js",
    })) as { result: { content: { text: string }[]; isError: boolean } }
    expect(result.result.content.map((item) => item.text).join("\n")).toContain(
      '{"user":true,"tabs":"function"}'
    )
  })

  it("reports disabled surfaces", async () => {
    const result = (await request("tools/call", {
      arguments: { code: 'await cua.getApp("Calendar");' },
      name: "js",
    })) as { result: { content: { text: string }[]; isError: boolean } }
    expect(result.result.isError).toBe(true)
    expect(result.result.content[0]?.text).toContain("Native app control is disabled")
  })
})
