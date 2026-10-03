import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { AgentId, HookTrustStatus, HookView } from "@cypheria/protocol"
import { z } from "zod"

import type { PluginHub } from "./plugin-hub.js"

export const CYPHERIA_HOOKS_FILENAME = "hooks.json" as const
export const CYPHERIA_HOOKS_STATE_FILENAME = "hooks-state.json" as const
export const DEFAULT_HOOK_TIMEOUT_MS = 8_000

const HookDefinitionSchema = z.object({
  command: z.string().optional(),
  matcher: z.string().optional(),
  mcp_server: z.string().optional(),
  mcp_tool: z.string().optional(),
  status_message: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  type: z.enum(["command", "mcp_tool"]).default("command"),
})

export type HookDefinition = z.infer<typeof HookDefinitionSchema>

const HooksConfigFileSchema = z.object({
  hooks: z.record(z.string(), z.array(HookDefinitionSchema)).default({}),
  version: z.number().int().optional(),
})

const HooksStateFileSchema = z.object({
  hooks: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        trusted_hash: z.string().nullable().optional(),
      })
    )
    .default({}),
})

type HooksState = z.infer<typeof HooksStateFileSchema>

export type HookEventPayload = {
  additionalContext?: Record<string, unknown>
  cwd?: string
  prompt?: string
  sessionId?: string
  toolInput?: Record<string, unknown>
  toolName?: string
  turnId?: string
}

export type HookRunEntry = {
  kind: "error" | "feedback" | "stop" | "warning"
  text: string
}

export type HookRunRecord = {
  durationMs: number
  entries: HookRunEntry[]
  eventName: string
  id: string
  source: string
  status: "blocked" | "completed" | "failed"
  statusMessage: string | null
}

export type HookDispatchResult = {
  blockedReason: string | null
  feedback: string[]
  runs: HookRunRecord[]
  status: "blocked" | "completed"
}

import { homedir } from "node:os"

export class HookEngine {
  readonly #cypheriaHome: string
  readonly #pluginHub?: PluginHub

  constructor(options: { cypheriaHome?: string; pluginHub?: PluginHub } = {}) {
    this.#cypheriaHome =
      options.cypheriaHome ?? process.env.CYPHERIA_HOME ?? join(homedir(), ".cypheria")
    this.#pluginHub = options.pluginHub
  }

