import { type ChildProcess, execFile, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { arch, platform } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import {
  type AgentId,
  MAGPIE_DEFAULT_API_PORT,
  MAGPIE_DEFAULT_GATEWAY_PORT,
  MAGPIE_STANDALONE_PORTS,
  type MagpieAgentView,
  type MagpieConfig,
  MagpieConfigSchema,
  type MagpieGroupView,
  type MagpieProviderView,
  type MagpieServiceStatus,
  type MagpieServiceView,
  type MagpieUsagePeriod,
  type MagpieUsageSummary,
} from "@cypheria/protocol"
import {
  MAGPIE_RELEASE,
  MagpieAgentFieldChangeSchema,
  MagpieGroupsSchema,
  type MagpiePlatform,
  MagpieProvidersSchema,
  type MagpieState,
  MagpieStateSchema,
  type MagpieUsage,
  MagpieUsageSchema,
} from "@cypheria/protocol/magpie-api"
import type { Logger } from "pino"
import type { z } from "zod"

import type { AgentLaunchSpec } from "../agent/agent-manager.js"
import { downloadBytes, readJsonFile, sha256, writeJsonAtomic } from "../agent/fs-utils.js"
import type { CypheriaRuntimePaths } from "../runtime/index.js"

const execFileAsync = promisify(execFile)

/** Cypheria's Agents by magpie's id for them (magpie's agents file keys). */
export const MAGPIE_AGENT_IDS = {
  "antigravity-acp": "agy",
  claude: "claude",
  cline: "cline",
  codex: "codex",
  cursor: "cursor",
  devin: "devin",
  gemini: "gemini",
  "github-copilot-cli": "copilot",
  goose: "goose",
  "grok-build": "grok",
  opencode: "opencode",
  pi: "pi",
} as const satisfies Partial<Record<AgentId, string>>

type MagpieAgentId = (typeof MAGPIE_AGENT_IDS)[keyof typeof MAGPIE_AGENT_IDS]

const CYPHERIA_AGENT_IDS = new Map<string, AgentId>(
  Object.entries(MAGPIE_AGENT_IDS).map(([agentId, magpieId]) => [magpieId, agentId as AgentId])
)

/** The Agent a magpie subscription account belongs to, by its agent field. */
const ACCOUNT_AGENT_IDS = new Map<string, AgentId>([
  ...CYPHERIA_AGENT_IDS,
  ["antigravity", "antigravity-acp"],
])

const toMagpieId = (agentId: AgentId): MagpieAgentId => {
  const id = (MAGPIE_AGENT_IDS as Partial<Record<AgentId, MagpieAgentId>>)[agentId]
  if (!id) throw magpieError("MAGPIE_AGENT_UNSUPPORTED", `magpie does not manage ${agentId}`)
  return id
}

const magpieError = (code: string, message: string): Error => {
  const error = new Error(message)
  error.name = code
  return error
}

export const magpiePlatform = (): MagpiePlatform => {
  const os = platform()
  const cpu = arch()
  if ((os === "darwin" || os === "linux" || os === "win32") && (cpu === "arm64" || cpu === "x64")) {
    return `${os}-${cpu}`
  }
  throw magpieError("MAGPIE_PLATFORM_UNSUPPORTED", `magpie has no build for ${os}-${cpu}`)
}

/** The release asset of the terminal build for a platform. */
export const magpieAsset = (target: MagpiePlatform): string => {
  const [os, cpu] = target.split("-") as [string, string]
  const goos = os === "win32" ? "windows" : os
  const goarch = cpu === "x64" ? "amd64" : cpu
  return `magpie-cli-${goos}-${goarch}${os === "win32" ? ".exe" : ""}`
}

/** The agents file: each Agent magpie may know, as Cypheria launches it. */
export const magpieAgentsFile = (specs: readonly AgentLaunchSpec[]) => ({
  agents: Object.fromEntries(
    specs.flatMap((spec) => {
      const id = (MAGPIE_AGENT_IDS as Partial<Record<AgentId, string>>)[spec.agentId]
      if (!id) return []
      return [
        [
          id,
          {
            command: spec.command,
            ...(spec.args.length > 0 ? { args: [...spec.args] } : {}),
            ...(spec.cwd ? { cwd: spec.cwd } : {}),
            ...(Object.keys(spec.env).length > 0 ? { env: { ...spec.env } } : {}),
          },
        ],
      ]
    })
  ),
  version: 1,
})

/** Whether 127.0.0.1:port can be listened on now. */
export const portAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.listen({ exclusive: true, host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true))
    })
  })

