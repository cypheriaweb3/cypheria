import { type ChildProcess, spawn } from "node:child_process"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { delimiter, join } from "node:path"
import { IntegrationIdSchema, type McpServerView } from "@cypheria/protocol"
import { z } from "zod"

import { webUrl } from "./plugin-utils.js"

type CliResult = { exitCode: number; stderr: string; stdout: string }
type CliSpec = { args: string[]; command: string; cwd: string; env: Record<string, string> }

/** The managed Pi CLI, run inside Cypheria's `PI_CODING_AGENT_DIR`. */
export type PiCli = {
  readonly home: string
  run(args: string[], options?: { timeoutMs?: number }): Promise<CliResult>
  spec(args: string[]): Promise<CliSpec>
}

/** One server in `pi mcp list --json`. */
const PiMcpReportSchema = z
  .object({
    enabled: z.boolean(),
    error: z.string().optional(),
    name: z.string().min(1),
    resourceTemplates: z.number().int().nonnegative().optional(),
    resources: z.number().int().nonnegative().optional(),
    scope: z.string(),
    source: z.string().optional(),
    state: z.string(),
    tools: z.array(z.string()).default([]),
    transport: z.string().default(""),
  })
  .passthrough()

const PiMcpListSchema = z
  .object({ errors: z.array(z.unknown()).default([]), servers: z.array(PiMcpReportSchema) })
  .passthrough()

const PiMcpConfigSchema = z
  .object({ mcpServers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}) })
  .passthrough()

const runtimeStatus = (state: string): McpServerView["runtimeStatus"] => {
  switch (state) {
    case "connected":
      return "connected"
    case "connecting":
      return "starting"
    case "needs-auth":
      return "authenticationRequired"
    case "failed":
      return "failed"
    case "disabled":
      return "disabled"
    case "disconnected":
    case "inactive":
      return "notStarted"
    default:
      return null
  }
}

const isHttp = (transport: string) => /^https?:\/\//iu.test(transport)

/** How long a sign-in waits for the browser, matching `pi mcp login`'s default. */
const LOGIN_TIMEOUT_SECONDS = 300
/** How long the CLI may take to print the authorization page. */
const LOGIN_URL_TIMEOUT_MS = 60_000

/**
 * Pi's MCP servers, managed through the managed Pi CLI's `pi mcp` commands. Pi keeps its servers
 * in `mcp.json` and its OAuth credentials in `mcp-auth.json` under its home; Server reads both only
 * through the CLI, except the `enabled` switch, which Pi's own `/mcp` also writes into `mcp.json`
 * because no command changes it.
 */
export class PiMcpProvider {
  readonly #cli: PiCli
  readonly #logins = new Map<string, ChildProcess>()

  constructor(cli: PiCli) {
    this.#cli = cli
  }

  get #configPath(): string {
    return join(this.#cli.home, "mcp.json")
  }

  async list(): Promise<{ servers: McpServerView[] }> {
    // `pi mcp list` connects to every enabled server and exits 1 when one is not connected; the
    // report on stdout is complete either way.
    const result = await this.#cli.run(["mcp", "list", "--json"], { timeoutMs: 120_000 })
    let report: z.infer<typeof PiMcpListSchema>
    try {
      report = PiMcpListSchema.parse(JSON.parse(result.stdout))
    } catch {
      throw new Error(result.stderr.trim() || "Pi did not report its MCP servers")
    }
    return {
      servers: report.servers.map((server) => {
        const http = isHttp(server.transport)
        const status = server.enabled ? runtimeStatus(server.state) : "disabled"
        return {
          authStatus: !http
            ? "unsupported"
            : status === "authenticationRequired"
              ? "notLoggedIn"
              : "unknown",
          compatibility: ["pi"],
          configurable:
            server.scope === "global" &&
            server.source === this.#configPath &&
            IntegrationIdSchema.safeParse(server.name).success,
          enabled: server.enabled,
          harness: { agentId: "pi", nativeId: server.name },
          name: server.name,
          pluginId: null,
          resourceCount: (server.resources ?? 0) + (server.resourceTemplates ?? 0),
          runtimeStatus: status,
          tools: server.tools.map((name) => ({ appScope: null, description: null, name })),
        }
      }),
    }
  }

