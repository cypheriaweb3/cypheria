import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MAGPIE_DEFAULT_API_PORT, MAGPIE_DEFAULT_GATEWAY_PORT } from "@cypheria/protocol"
import { MAGPIE_RELEASE } from "@cypheria/protocol/magpie-api"
import pino from "pino"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { type AgentLaunchSpec, launcherArgs } from "../agent/agent-manager.js"
import { buildRuntimePaths } from "../runtime/index.js"
import { MagpieManager, magpieAgentsFile, magpieAsset } from "./magpie-manager.js"
import { MagpieService } from "./magpie-service.js"

const logger = pino({ level: "silent" })

describe("magpie's agents file", () => {
  it("keeps the launcher of each kind of Agent, without its ACP mode", () => {
    expect(launcherArgs({ args: ["acp"], kind: "binary", source: "https://x/cursor.tgz" })).toEqual(
      []
    )
    expect(
      launcherArgs({
        args: ["/npx-cli.js", "--yes", "--offline", "@xai-official/grok@1.0.45", "agent", "stdio"],
        kind: "npx",
        source: "@xai-official/grok@1.0.45",
      })
    ).toEqual(["/npx-cli.js", "--yes", "--offline", "@xai-official/grok@1.0.45"])
    expect(
      launcherArgs({ args: ["/codex.js"], kind: "npx", source: "@openai/codex@0.159.2" })
    ).toEqual(["/codex.js"])
  })

  it("lists the Agents by magpie's id, as Cypheria launches them", () => {
    const specs: AgentLaunchSpec[] = [
      {
        agentId: "codex",
        args: ["/codex.js"],
        command: "/node",
        cwd: "/home/codex",
        env: { CODEX_HOME: "/home/codex" },
      },
      { agentId: "grok-build", args: [], command: "/grok", cwd: null, env: {} },
      { agentId: "github-copilot-cli", args: [], command: "/copilot", cwd: null, env: {} },
    ]
    expect(magpieAgentsFile(specs)).toEqual({
      agents: {
        codex: {
          args: ["/codex.js"],
          command: "/node",
          cwd: "/home/codex",
          env: { CODEX_HOME: "/home/codex" },
        },
        copilot: { command: "/copilot" },
        grok: { command: "/grok" },
      },
      version: 1,
    })
  })

  it("names the terminal build of each platform", () => {
    expect(magpieAsset("darwin-arm64")).toBe("magpie-cli-darwin-arm64")
    expect(magpieAsset("linux-x64")).toBe("magpie-cli-linux-amd64")
    expect(magpieAsset("win32-x64")).toBe("magpie-cli-windows-amd64.exe")
  })
})

// A magpie of its own for the lifecycle: `web --addr host:port` serving the
// bits of magpie's API the manager asks, behind MAGPIE_WEB_KEY; what it was
// started with and asked goes to a log beside it.
const FAKE_MAGPIE = `
const http = require("node:http")
const fs = require("node:fs")
const log = (line) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(line) + "\\n")
const addr = process.argv[process.argv.indexOf("--addr") + 1]
const [host, port] = addr.split(":")
log({ argv: process.argv.slice(2), env: {
  MAGPIE_ADDR: process.env.MAGPIE_ADDR, MAGPIE_AGENTS_FILE: process.env.MAGPIE_AGENTS_FILE,
  MAGPIE_HOME: process.env.MAGPIE_HOME } })
http.createServer((req, res) => {
  if (req.headers.authorization !== "Bearer " + process.env.MAGPIE_WEB_KEY) { res.writeHead(401); return res.end() }
  log({ request: req.method + " " + req.url })
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/openapi.json") return res.end("{}")
  res.end(JSON.stringify({ agents: [{ id: "codex", name: "Codex", icon: "codex", path: "/x/config.toml",
    fields: [], drift: { kind: "unwired", field: "model", want: "", detail: "" } }] }))
}).listen(Number(port), host)
`

