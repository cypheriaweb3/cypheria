import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { access } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"
import { CYPHERIA_PROTOCOL_VERSION } from "@cypheria/protocol"

const execFileAsync = promisify(execFile)

export type DesktopServerState = {
  owned: boolean
  state: "ready" | "stopped"
  url: string
}

export type DesktopServerManagerOptions = {
  cliCandidates: readonly string[]
  env?: NodeJS.ProcessEnv
  probe?: (url: string) => Promise<boolean>
  runCli?: (
    cliPath: string,
    command: "start" | "stop",
    env: NodeJS.ProcessEnv,
    options?: { ifIdle?: boolean }
  ) => Promise<void>
  runSupervisor?: (supervisorPath: string, env: NodeJS.ProcessEnv) => Promise<void>
  serverUrl?: string
  supervisorCandidates?: readonly string[]
  timeoutMs?: number
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export const resolveDesktopNodeExecutable = (
  executablePath = process.execPath,
  platform = process.platform
): string => {
  if (platform !== "darwin") return executablePath
  const macosDirectory = dirname(executablePath)
  if (basename(macosDirectory) !== "MacOS") return executablePath
  const contentsDirectory = dirname(macosDirectory)
  if (basename(contentsDirectory) !== "Contents") return executablePath
  const bundleName = basename(executablePath)
  const frameworksDirectory = join(contentsDirectory, "Frameworks")
  for (const helperName of [`${bundleName} Helper`, "Electron Helper"]) {
    const helperPath = join(
      frameworksDirectory,
      `${helperName}.app`,
      "Contents",
      "MacOS",
      helperName
    )
    if (existsSync(helperPath)) return helperPath
  }
  return executablePath
}

export const probeCompatibleServer = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(`${url}/api/v1/ready`)
    if (!response.ok) return false
    const payload = (await response.json()) as { protocolVersion?: unknown }
    if (payload.protocolVersion !== CYPHERIA_PROTOCOL_VERSION) {
      throw new Error(
        `Cypheria server protocol ${String(payload.protocolVersion)} is incompatible with Desktop protocol ${CYPHERIA_PROTOCOL_VERSION}`
      )
    }
    return true
  } catch (error) {
    if (error instanceof Error && error.message.includes("server protocol")) throw error
    return false
  }
}

const defaultRunCli = async (
  cliPath: string,
  command: "start" | "stop",
  env: NodeJS.ProcessEnv,
  options?: { ifIdle?: boolean }
): Promise<void> => {
  await execFileAsync(
    resolveDesktopNodeExecutable(),
    [cliPath, command, ...(command === "stop" && options?.ifIdle ? ["--if-idle"] : [])],
    {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    }
  )
}

const defaultRunSupervisor = async (
  supervisorPath: string,
  env: NodeJS.ProcessEnv
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveDesktopNodeExecutable(), [supervisorPath], {
      detached: true,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "ignore",
      windowsHide: true,
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

export class DesktopServerManager {
  readonly #candidates: readonly string[]
  readonly #env: NodeJS.ProcessEnv
  readonly #probe: (url: string) => Promise<boolean>
  readonly #runCli: DesktopServerManagerOptions["runCli"]
  readonly #runSupervisor: DesktopServerManagerOptions["runSupervisor"]
  readonly #supervisorCandidates: readonly string[]
  readonly #timeoutMs: number
  readonly #url: string
  #owned = false

  constructor(options: DesktopServerManagerOptions) {
    this.#candidates = options.cliCandidates
    this.#env = options.env ?? process.env
    this.#probe = options.probe ?? probeCompatibleServer
    this.#runCli = options.runCli ?? defaultRunCli
    this.#runSupervisor = options.runSupervisor ?? defaultRunSupervisor
    this.#supervisorCandidates =
      options.supervisorCandidates ??
      options.cliCandidates
        .filter(Boolean)
        .map((candidate) => join(dirname(candidate), "supervisor.mjs"))
    this.#timeoutMs = options.timeoutMs ?? 15_000
    this.#url = options.serverUrl ?? "http://127.0.0.1:6768"
  }

  async ensureRunning(): Promise<DesktopServerState> {
    if (await this.#probe(this.#url)) return { owned: this.#owned, state: "ready", url: this.#url }
    const supervisorPath = await this.#resolveSupervisor()
    await this.#runSupervisor?.(supervisorPath, this.#env)
    this.#owned = true
    const deadline = Date.now() + this.#timeoutMs
    while (Date.now() < deadline) {
      if (await this.#probe(this.#url)) return { owned: true, state: "ready", url: this.#url }
      await delay(100)
    }
    throw new Error(`Cypheria server did not become ready at ${this.#url}`)
  }

  async status(): Promise<DesktopServerState> {
    return {
      owned: this.#owned,
      state: (await this.#probe(this.#url)) ? "ready" : "stopped",
      url: this.#url,
    }
  }

  async stopOwned(): Promise<void> {
    if (!this.#owned) return
    const cliPath = await this.#resolveCli()
    await this.#runCli?.(cliPath, "stop", this.#env, { ifIdle: true })
    this.#owned = false
  }

  async #resolveCli(): Promise<string> {
    return this.#resolveCandidate(this.#candidates, "server CLI")
  }

  async #resolveSupervisor(): Promise<string> {
    return this.#resolveCandidate(this.#supervisorCandidates, "server supervisor")
  }

  async #resolveCandidate(candidates: readonly string[], label: string): Promise<string> {
    for (const candidate of candidates) {
      if (!candidate) continue
      try {
        await access(candidate)
        return candidate
      } catch {
        // Try the next packaged or development location.
      }
    }
    throw new Error(
      `Cypheria ${label} was not found. Checked: ${candidates.filter(Boolean).join(", ")}`
    )
  }
}
