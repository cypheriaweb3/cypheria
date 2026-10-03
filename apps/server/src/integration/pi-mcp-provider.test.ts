import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type PiCli, PiMcpProvider } from "./pi-mcp-provider.js"

const report = (home: string) => ({
  errors: [],
  servers: [
    {
      enabled: true,
      exposure: "codemode",
      name: "echo",
      scope: "global",
      source: join(home, "mcp.json"),
      state: "connected",
      tools: ["echo"],
      transport: "node server.js",
    },
    {
      enabled: true,
      error: "Sign-in required",
      exposure: "codemode",
      name: "docs",
      resourceTemplates: 1,
      resources: 2,
      scope: "global",
      source: join(home, "mcp.json"),
      state: "needs-auth",
      tools: [],
      transport: "https://example.com/mcp",
    },
    {
      enabled: false,
      exposure: "codemode",
      name: "local",
      scope: "project",
      source: "/repo/.pi/mcp.json",
      state: "disabled",
      tools: [],
      transport: "uvx tools",
    },
  ],
})

describe("PiMcpProvider", () => {
  let home: string
  let run: ReturnType<typeof vi.fn<PiCli["run"]>>
  let spec: ReturnType<typeof vi.fn<PiCli["spec"]>>
  let provider: PiMcpProvider

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cypheria-pi-mcp-"))
    run = vi.fn<PiCli["run"]>(async (args) =>
      args[1] === "list"
        ? { exitCode: 1, stderr: "", stdout: JSON.stringify(report(home)) }
        : { exitCode: 0, stderr: "", stdout: "" }
    )
    spec = vi.fn<PiCli["spec"]>()
    provider = new PiMcpProvider({ home, run, spec })
  })

  afterEach(async () => {
    provider.dispose()
    await rm(home, { force: true, recursive: true })
  })

  it("lists servers from the CLI report even when one is not connected", async () => {
    const { servers } = await provider.list()
    expect(run).toHaveBeenCalledWith(["mcp", "list", "--json"], { timeoutMs: 120_000 })
    expect(servers).toEqual([
      expect.objectContaining({
        authStatus: "unsupported",
        compatibility: ["pi"],
        configurable: true,
        harness: { agentId: "pi", nativeId: "echo" },
        runtimeStatus: "connected",
        tools: [{ appScope: null, description: null, name: "echo" }],
      }),
      expect.objectContaining({
        authStatus: "notLoggedIn",
        configurable: true,
        resourceCount: 3,
        runtimeStatus: "authenticationRequired",
      }),
      expect.objectContaining({
        configurable: false,
        enabled: false,
        name: "local",
        runtimeStatus: "disabled",
      }),
    ])
  })

  it("reports the CLI error when it prints no report", async () => {
    run.mockResolvedValueOnce({ exitCode: 1, stderr: "Invalid mcp.json\n", stdout: "" })
    await expect(provider.list()).rejects.toThrow("Invalid mcp.json")
  })

  it("adds HTTP servers through the CLI and refuses duplicate names", async () => {
    await provider.add("search", "https://search.example.com/mcp")
    expect(run).toHaveBeenLastCalledWith([
      "mcp",
      "add",
      "search",
      "--url",
      "https://search.example.com/mcp",
    ])
    await expect(provider.add("echo", "https://example.com/mcp")).rejects.toThrow("already exists")
  })

  it("changes only the enabled field of servers in its own mcp.json", async () => {
    const path = join(home, "mcp.json")
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: { docs: { url: "https://example.com/mcp" }, echo: { command: "node" } },
        other: true,
      })
    )
    await provider.setEnabled("echo", false)
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      mcpServers: {
        docs: { url: "https://example.com/mcp" },
        echo: { command: "node", enabled: false },
      },
      other: true,
    })
    await provider.setEnabled("echo", true)
    expect(JSON.parse(await readFile(path, "utf8")).mcpServers.echo).toEqual({ command: "node" })
    await expect(provider.setEnabled("local", true)).rejects.toThrow("not configured in Cypheria")
  })

  it("returns the authorization page that pi mcp login prints and keeps it waiting", async () => {
    spec.mockResolvedValue({
      args: [
        "-e",
        `console.log('Sign in to MCP server "docs" in your browser:\\nhttps://auth.example.com/authorize?state=1'); setTimeout(() => {}, 60000)`,
      ],
      command: process.execPath,
      cwd: home,
      env: { PATH: process.env.PATH ?? "" },
    })
    await expect(provider.login("docs")).resolves.toEqual({
      authorizationUrl: "https://auth.example.com/authorize?state=1",
    })
    expect(spec).toHaveBeenCalledWith(["mcp", "login", "docs", "--timeout", "300"])
  })

  it("refuses sign-in for stdio servers and reports servers that are already signed in", async () => {
    await expect(provider.login("echo")).rejects.toThrow("not available")
    spec.mockResolvedValue({
      args: ["-e", `console.log('Already signed in to MCP server "docs" (3 tools).')`],
      command: process.execPath,
      cwd: home,
      env: { PATH: process.env.PATH ?? "" },
    })
    await expect(provider.login("docs")).rejects.toThrow("already signed in")
  })
})
