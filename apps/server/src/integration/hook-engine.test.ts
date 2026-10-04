import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { HookEngine } from "./hook-engine.js"

describe("HookEngine", () => {
  let homeDir: string
  let workDir: string

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "cypheria-hook-engine-home-"))
    workDir = await mkdtemp(join(tmpdir(), "cypheria-hook-engine-work-"))
  })

  afterEach(async () => {
    await rm(homeDir, { force: true, recursive: true }).catch(() => undefined)
    await rm(workDir, { force: true, recursive: true }).catch(() => undefined)
  })

  it("discovers user hooks and executes successful commands", async () => {
    const engine = new HookEngine({ cypheriaHome: homeDir })

    const userHooksConfig = {
      version: 1,
      hooks: {
        UserPromptSubmit: [
          {
            type: "command",
            command: "echo 'hello from user hook'",
          },
        ],
      },
    }

    await writeFile(engine.userHooksFilePath, JSON.stringify(userHooksConfig))

    const list = await engine.listHooks({ cwd: workDir })
    expect(list.hooks).toHaveLength(1)
    expect(list.hooks[0]).toMatchObject({
      command: "echo 'hello from user hook'",
      enabled: true,
      eventName: "userPromptSubmit",
      handlerType: "command",
      source: "user",
      trustStatus: "trusted",
    })

    const result = await engine.dispatch(
      "UserPromptSubmit",
      { prompt: "test prompt" },
      { agentId: "codex", threadId: "thread-1", cwd: workDir }
    )

    expect(result.status).toBe("completed")
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]?.status).toBe("completed")
    expect(result.feedback).toContain("hello from user hook")
  })

  it("handles project hooks, hash trust status, and modifications", async () => {
    const engine = new HookEngine({ cypheriaHome: homeDir })
    const projectCypheriaDir = join(workDir, ".cypheria")
    await mkdir(projectCypheriaDir, { recursive: true })
    const projectHooksFile = join(projectCypheriaDir, "hooks.json")

    const initialConfig = {
      version: 1,
      hooks: {
        PreToolUse: [
          {
            type: "command",
            command: "echo 'project hook run'",
          },
        ],
      },
    }
    await writeFile(projectHooksFile, JSON.stringify(initialConfig))

    // 1. Initially untrusted
    let list = await engine.listHooks({ cwd: workDir })
    expect(list.hooks).toHaveLength(1)
    const hook = list.hooks[0]
    if (!hook) throw new Error("expected a discovered hook")
    expect(hook.source).toBe("project")
    expect(hook.trustStatus).toBe("untrusted")
    expect(hook.currentHash).toBeTruthy()

    // Dispatch should skip untrusted project hook
    let result = await engine.dispatch(
      "PreToolUse",
      { toolName: "bash" },
      { agentId: "codex", threadId: "thread-1", cwd: workDir }
    )
    expect(result.runs).toHaveLength(0)

    // 2. Trust the hook
    await engine.trustHook(hook.key, hook.currentHash)

    list = await engine.listHooks({ cwd: workDir })
    expect(list.hooks[0]?.trustStatus).toBe("trusted")

    // Now dispatch runs it
    result = await engine.dispatch(
      "PreToolUse",
      { toolName: "bash" },
      { agentId: "codex", threadId: "thread-1", cwd: workDir }
    )
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]?.status).toBe("completed")

    // 3. Modifying the project hooks file changes hash to 'modified'
    const modifiedConfig = {
      version: 1,
      hooks: {
        PreToolUse: [
          {
            type: "command",
            command: "echo 'modified project hook run'",
          },
        ],
      },
    }
    await writeFile(projectHooksFile, JSON.stringify(modifiedConfig))

    list = await engine.listHooks({ cwd: workDir })
    expect(list.hooks[0]?.trustStatus).toBe("modified")

    // Modified hook is skipped until re-trusted
    result = await engine.dispatch(
      "PreToolUse",
      { toolName: "bash" },
      { agentId: "codex", threadId: "thread-1", cwd: workDir }
    )
    expect(result.runs).toHaveLength(0)
  })

  it("blocks dispatch when a hook exits with code 2", async () => {
    const engine = new HookEngine({ cypheriaHome: homeDir })

    const userHooksConfig = {
      version: 1,
      hooks: {
        UserPromptSubmit: [
          {
            type: "command",
            // Exit code 2 indicates Block per Hooks spec
            command:
              "node -e 'process.stderr.write(\"Dangerous prompt blocked by security policy\"); process.exit(2)'",
          },
        ],
      },
    }

    await writeFile(engine.userHooksFilePath, JSON.stringify(userHooksConfig))

    const result = await engine.dispatch(
      "UserPromptSubmit",
      { prompt: "rm -rf /" },
      { agentId: "claude", threadId: "thread-1", cwd: workDir }
    )

    expect(result.status).toBe("blocked")
    expect(result.blockedReason).toContain("Dangerous prompt blocked by security policy")
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]?.status).toBe("blocked")
  })

  it("skips plugin-level hooks when agent is codex, but executes them for non-codex agents", async () => {
    const engine = new HookEngine({ cypheriaHome: homeDir })

    const pluginDir = join(workDir, "test-plugin")
    await mkdir(join(pluginDir, "hooks"), { recursive: true })
    const pluginHooksFile = join(pluginDir, "hooks", "hooks.json")

    const pluginConfig = {
      version: 1,
      hooks: {
        UserPromptSubmit: [
          {
            type: "command",
            command: "echo 'plugin hook executed'",
          },
        ],
      },
    }
    await writeFile(pluginHooksFile, JSON.stringify(pluginConfig))

    // List hooks with plugin directory
    const list = await engine.listHooks({ pluginDirectories: [pluginDir] })
    expect(list.hooks).toHaveLength(1)
    expect(list.hooks[0]?.source).toBe("plugin")

    // 1. When agent is codex: plugin hook is skipped in Cypheria to avoid duplicate execution
    const codexRes = await engine.dispatch(
      "UserPromptSubmit",
      { prompt: "hi" },
      { agentId: "codex", threadId: "thread-1", cwd: workDir, pluginDirectories: [pluginDir] }
    )
    expect(codexRes.runs).toHaveLength(0)

    // 2. When agent is claude (non-codex): plugin hook runs in Cypheria layer
    const claudeRes = await engine.dispatch(
      "UserPromptSubmit",
      { prompt: "hi" },
      { agentId: "claude", threadId: "thread-1", cwd: workDir, pluginDirectories: [pluginDir] }
    )
    expect(claudeRes.runs).toHaveLength(1)
    expect(claudeRes.runs[0]?.status).toBe("completed")
    expect(claudeRes.feedback).toContain("plugin hook executed")
  })
})