  async add(name: string, url: string): Promise<void> {
    IntegrationIdSchema.parse(name)
    if ((await this.list()).servers.some((server) => server.name === name)) {
      throw new Error("An MCP server with this name already exists")
    }
    const result = await this.#cli.run(["mcp", "add", name, "--url", url])
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Pi could not add the MCP server ${name}`)
    }
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    IntegrationIdSchema.parse(name)
    const server = (await this.list()).servers.find((candidate) => candidate.name === name)
    if (!server?.configurable) throw new Error("This MCP server is not configured in Cypheria")
    const config = PiMcpConfigSchema.parse(JSON.parse(await readFile(this.#configPath, "utf8")))
    const entry = config.mcpServers[name]
    if (!entry) throw new Error("This MCP server is not configured in Cypheria")
    if (enabled) delete entry.enabled
    else entry.enabled = false
    const temporary = `${this.#configPath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.#configPath)
  }

  /**
   * Starts `pi mcp login` and returns its authorization page for the client to open. The CLI
   * keeps waiting for the browser's loopback callback on this computer, as Codex's login does.
   */
  async login(name: string): Promise<{ authorizationUrl: string }> {
    IntegrationIdSchema.parse(name)
    const server = (await this.list()).servers.find((candidate) => candidate.name === name)
    if (!server || server.enabled === false || server.authStatus === "unsupported") {
      throw new Error("OAuth login is not available for this MCP server")
    }
    this.#logins.get(name)?.kill("SIGTERM")
    const spec = await this.#cli.spec([
      "mcp",
      "login",
      name,
      "--timeout",
      String(LOGIN_TIMEOUT_SECONDS),
    ])
    const launchers = await this.#noBrowserDirectory()
    if (launchers) spec.env.PATH = [launchers, spec.env.PATH].filter(Boolean).join(delimiter)
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#logins.set(name, child)
    child.once("close", () => {
      if (this.#logins.get(name) === child) this.#logins.delete(name)
    })
    return await new Promise((resolve, reject) => {
      let output = ""
      let errors = ""
      const timer = setTimeout(() => {
        child.kill("SIGTERM")
        reject(new Error("Pi did not start the sign-in"))
      }, LOGIN_URL_TIMEOUT_MS)
      const settle = (outcome: () => void) => {
        clearTimeout(timer)
        outcome()
      }
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8")
        const match = /in your browser:\s*(\S+)/u.exec(output)
        const authorizationUrl = match?.[1] ? webUrl(match[1]) : null
        if (authorizationUrl) settle(() => resolve({ authorizationUrl }))
      })
      child.stderr?.on("data", (chunk: Buffer) => {
        errors += chunk.toString("utf8")
      })
      child.once("error", (error) => settle(() => reject(error)))
      child.once("close", (code) => {
        settle(() =>
          reject(
            new Error(
              code === 0
                ? "This MCP server is already signed in"
                : errors.trim() || `Pi could not sign in to ${name}`
            )
          )
        )
      })
    })
  }

  /** Stops sign-ins that are still waiting for the browser. */
  dispose(): void {
    for (const child of this.#logins.values()) child.kill("SIGTERM")
    this.#logins.clear()
  }

  /**
   * `pi mcp login` also opens the page in this computer's browser. The client opens it instead,
   * which also works for remote clients, so the launcher Pi calls is replaced by one that does
   * nothing. Windows launches through `rundll32`, which cannot be replaced this way.
   */
  async #noBrowserDirectory(): Promise<string | null> {
    if (process.platform === "win32") return null
    const directory = join(this.#cli.home, ".cypheria", "no-browser")
    await mkdir(directory, { recursive: true })
    for (const launcher of ["open", "xdg-open"]) {
      const path = join(directory, launcher)
      await writeFile(path, "#!/bin/sh\nexit 0\n")
      await chmod(path, 0o755)
    }
    return directory
  }
}
