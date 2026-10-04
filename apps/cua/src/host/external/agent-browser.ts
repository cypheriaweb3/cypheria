import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

/** One agent-browser `--json` response. */
export type AgentBrowserResponse = {
  readonly success: boolean
  readonly data: Record<string, unknown> | null
  readonly error: string | null
}

/**
 * Finds the agent-browser executable for this platform: `CYPHERIA_AGENT_BROWSER_PATH`, the copy a
 * Server build places in the cua root's `bin/`, the npm package's native binary, then `PATH`.
 */
export const resolveAgentBrowserBinary = (
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string => {
  const exe = platform === "win32" ? ".exe" : ""
  if (env.CYPHERIA_AGENT_BROWSER_PATH && existsSync(env.CYPHERIA_AGENT_BROWSER_PATH)) {
    return env.CYPHERIA_AGENT_BROWSER_PATH
  }
  const bundled = join(root, "bin", `agent-browser${exe}`)
  if (existsSync(bundled)) return bundled
  try {
    const packageJson = createRequire(join(root, "package.json")).resolve(
      "agent-browser/package.json"
    )
    const native = join(dirname(packageJson), "bin", `agent-browser-${platform}-${arch}${exe}`)
    if (existsSync(native)) return native
  } catch {
    // Not installed next to this root; fall back to PATH.
  }
  return `agent-browser${exe}`
}

export type AgentBrowserRunner = (
  args: readonly string[],
  options: { readonly timeoutMs: number }
) => Promise<AgentBrowserResponse>

/** Runs the agent-browser CLI; its daemon keeps the browser connection between calls. */
export const createAgentBrowserRunner =
  (binary: string, env: NodeJS.ProcessEnv): AgentBrowserRunner =>
  (args, options) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        [...args],
        { env, maxBuffer: 64 * 1024 * 1024, timeout: options.timeoutMs, windowsHide: true },
        (error, stdout, stderr) => {
          const output = stdout.trim()
          if (output) {
            try {
              resolve(JSON.parse(output) as AgentBrowserResponse)
              return
            } catch {
              // Fall through to report the raw failure.
            }
          }
          reject(
            new Error(
              `agent-browser failed: ${stderr.trim() || output || (error instanceof Error ? error.message : "no output")}`
            )
          )
        }
      )
    })

/**
 * One Thread's agent-browser session attached to one external browser. Calls are serialized
 * because the session has a single active tab, and element refs belong to it.
 */
export class AgentBrowserSession {
  readonly name: string
  readonly #run: AgentBrowserRunner
  readonly #endpoint: () => Promise<string>
  #queue: Promise<unknown> = Promise.resolve()
  #activeTab: string | null = null

  constructor(name: string, run: AgentBrowserRunner, endpoint: () => Promise<string>) {
    this.name = name
    this.#run = run
    this.#endpoint = endpoint
  }

  /**
   * Runs `commands` in order in `tabId` (or the current tab when `null`), switching the session's
   * active tab first when needed, and stops at the first failure. `activeAfter` names the tab a
   * command such as `tab new` made active.
   */
  inTab(
    tabId: string | null,
    commands: readonly (readonly string[])[],
    options: {
      readonly timeoutMs?: number
      readonly activeAfter?: (response: AgentBrowserResponse) => string | null | undefined
    } = {}
  ): Promise<AgentBrowserResponse & { switched: boolean }> {
    const timeoutMs = options.timeoutMs ?? 30_000
    const task = this.#queue.then(async () => {
      let switched = false
      if (tabId && tabId !== this.#activeTab) {
        const result = await this.#call(["tab", tabId], timeoutMs)
        if (!result.success) return { ...result, switched }
        this.#activeTab = tabId
        switched = true
      }
      let result: AgentBrowserResponse = { data: null, error: null, success: true }
      for (const args of commands) {
        result = await this.#call(args, timeoutMs)
        if (!result.success) break
      }
      const active = options.activeAfter?.(result)
      if (active !== undefined) this.#activeTab = active
      return { ...result, switched }
    })
    this.#queue = task.catch(() => undefined)
    return task
  }

  async #call(args: readonly string[], timeoutMs: number): Promise<AgentBrowserResponse> {
    const endpoint = await this.#endpoint()
    return this.#run(
      ["--session", this.name, "--cdp", endpoint, "--json", "--idle-timeout", "15m", ...args],
      { timeoutMs }
    )
  }
}