  get stateFilePath(): string {
    return join(this.#cypheriaHome, CYPHERIA_HOOKS_STATE_FILENAME)
  }

  get userHooksFilePath(): string {
    return join(this.#cypheriaHome, CYPHERIA_HOOKS_FILENAME)
  }

  /**
   * Finds project hooks file in cwd or its parent directories (up to repository root or filesystem root).
   */
  findProjectHooksFilePath(cwd?: string): string | null {
    if (!cwd) return null
    let current = resolve(cwd)
    while (true) {
      const candidate = join(current, ".cypheria", CYPHERIA_HOOKS_FILENAME)
      if (existsSync(candidate)) return candidate

      const gitDir = join(current, ".git")
      if (existsSync(gitDir)) {
        // We reached git repository root; stop searching higher
        break
      }

      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return null
  }

  async readState(): Promise<HooksState> {
    try {
      const content = await readFile(this.stateFilePath, "utf8")
      return HooksStateFileSchema.parse(JSON.parse(content))
    } catch {
      return { hooks: {} }
    }
  }

  async writeState(state: HooksState): Promise<void> {
    await mkdir(dirname(this.stateFilePath), { recursive: true })
    await writeFile(this.stateFilePath, JSON.stringify(state, null, 2), "utf8")
  }

  async setHookEnabled(key: string, enabled: boolean): Promise<void> {
    const state = await this.readState()
    const current = state.hooks[key] ?? {}
    state.hooks[key] = { ...current, enabled }
    await this.writeState(state)
  }

  async trustHook(key: string, trustedHash: string): Promise<void> {
    const state = await this.readState()
    const current = state.hooks[key] ?? {}
    state.hooks[key] = { ...current, trusted_hash: trustedHash }
    await this.writeState(state)
  }

  /**
   * Discovers all hooks across User level, Project level, and enabled Plugins.
   */
  async listHooks(
    options: { agentId?: string; cwd?: string; pluginDirectories?: readonly string[] } = {}
  ): Promise<{
    errors: { message: string; path: string | null }[]
    hooks: HookView[]
  }> {
    const state = await this.readState()
    const hooks: HookView[] = []
    const errors: { message: string; path: string | null }[] = []

    // 1. User level hooks (~/.cypheria/hooks.json)
    if (existsSync(this.userHooksFilePath)) {
      try {
        const raw = await readFile(this.userHooksFilePath, "utf8")
        const parsed = HooksConfigFileSchema.parse(JSON.parse(raw))
        this.#collectHooksFromConfig(parsed, {
          hooks,
          source: "user",
          sourcePath: this.userHooksFilePath,
          state,
        })
      } catch (err) {
        errors.push({
          message: `Failed to load user hooks from ${this.userHooksFilePath}: ${err instanceof Error ? err.message : String(err)}`,
          path: this.userHooksFilePath,
        })
      }
    }

    // 2. Project level hooks (<repo>/.cypheria/hooks.json)
    const projectHooksPath = this.findProjectHooksFilePath(options.cwd)
    if (projectHooksPath && existsSync(projectHooksPath)) {
      try {
        const raw = await readFile(projectHooksPath, "utf8")
        const currentHash = createHash("sha256").update(raw).digest("hex")
        const parsed = HooksConfigFileSchema.parse(JSON.parse(raw))
        this.#collectHooksFromConfig(parsed, {
          currentHash,
          hooks,
          source: "project",
          sourcePath: projectHooksPath,
          state,
        })
      } catch (err) {
        errors.push({
          message: `Failed to load project hooks from ${projectHooksPath}: ${err instanceof Error ? err.message : String(err)}`,
          path: projectHooksPath,
        })
      }
    }