type PidRecord = { apiPort: number; executable: string; gatewayPort: number; pid: number }

export type MagpieManagerOptions = {
  readonly download?: (url: string) => Promise<Uint8Array>
  readonly launchSpecs: () => Promise<readonly AgentLaunchSpec[]>
  readonly logger: Logger
  readonly onStatusChange?: (view: MagpieServiceView) => void
  readonly paths: CypheriaRuntimePaths
  readonly portAvailable?: (port: number) => Promise<boolean>
  readonly readyTimeoutMs?: number
}

/**
 * Installs the pinned magpie release and runs `magpie web` over Cypheria's
 * Agents: MAGPIE_HOME is $CYPHERIA_HOME/gateway, its agents file lists the
 * installed Agents as they are launched, and both ports stay away from a
 * standalone magpie's. It runs while enabled, restarted when it exits.
 */
export class MagpieManager {
  readonly #logger: Logger
  readonly #paths: CypheriaRuntimePaths
  readonly #launchSpecs: () => Promise<readonly AgentLaunchSpec[]>
  readonly #download: (url: string) => Promise<Uint8Array>
  readonly #portAvailable: (port: number) => Promise<boolean>
  readonly #readyTimeoutMs: number
  readonly #onStatusChange?: (view: MagpieServiceView) => void
  readonly #home: string
  readonly #agentsFile: string
  readonly #configFile: string
  readonly #pidFile: string
  readonly #executable: string

  #config: MagpieConfig = MagpieConfigSchema.parse({})
  #status: MagpieServiceStatus = "stopped"
  #error: string | null = null
  #installedVersion: string | null = null
  #process: ChildProcess | undefined
  #key = ""
  #startedAt: string | null = null
  #stopping = false
  #restarts: number[] = []
  #queue: Promise<unknown> = Promise.resolve()