describe.skipIf(process.platform === "win32")("MagpieManager", () => {
  let home: string
  let fakeLog: string
  let previousLog: string | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cypheria-magpie-"))
    fakeLog = join(home, "fake.log")
    previousLog = process.env.FAKE_LOG
    process.env.FAKE_LOG = fakeLog
    const executable = join(home, "toolchains", "magpie", MAGPIE_RELEASE.version, "magpie")
    await mkdir(join(executable, ".."), { recursive: true })
    await writeFile(join(home, "fake-magpie.cjs"), FAKE_MAGPIE)
    await writeFile(
      executable,
      `#!/bin/sh\nexec "${process.execPath}" "${join(home, "fake-magpie.cjs")}" "$@"\n`
    )
    await chmod(executable, 0o755)
  })

  afterEach(async () => {
    process.env.FAKE_LOG = previousLog
    await rm(home, { force: true, recursive: true })
  })

  const manager = (taken: number[] = []) =>
    new MagpieManager({
      download: async () => {
        throw new Error("no download in tests")
      },
      launchSpecs: async () => [
        { agentId: "codex", args: [], command: "/codex", cwd: null, env: { CODEX_HOME: "/c" } },
      ],
      logger,
      paths: buildRuntimePaths({ env: { CYPHERIA_HOME: home } }),
      portAvailable: async (port) => !taken.includes(port),
    })

  const logged = async () =>
    (await readFile(fakeLog, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as { argv?: string[]; env?: Record<string, string>; request?: string }
      )

  it("stays off until it is turned on", async () => {
    const m = manager()
    await m.init()
    expect(m.view()).toMatchObject({
      gatewayUrl: null,
      installedVersion: MAGPIE_RELEASE.version,
      status: "stopped",
    })
    expect(m.view().config).toEqual({
      apiPort: MAGPIE_DEFAULT_API_PORT,
      enabled: false,
      gatewayPort: MAGPIE_DEFAULT_GATEWAY_PORT,
    })
  })

  it("runs over Cypheria's Agents, moving off taken ports", async () => {
    // the default gateway port is someone else's: it moves to the next one
    const m = manager([MAGPIE_DEFAULT_GATEWAY_PORT, MAGPIE_DEFAULT_GATEWAY_PORT + 1])
    await m.init()
    // the test's free ports, away from the defaults the machine may use
    const view = await m.setEnabled(true)
    expect(view.status).toBe("ready")
    expect(view.config.gatewayPort).toBe(MAGPIE_DEFAULT_GATEWAY_PORT + 2)
    expect(view.config.apiPort).toBe(MAGPIE_DEFAULT_API_PORT + 2)
    expect(view.gatewayUrl).toBe(`http://127.0.0.1:${MAGPIE_DEFAULT_GATEWAY_PORT + 2}`)

    const saved = JSON.parse(await readFile(join(home, "gateway", "cypheria.json"), "utf8"))
    expect(saved).toEqual({
      apiPort: MAGPIE_DEFAULT_API_PORT + 2,
      enabled: true,
      gatewayPort: MAGPIE_DEFAULT_GATEWAY_PORT + 2,
    })
    const agents = JSON.parse(await readFile(join(home, "gateway", "agents.json"), "utf8"))
    expect(agents).toEqual({
      agents: { codex: { command: "/codex", env: { CODEX_HOME: "/c" } } },
      version: 1,
    })

    const lines = await logged()
    expect(lines[0]?.argv).toEqual([
      "web",
      "--addr",
      `127.0.0.1:${MAGPIE_DEFAULT_API_PORT + 2}`,
      "--no-open",
    ])
    expect(lines[0]?.env).toEqual({
      MAGPIE_ADDR: `127.0.0.1:${MAGPIE_DEFAULT_GATEWAY_PORT + 2}`,
      MAGPIE_AGENTS_FILE: join(home, "gateway", "agents.json"),
      MAGPIE_HOME: join(home, "gateway"),
    })
    // the gateway moved: the Agent magpie had wired to the old one is wired again
    expect(lines.map((line) => line.request)).toContain("POST /api/agents/reapply/codex")

    // the Server answers for it
    const service = new MagpieService({ logger, manager: m, publish: () => {} })
    const replies: unknown[] = []
    await service.handle(
      { payload: {}, requestId: "r1", type: "magpie.agents.list.request" },
      (reply) => replies.push(reply)
    )
    expect(replies[0]).toMatchObject({
      payload: { ok: true, value: { agents: [{ agentId: "codex", drift: { kind: "unwired" } }] } },
      type: "magpie.agents.list.response",
    })

    const off = await m.setEnabled(false)
    expect(off.status).toBe("stopped")
    await expect(readFile(join(home, "gateway", "magpie.pid"), "utf8")).rejects.toThrow()
  }, 30_000)

  it("ends a magpie of Cypheria's an earlier Server left, by its pid file", async () => {
    const executable = join(home, "toolchains", "magpie", MAGPIE_RELEASE.version, "magpie")
    const leftover = spawn(executable, ["web", "--addr", "127.0.0.1:0"], {
      env: { ...process.env, MAGPIE_WEB_KEY: "x" },
      stdio: "ignore",
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await mkdir(join(home, "gateway"), { recursive: true })
    await writeFile(
      join(home, "gateway", "magpie.pid"),
      JSON.stringify({ apiPort: 1, executable, gatewayPort: 2, pid: leftover.pid })
    )
    const exited = new Promise((resolve) => leftover.once("exit", resolve))
    const m = manager()
    await m.init()
    await m.setEnabled(true)
    await exited
    expect(leftover.exitCode !== null || leftover.signalCode !== null).toBe(true)
    await m.shutdown()
  }, 30_000)

  it("refuses a download that is not the pinned release", async () => {
    await rm(join(home, "toolchains"), { force: true, recursive: true })
    const m = new MagpieManager({
      download: async () => new Uint8Array([1, 2, 3]),
      launchSpecs: async () => [],
      logger,
      paths: buildRuntimePaths({ env: { CYPHERIA_HOME: home } }),
    })
    await m.init()
    expect(m.view().status).toBe("missing")
    await expect(m.install()).rejects.toMatchObject({ name: "MAGPIE_CHECKSUM_MISMATCH" })
    expect(m.view().status).toBe("missing")
  })
})