    // 3. Plugin level hooks (<plugin_dir>/hooks/hooks.json or plugin.json with hooks)
    const pluginDirs = options.pluginDirectories ?? []
    for (const pluginDir of pluginDirs) {
      const hooksJsonPath = join(pluginDir, "hooks", CYPHERIA_HOOKS_FILENAME)
      if (existsSync(hooksJsonPath)) {
        try {
          const raw = await readFile(hooksJsonPath, "utf8")
          const parsed = HooksConfigFileSchema.parse(JSON.parse(raw))
          this.#collectHooksFromConfig(parsed, {
            hooks,
            source: "plugin",
            sourcePath: hooksJsonPath,
            state,
          })
        } catch (err) {
          errors.push({
            message: `Failed to load plugin hooks from ${hooksJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
            path: hooksJsonPath,
          })
        }
      }

      const pluginJsonPath = join(pluginDir, "plugin.json")
      if (existsSync(pluginJsonPath)) {
        try {
          const raw = await readFile(pluginJsonPath, "utf8")
          const pluginJson = JSON.parse(raw)
          if (pluginJson && typeof pluginJson === "object" && pluginJson.hooks) {
            const parsed = HooksConfigFileSchema.parse({ hooks: pluginJson.hooks })
            this.#collectHooksFromConfig(parsed, {
              hooks,
              source: "plugin",
              sourcePath: pluginJsonPath,
              state,
            })
          }
        } catch (err) {
          errors.push({
            message: `Failed to load plugin hooks from ${pluginJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
            path: pluginJsonPath,
          })
        }
      }
    }

    return { errors, hooks }
  }

  #collectHooksFromConfig(
    parsed: z.infer<typeof HooksConfigFileSchema>,
    meta: {
      currentHash?: string
      hooks: HookView[]
      source: "plugin" | "project" | "user"
      sourcePath: string
      state: HooksState
    }
  ): void {
    for (const [rawEventName, definitions] of Object.entries(parsed.hooks)) {
      const eventName = normalizeEventName(rawEventName)
      definitions.forEach((def, index) => {
        const key = `${meta.source}:${meta.sourcePath}:${eventName}:${index}`
        const hookState = meta.state.hooks[key]

        let trustStatus: HookTrustStatus = "trusted"
        if (meta.source === "project") {
          const trustedHash = hookState?.trusted_hash ?? null
          if (!trustedHash) {
            trustStatus = "untrusted"
          } else if (trustedHash === meta.currentHash) {
            trustStatus = "trusted"
          } else {
            trustStatus = "modified"
          }
        }

        const handlerType = def.type === "mcp_tool" ? "mcpTool" : def.type

        meta.hooks.push({
          additionalContextLimit: null,
          async: null,
          command: def.command ?? null,
          currentHash: meta.currentHash ?? "",
          cwd: meta.sourcePath,
          displayOrder: 0,
          enabled: hookState?.enabled ?? true,
          eventName,
          handlerType,
          harness: { agentId: "codex" as const, nativeId: key },
          isManaged: false,
          key,
          matcher: def.matcher ?? null,
          mcpServer: def.mcp_server ?? null,
          mcpTool: def.mcp_tool ?? null,
          pluginId: null,
          source: meta.source,
          sourcePath: meta.sourcePath,
          statusMessage: def.status_message ?? null,
          timeoutSec: Math.round((def.timeout_ms ?? DEFAULT_HOOK_TIMEOUT_MS) / 1000),
          trustStatus,
        })
      })
    }
  }

  /**
   * Dispatches lifecycle event to all matching hooks.
   *
   * KEY RULE:
   * If hook.source === "plugin" and context.agentId === "codex",
   * Cypheria layer SKIPS execution because Codex natively executes plugin hooks!
   */
  async dispatch(
    rawEventName: string,
    payload: HookEventPayload,
    context: {
      agentId: AgentId
      cwd?: string
      pluginDirectories?: readonly string[]
      threadId: string
      turnId?: string
    }
  ): Promise<HookDispatchResult> {
    const eventName = normalizeEventName(rawEventName)
    const { hooks } = await this.listHooks({
      cwd: context.cwd,
      agentId: context.agentId,
      pluginDirectories: context.pluginDirectories,
    })

    const runs: HookRunRecord[] = []
    const feedback: string[] = []

    for (const hook of hooks) {
      if (normalizeEventName(hook.eventName) !== eventName) {
        continue
      }

      // Rule: Skip plugin-level hooks for Codex harness to prevent duplicate execution
      if (hook.source === "plugin" && context.agentId === "codex") {
        continue
      }

      // Check enabled status
      if (!hook.enabled) {
        continue
      }

      // Check trust status: untrusted or modified project hooks cannot run
      if (hook.trustStatus === "untrusted" || hook.trustStatus === "modified") {
        continue
      }

      // Check matcher if tool-related
      if (hook.matcher && payload.toolName) {
        const regex = new RegExp(hook.matcher, "i")
        if (!regex.test(payload.toolName)) {
          continue
        }
      }

      // Run hook
      const runRecord = await this.#executeHook(hook, eventName, payload, context)
      runs.push(runRecord)

      for (const entry of runRecord.entries) {
        if (entry.kind === "feedback" && entry.text.trim()) {
          feedback.push(entry.text.trim())
        }
      }

      // If blocked, immediately stop further hooks and return blocked outcome
      if (runRecord.status === "blocked") {
        return {
          blockedReason: runRecord.statusMessage ?? "Operation blocked by hook.",
          feedback,
          runs,
          status: "blocked",
        }
      }
    }

    return {
      blockedReason: null,
      feedback,
      runs,
      status: "completed",
    }
  }

  async #executeHook(
    hook: HookView,
    eventName: string,
    payload: HookEventPayload,
    context: {
      agentId: AgentId
      cwd?: string
      threadId: string
      turnId?: string
    }
  ): Promise<HookRunRecord> {
    const id = randomUUID()
    const startTime = Date.now()

    if (hook.handlerType !== "command" || !hook.command) {
      return {
        durationMs: Date.now() - startTime,
        entries: [{ kind: "warning", text: `Unsupported hook handler: ${hook.handlerType}` }],
        eventName,
        id,
        source: hook.source,
        status: "completed",
        statusMessage: null,
      }
    }

    const command = hook.command
    const cwd = context.cwd ?? process.cwd()

    return await new Promise<HookRunRecord>((res) => {
      let stdout = ""
      let stderr = ""
      const entries: HookRunEntry[] = []

      const inputJson = JSON.stringify({
        cwd,
        event: eventName,
        prompt: payload.prompt ?? null,
        session_id: context.threadId,
        tool_input: payload.toolInput ?? null,
        tool_name: payload.toolName ?? null,
        turn_id: context.turnId ?? payload.turnId ?? null,
      })

      const child = spawn(command, {
        cwd,
        env: {
          ...process.env,
          HOOK_AGENT_ID: context.agentId,
          HOOK_CWD: cwd,
          HOOK_EVENT: eventName,
          HOOK_SESSION_ID: context.threadId,
          HOOK_TOOL_NAME: payload.toolName ?? "",
          HOOK_TURN_ID: context.turnId ?? payload.turnId ?? "",
        },
        shell: true,
      })

      const timer = setTimeout(() => {
        child.kill("SIGTERM")
        setTimeout(() => child.kill("SIGKILL"), 1_000).unref()
      }, DEFAULT_HOOK_TIMEOUT_MS)

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8")
      })
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8")
      })

      child.on("error", (err) => {
        clearTimeout(timer)
        res({
          durationMs: Date.now() - startTime,
          entries: [{ kind: "error", text: err.message }],
          eventName,
          id,
          source: hook.source,
          status: "failed",
          statusMessage: err.message,
        })
      })

      child.on("close", (code) => {
        clearTimeout(timer)
        const durationMs = Date.now() - startTime
        const combinedOut = stdout.trim()
        const combinedErr = stderr.trim()

        if (code === 0) {
          // Success
          if (combinedOut) {
            entries.push({ kind: "feedback", text: combinedOut })
          }
          res({
            durationMs,
            entries,
            eventName,
            id,
            source: hook.source,
            status: "completed",
            statusMessage: null,
          })
        } else if (code === 2) {
          // Blocked
          const reason = combinedErr || combinedOut || "Blocked by hook."
          entries.push({ kind: "stop", text: reason })
          res({
            durationMs,
            entries,
            eventName,
            id,
            source: hook.source,
            status: "blocked",
            statusMessage: reason,
          })
        } else {
          // Failure
          const errorMsg = combinedErr || combinedOut || `Hook exited with code ${code}`
          entries.push({ kind: "error", text: errorMsg })
          res({
            durationMs,
            entries,
            eventName,
            id,
            source: hook.source,
            status: "failed",
            statusMessage: errorMsg,
          })
        }
      })

      // Send payload via stdin
      try {
        child.stdin.write(inputJson)
        child.stdin.end()
      } catch {
        // Child closed stdin early
      }
    })
  }
}

/**
 * Normalizes event names (e.g. "pre_tool_use" or "PreToolUse" -> "preToolUse")
 */
function normalizeEventName(raw: string): string {
  const cleaned = raw.replace(/[-_]/gu, "").toLowerCase()
  switch (cleaned) {
    case "pretooluse":
      return "preToolUse"
    case "posttooluse":
      return "postToolUse"
    case "userpromptsubmit":
      return "userPromptSubmit"
    case "stop":
      return "stop"
    case "sessionstart":
      return "sessionStart"
    case "sessionend":
      return "sessionEnd"
    case "permissionrequest":
      return "permissionRequest"
    case "subagentstart":
      return "subagentStart"
    case "subagentstop":
      return "subagentStop"
    case "precompact":
      return "preCompact"
    case "postcompact":
      return "postCompact"
    case "interrupt":
      return "interrupt"
    default:
      return raw
  }
}