  constructor(options: MagpieManagerOptions) {
    this.#logger = options.logger.child({ module: "magpie" })
    this.#paths = options.paths
    this.#launchSpecs = options.launchSpecs
    this.#download = options.download ?? ((url) => downloadBytes(url, { timeoutMs: 300_000 }))
    this.#portAvailable = options.portAvailable ?? portAvailable
    this.#readyTimeoutMs = options.readyTimeoutMs ?? 20_000
    this.#onStatusChange = options.onStatusChange
    this.#home = join(options.paths.cypheriaHome, "gateway")
    this.#agentsFile = join(this.#home, "agents.json")
    this.#configFile = join(this.#home, "cypheria.json")
    this.#pidFile = join(this.#home, "magpie.pid")
    const name = platform() === "win32" ? "magpie.exe" : "magpie"
    this.#executable = join(
      options.paths.cypheriaHome,
      "toolchains",
      "magpie",
      MAGPIE_RELEASE.version,
      name
    )
  }

  /** Reads the settings and, when enabled, installs and starts magpie. */
  async init(): Promise<void> {
    await mkdir(this.#home, { recursive: true })
    const saved = await readJsonFile<unknown>(this.#configFile).catch(() => undefined)
    const parsed = MagpieConfigSchema.safeParse(saved ?? {})
    this.#config = parsed.success ? parsed.data : MagpieConfigSchema.parse({})
    this.#installedVersion = (await this.#installed()) ? MAGPIE_RELEASE.version : null
    this.#status = this.#installedVersion ? "stopped" : "missing"
    if (this.#config.enabled) {
      void this.#serialized(() => this.#ensureRunning()).catch((error) =>
        this.#logger.warn({ error: String(error) }, "magpie did not start")
      )
    }
  }

  view(): MagpieServiceView {
    return {
      config: { ...this.#config },
      error: this.#error,
      gatewayUrl: this.#status === "ready" ? `http://127.0.0.1:${this.#config.gatewayPort}` : null,
      installedVersion: this.#installedVersion,
      startedAt: this.#startedAt,
      status: this.#status,
      version: MAGPIE_RELEASE.version,
    }
  }

  install(): Promise<MagpieServiceView> {
    return this.#serialized(async () => {
      await this.#install()
      return this.view()
    })
  }

  /** Turns magpie on (installed and started) or off (stopped). */
  setEnabled(enabled: boolean): Promise<MagpieServiceView> {
    return this.#serialized(async () => {
      await this.#saveConfig({ ...this.#config, enabled })
      if (enabled) await this.#ensureRunning()
      else await this.#stop()
      return this.view()
    })
  }

  restart(): Promise<MagpieServiceView> {
    return this.#serialized(async () => {
      await this.#stop()
      if (this.#config.enabled) await this.#ensureRunning()
      return this.view()
    })
  }

  /** Stops magpie with the Server; its setting is kept for the next start. */
  shutdown(): Promise<void> {
    return this.#serialized(() => this.#stop())
  }

  /** Writes the agents file again, after an Agent was installed or removed. */
  async refreshAgents(): Promise<void> {
    if (!this.#config.enabled) return
    await this.#writeAgentsFile().catch((error) =>
      this.#logger.warn({ error: String(error) }, "magpie's agents file was not written")
    )
  }

  async listAgents(): Promise<MagpieAgentView[]> {
    return agentViews(await this.#api("GET", "/api/state", MagpieStateSchema))
  }

  async setAgentField(agentId: AgentId, field: string, value: string): Promise<MagpieAgentView[]> {
    const body = MagpieAgentFieldChangeSchema.parse({ agent: toMagpieId(agentId), field, value })
    return agentViews(await this.#api("POST", "/api/set", MagpieStateSchema, body))
  }

  async reapplyAgent(agentId: AgentId): Promise<MagpieAgentView[]> {
    const path = `/api/agents/reapply/${encodeURIComponent(toMagpieId(agentId))}`
    return agentViews(await this.#api("POST", path, MagpieStateSchema))
  }

  async listProviders(): Promise<MagpieProviderView[]> {
    const { providers } = await this.#api("GET", "/api/providers", MagpieProvidersSchema)
    return providers.map((provider) => ({
      account: provider.account
        ? {
            agentId: ACCOUNT_AGENT_IDS.get(provider.account.agent) ?? null,
            plan: provider.account.plan || null,
            user: provider.account.user,
          }
        : null,
      exposedModels: provider.exposed,
      icon: provider.icon,
      id: provider.id,
      kind: provider.account ? "subscription" : "key",
      name: provider.name,
      off: provider.off ?? false,
      ready: provider.ready,
    }))
  }

  async listGroups(): Promise<MagpieGroupView[]> {
    const { groups } = await this.#api("GET", "/api/groups", MagpieGroupsSchema)
    return groups.map((group) => ({
      id: group.id,
      members: group.members ?? [],
      name: group.name,
      ready: group.ready,
      routing: group.routing || null,
    }))
  }

  async usage(period: MagpieUsagePeriod): Promise<MagpieUsageSummary> {
    const path = `/api/usage?period=${encodeURIComponent(period)}`
    return usageSummary(period, await this.#api("GET", path, MagpieUsageSchema))
  }

  // ---- lifecycle -------------------------------------------------------

  #serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run, run)
    this.#queue = next.catch(() => undefined)
    return next
  }

  #set(status: MagpieServiceStatus, error: string | null = null): void {
    this.#status = status
    this.#error = error
    this.#onStatusChange?.(this.view())
  }

  async #installed(): Promise<boolean> {
    const info = await stat(this.#executable).catch(() => undefined)
    return info?.isFile() ?? false
  }

  async #install(): Promise<void> {
    if (await this.#installed()) {
      this.#installedVersion = MAGPIE_RELEASE.version
      if (this.#status === "missing") this.#set("stopped")
      return
    }
    const target = magpiePlatform()
    const asset = magpieAsset(target)
    const url = `https://github.com/${MAGPIE_RELEASE.releasesRepository}/releases/download/v${MAGPIE_RELEASE.version}/${asset}`
    this.#set("installing")
    try {
      const bytes = await this.#download(url)
      if (sha256(bytes) !== MAGPIE_RELEASE.cliSha256[target]) {
        throw magpieError("MAGPIE_CHECKSUM_MISMATCH", `${asset} does not match its pinned checksum`)
      }
      await mkdir(dirname(this.#executable), { recursive: true })
      const staging = `${this.#executable}.${process.pid}.download`
      await writeFile(staging, bytes, { mode: 0o755 })
      await chmod(staging, 0o755)
      await rename(staging, this.#executable)
      this.#installedVersion = MAGPIE_RELEASE.version
      this.#logger.info({ version: MAGPIE_RELEASE.version }, "magpie installed")
      this.#set("stopped")
    } catch (error) {
      this.#set("missing", errorMessage(error))
      throw error
    }
  }

  async #ensureRunning(): Promise<void> {
    if (this.#process && this.#status === "ready") return
    await this.#install()
    await this.#start()
  }

  async #start(): Promise<void> {
    this.#set("starting")
    try {
      await this.#endLeftover()
      const changed = await this.#choosePorts()
      await this.#writeAgentsFile()
      await this.#spawn()
      if (!(await this.#waitReady())) {
        throw magpieError("MAGPIE_NOT_READY", "magpie did not answer in time")
      }
      this.#startedAt = new Date().toISOString()
      this.#set("ready")
      if (changed) await this.#reapplyUnwired()
    } catch (error) {
      await this.#kill()
      this.#set("error", errorMessage(error))
      throw error
    }
  }

  /** Ends a magpie of Cypheria's left from an earlier Server, by its pid file. */
  async #endLeftover(): Promise<void> {
    const record = await readJsonFile<PidRecord>(this.#pidFile).catch(() => undefined)
    await rm(this.#pidFile, { force: true })
    if (!record || !Number.isInteger(record.pid)) return
    if (!(await isProcessOf(record.pid, record.executable))) return
    this.#logger.info({ pid: record.pid }, "ending a magpie Cypheria left running")
    try {
      process.kill(record.pid, "SIGTERM")
    } catch {
      return
    }
    for (let i = 0; i < 30 && alive(record.pid); i++) await sleep(100)
    if (alive(record.pid)) {
      try {
        process.kill(record.pid, "SIGKILL")
      } catch {}
    }
  }

  /**
   * Keeps both ports when they are free; another one, the next free one
   * after it, is saved in their place. Answers whether one changed.
   */
  async #choosePorts(): Promise<boolean> {
    const taken = new Set<number>(MAGPIE_STANDALONE_PORTS)
    const pick = async (wanted: number, fallback: number): Promise<number> => {
      const first = wanted || fallback
      for (let port = first; port < first + 200 && port <= 65535; port++) {
        if (taken.has(port)) continue
        if (await this.#portAvailable(port)) {
          taken.add(port)
          return port
        }
      }
      throw magpieError("MAGPIE_NO_PORT", `no free port from ${first} on`)
    }
    const gatewayPort = await pick(this.#config.gatewayPort, MAGPIE_DEFAULT_GATEWAY_PORT)
    const apiPort = await pick(this.#config.apiPort, MAGPIE_DEFAULT_API_PORT)
    if (gatewayPort === this.#config.gatewayPort && apiPort === this.#config.apiPort) return false
    this.#logger.info({ apiPort, gatewayPort }, "magpie's ports were taken; moved to free ones")
    await this.#saveConfig({ ...this.#config, apiPort, gatewayPort })
    return true
  }

  async #writeAgentsFile(): Promise<void> {
    await writeJsonAtomic(this.#agentsFile, magpieAgentsFile(await this.#launchSpecs()))
  }

  async #spawn(): Promise<void> {
    this.#key = randomBytes(16).toString("hex")
    const logPath = join(this.#paths.logsDir, "magpie.log")
    await mkdir(dirname(logPath), { recursive: true })
    const log = createWriteStream(logPath, { flags: "a" })
    const child = spawn(
      this.#executable,
      ["web", "--addr", `127.0.0.1:${this.#config.apiPort}`, "--no-open"],
      {
        env: {
          ...process.env,
          MAGPIE_ADDR: `127.0.0.1:${this.#config.gatewayPort}`,
          MAGPIE_AGENTS_FILE: this.#agentsFile,
          MAGPIE_HOME: this.#home,
          MAGPIE_WEB_KEY: this.#key,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    )
    child.stdout?.pipe(log, { end: false })
    child.stderr?.pipe(log, { end: false })
    this.#process = child
    child.once("error", (error) => this.#logger.error({ error: String(error) }, "magpie failed"))
    child.once("exit", (code, signal) => {
      log.end()
      if (this.#process !== child) return
      this.#process = undefined
      this.#startedAt = null
      void rm(this.#pidFile, { force: true })
      if (this.#stopping) return
      this.#logger.warn({ code, signal }, "magpie exited")
      void this.#serialized(() => this.#recover(code, signal))
    })
    if (child.pid) {
      const record: PidRecord = {
        apiPort: this.#config.apiPort,
        executable: this.#executable,
        gatewayPort: this.#config.gatewayPort,
        pid: child.pid,
      }
      await writeJsonAtomic(this.#pidFile, record)
    }
  }

  /** Restarts magpie that exited by itself, at most 5 times a minute. */
  async #recover(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (!this.#config.enabled || this.#process) return
    const now = Date.now()
    this.#restarts = [...this.#restarts.filter((at) => now - at < 60_000), now]
    if (this.#restarts.length > 5) {
      this.#set("error", `magpie keeps exiting (${signal ?? `code ${code}`})`)
      return
    }
    await sleep(1_000 * this.#restarts.length)
    await this.#start().catch(() => undefined)
  }

  async #waitReady(): Promise<boolean> {
    const deadline = Date.now() + this.#readyTimeoutMs
    while (Date.now() < deadline && this.#process) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.#config.apiPort}/openapi.json`, {
          headers: { Authorization: `Bearer ${this.#key}` },
          signal: AbortSignal.timeout(2_000),
        })
        if (response.ok) return true
      } catch {}
      await sleep(250)
    }
    return false
  }

  /** After the gateway moved, puts it back into the Agents magpie wired to the old one. */
  async #reapplyUnwired(): Promise<void> {
    const state = await this.#api("GET", "/api/state", MagpieStateSchema).catch(() => undefined)
    for (const agent of state?.agents ?? []) {
      if (agent.drift?.kind !== "unwired") continue
      await this.#api(
        "POST",
        `/api/agents/reapply/${encodeURIComponent(agent.id)}`,
        MagpieStateSchema
      )
        .then(() =>
          this.#logger.info({ agent: agent.id }, "magpie wired the agent to its new port")
        )
        .catch((error) =>
          this.#logger.warn({ agent: agent.id, error: String(error) }, "reapply failed")
        )
    }
  }

  async #stop(): Promise<void> {
    this.#stopping = true
    try {
      await this.#kill()
      await rm(this.#pidFile, { force: true })
      this.#startedAt = null
      this.#set(this.#installedVersion ? "stopped" : "missing")
    } finally {
      this.#stopping = false
    }
  }

  async #kill(): Promise<void> {
    const child = this.#process
    if (!child) return
    this.#process = undefined
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.once("exit", () => resolve())
    })
    child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 3_000)
    await exited
    clearTimeout(timer)
  }

  async #saveConfig(config: MagpieConfig): Promise<void> {
    this.#config = MagpieConfigSchema.parse(config)
    await writeJsonAtomic(this.#configFile, this.#config)
  }

  async #api<S extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    schema: S,
    body?: unknown
  ): Promise<z.infer<S>> {
    if (this.#status !== "ready" || !this.#process) {
      throw magpieError("MAGPIE_NOT_RUNNING", "magpie is not running")
    }
    const response = await fetch(`http://127.0.0.1:${this.#config.apiPort}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${this.#key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      method,
      signal: AbortSignal.timeout(60_000),
    })
    const text = await response.text()
    if (!response.ok) {
      let message = text.trim() || response.statusText
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message
      } catch {}
      throw magpieError("MAGPIE_REQUEST_FAILED", message)
    }
    const parsed = schema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      throw magpieError(
        "MAGPIE_RESPONSE_INVALID",
        `magpie's ${method} ${path} answered unexpectedly`
      )
    }
    return parsed.data
  }
}

const agentViews = (state: MagpieState): MagpieAgentView[] =>
  state.agents.flatMap((agent) => {
    const agentId = CYPHERIA_AGENT_IDS.get(agent.id)
    if (!agentId) return []
    return [
      {
        agentId,
        drift: agent.drift
          ? { field: agent.drift.field, kind: agent.drift.kind, now: agent.drift.now ?? null }
          : null,
        fields: agent.fields.map((field) => ({
          key: field.key,
          label: field.label,
          options: field.options.map((option) => ({
            group: option.group ?? null,
            label: option.label ?? option.value,
            note: option.note,
            value: option.value,
          })),
          value: field.value,
        })),
        icon: agent.icon,
        name: agent.name,
        path: agent.path,
      },
    ]
  })

const totals = (t: {
  calls: number
  cost: number
  errors: number
  input: number
  output: number
}) => ({
  calls: t.calls,
  costUsd: t.cost,
  errors: t.errors,
  inputTokens: t.input,
  outputTokens: t.output,
})

const usageSummary = (period: MagpieUsagePeriod, usage: MagpieUsage): MagpieUsageSummary => ({
  byAgent: usage.agents.map((group) => ({ ...totals(group), id: group.id, name: group.name })),
  byModel: usage.models.map((group) => ({
    ...totals(group),
    model: group.model ?? group.id,
    provider: group.sub ?? group.provider ?? "",
  })),
  period,
  totals: totals(usage),
})

/** Whether pid is alive and runs executable (a magpie of Cypheria's). */
const isProcessOf = async (pid: number, executable: string): Promise<boolean> => {
  if (!alive(pid)) return false
  try {
    if (platform() === "win32") {
      const { stdout } = await execFileAsync("tasklist", [
        "/FI",
        `PID eq ${pid}`,
        "/FO",
        "CSV",
        "/NH",
      ])
      return stdout.toLowerCase().includes("magpie")
    }
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="])
    return stdout.includes(executable)
  } catch {
    return false
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
