import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  type AppApprovalDecision,
  type AppApprovalRequest,
  CodexComputerUseBackend,
  type RuntimeClient,
} from "../src/host/computer/codex.ts"
import {
  codexComputerUseEnvironment,
  findCodexComputerUseServer,
  nativeCodexBinary,
} from "../src/host/computer/codex-discovery.ts"
import type { ToolResult } from "../src/host/computer/cua-driver.ts"

const MARKER = "\u0000cypheria-result:"

/** A fake runtime that evaluates each `js` call's sky method against canned answers. */
const fakeRuntime = (answers: Record<string, unknown | Error>) => {
  const calls: { name: string; args: Record<string, unknown>; meta?: Record<string, unknown> }[] =
    []
  let onRequest: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined
  let closed = 0
  const client: RuntimeClient = {
    callTool: async (name, args, options) => {
      calls.push({ args, name, ...(options?.meta ? { meta: options.meta } : {}) })
      if (name !== "js") return { content: [] }
      const code = String(args.code)
      const method = /cua\.computer\.(\w+)\(/.exec(code)?.[1] ?? ""
      const input = JSON.parse(/cua\.computer\.\w+\((.*)\);\n/.exec(code)?.[1] ?? "{}")
      if (method === "get_app_state" && input.app === "Locked") {
        await onRequest?.("elicitation/create", {
          _meta: {
            connector_id: "computer-use",
            persist: ["session", "always"],
            riskLevel: "high",
            tool_params: { app: "com.example.locked" },
            tool_params_display: [{ name: "app", value: "Locked App" }],
          },
          message: 'Allow Computer Use to use "Locked App"?',
        })
      }
      if (method === "start_audio_recording") {
        const answer = (await onRequest?.("elicitation/create", {
          _meta: {
            connector_id: "computer-use",
            persist: ["session"],
            riskLevel: "high",
            tool_name: "start_audio_recording",
            tool_params: {},
            tool_params_display: [],
          },
          message: "Allow Computer Use to record computer audio?",
        })) as { action?: string } | undefined
        if (answer?.action !== "accept") {
          return {
            content: [
              {
                text: `${MARKER}${JSON.stringify({ code: null, message: "Computer Use was not approved to record computer audio", name: "Error", ok: false })}`,
                type: "text",
              },
            ],
          }
        }
      }
      const answer = answers[method]
      const content: ToolResult["content"][number][] = [
        { text: "## Computer Use docs", type: "text" },
      ]
      if (answer instanceof Error) {
        content.push({
          text: `${MARKER}${JSON.stringify({ code: -10012, message: answer.message, name: answer.name, ok: false })}`,
          type: "text",
        })
      } else {
        content.push({
          text: `${MARKER}${JSON.stringify({ ok: true, value: answer ?? null })}`,
          type: "text",
        })
        if (code.includes("if (true &&"))
          content.push({ data: "aW1n", mimeType: "image/jpeg", type: "image" })
      }
      return { content }
    },
    close: () => {
      closed++
    },
  }
  return {
    calls,
    client: (_launch: unknown, handler: typeof onRequest) => {
      onRequest = handler
      return client
    },
    closed: () => closed,
    inputs: () =>
      calls
        .filter((call) => call.name === "js")
        .map((call) => {
          const code = String(call.args.code)
          return {
            input: JSON.parse(/cua\.computer\.\w+\((.*)\);\n/.exec(code)?.[1] ?? "{}"),
            method: /cua\.computer\.(\w+)\(/.exec(code)?.[1],
          }
        }),
  }
}

const launch = { args: [], command: "/bin/true", env: {} }

describe("CodexComputerUseBackend", () => {
  afterEach(() => vi.useRealTimers())

  const setup = (
    answers: Record<string, unknown | Error>,
    approve: (
      threadId: string,
      request: AppApprovalRequest
    ) => Promise<AppApprovalDecision> = async () => "session"
  ) => {
    const runtime = fakeRuntime(answers)
    const runClient = vi.fn(async () => undefined)
    const unavailable = vi.fn()
    const backend = new CodexComputerUseBackend({
      approve,
      client: runtime.client,
      launch: () => launch,
      onUnavailable: unavailable,
      runClient,
      serviceApp: () => "/Users/me/.codex/computer-use/Codex Computer Use.app",
    })
    return { approve, backend, runClient, runtime, unavailable }
  }

  it("maps app requests onto the sky API with the Thread's turn metadata", async () => {
    const { backend, runtime } = setup({
      get_app_state: {
        app: "/System/Applications/Calculator.app",
        text: "0 window\n\t1 button AllClear",
      },
      list_apps: [
        { displayName: "Calculator", id: "com.apple.calculator", isRunning: true },
        { displayName: "Notes", id: "com.apple.Notes" },
      ],
    })
    expect(await backend.listApps("t1")).toEqual([
      { bundleId: "com.apple.calculator", name: "Calculator", running: true },
      { bundleId: "com.apple.Notes", name: "Notes", running: false },
    ])
    const { binding, observation } = await backend.getApp("t1", "Calculator")
    expect(binding).toMatchObject({ bundleId: "com.apple.calculator", name: "Calculator" })
    expect(observation.text).toContain("AllClear")
    const shot = await backend.observe("t1", binding, { screenshot: true, tree: false })
    expect(shot.image).toEqual({ dataBase64: "aW1n", mimeType: "image/jpeg" })
    expect((await backend.observe("t1", binding, { query: "allclear" })).text).toBe(
      "\t1 button AllClear"
    )
    await backend.act("t1", binding, { target: 1, type: "click", count: 2 })
    await backend.act("t1", binding, { target: [10, 20], type: "click", button: "right" })
    await backend.act("t1", binding, { element: 3, text: "42", type: "type" })
    await backend.act("t1", binding, { key: "Control_L+a", type: "press" })
    await backend.act("t1", binding, {
      by: "page",
      amount: 2,
      direction: "down",
      target: 1,
      type: "scroll",
    })
    await backend.act("t1", binding, { format: "md", text: "**x**", type: "paste" })
    await backend.act("t1", binding, {
      element: 3,
      text: "4",
      type: "select_text",
      selectionType: "cursor_after",
    })
    expect(runtime.inputs().slice(5)).toEqual([
      { input: { app: "com.apple.calculator", click_count: 2, element_index: 1 }, method: "click" },
      {
        input: { app: "com.apple.calculator", mouse_button: "right", x: 10, y: 20 },
        method: "click",
      },
      { input: { app: "com.apple.calculator", element_index: 3 }, method: "click" },
      { input: { app: "com.apple.calculator", text: "42" }, method: "type_text" },
      { input: { app: "com.apple.calculator", key: "Control_L+a" }, method: "press_key" },
      {
        input: { app: "com.apple.calculator", direction: "down", element_index: 1, pages: 2 },
        method: "scroll",
      },
      { input: { app: "com.apple.calculator", format: "md", text: "**x**" }, method: "paste" },
      {
        input: {
          app: "com.apple.calculator",
          element_index: 3,
          selection_type: "cursor_after",
          text: "4",
        },
        method: "select_text",
      },
    ])
    expect(runtime.inputs()[3]).toEqual({
      input: { app: "com.apple.calculator", disableDiff: true },
      method: "get_app_state",
    })
    expect(runtime.calls[0]?.meta).toEqual({
      "x-codex-turn-metadata": { session_id: "t1", turn_id: "t1:1" },
    })
    await expect(backend.act("t1", binding, { path: ["File"], type: "menu" })).rejects.toThrow(
      /no menu API/
    )
    await expect(backend.listWindows("t1")).rejects.toThrow(/binds apps/)
  })

  it("keeps bindings per Thread", async () => {
    const { backend } = setup({ get_app_state: { text: "" }, list_apps: [] })
    const { binding } = await backend.getApp("t1", "com.apple.Notes")
    await expect(backend.observe("t2", binding, {})).rejects.toThrow(/not bound/)
  })

  it("turns the runtime's app approvals into Thread approvals", async () => {
    const approve = vi.fn(
      async (_threadId: string, _request: AppApprovalRequest) => "always" as const
    )
    const { backend } = setup({ get_app_state: { text: "" }, list_apps: [] }, approve)
    await backend.getApp("t1", "Locked")
    expect(approve).toHaveBeenCalledWith("t1", {
      allowAlways: true,
      app: "com.example.locked",
      displayName: "Locked App",
      kind: "app",
      risk: "high",
    })
  })

  it("records computer audio after the Thread approves it", async () => {
    const approve = vi.fn(async () => "session" as const)
    const { backend, runtime } = setup(
      { start_audio_recording: null, stop_audio_recording: { filepath: "/tmp/a.wav" } },
      approve
    )
    await backend.startAudioRecording("t1", 5000)
    expect(approve).toHaveBeenCalledWith("t1", { allowAlways: false, kind: "audio", risk: "high" })
    await expect(backend.stopAudioRecording("t1")).resolves.toEqual({
      mimeType: "audio/wav",
      path: "/tmp/a.wav",
    })
    expect(runtime.inputs()).toEqual([
      { input: { max_duration_ms: 5000 }, method: "start_audio_recording" },
      { input: {}, method: "stop_audio_recording" },
    ])
    // The recording's bytes stay out of the text the runtime returns.
    expect(String(runtime.calls.at(-1)?.args.code)).toContain("data_url: undefined")
  })

  it("refuses to record when the Thread declines", async () => {
    const { backend } = setup({ start_audio_recording: null }, async () => "deny")
    await expect(backend.startAudioRecording("t1")).rejects.toThrow(/not approved/)
  })

  it("reports a user stop and disables itself when the service refuses the runtime", async () => {
    const stopped = Object.assign(new Error("Computer Use was stopped."), {
      name: "userStoppedSession",
    })
    const refused = Object.assign(new Error("Incompatible."), { name: "incompatibleClientVersion" })
    const first = setup({ get_app_state: stopped })
    await expect(first.backend.getApp("t1", "Notes")).rejects.toMatchObject({
      code: "user_stopped",
    })
    const second = setup({ get_app_state: refused })
    await expect(second.backend.getApp("t1", "Notes")).rejects.toMatchObject({
      code: "computer_unavailable",
    })
    expect(second.unavailable).toHaveBeenCalledOnce()
  })

  it("ends turns in the runtime and the service, then starts the next turn", async () => {
    const { backend, runClient, runtime } = setup({ list_apps: [] })
    await backend.listApps("t1")
    await backend.turnEnded("t1")
    expect(runtime.calls.at(-1)).toMatchObject({
      args: { hook_event_name: "Stop", session_id: "t1", turn_id: "t1:1" },
      name: "turn_ended",
    })
    expect(runClient).toHaveBeenCalledWith(
      "/Users/me/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
      ["turn-ended", '{"thread-id":"t1","turn-id":"t1:1","type":"agent-turn-complete"}']
    )
    await backend.listApps("t1")
    expect(runtime.calls.at(-1)?.meta).toEqual({
      "x-codex-turn-metadata": { session_id: "t1", turn_id: "t1:2" },
    })
  })

  it("stops a Thread's runtime when it closes or idles", async () => {
    vi.useFakeTimers()
    const runtime = fakeRuntime({ list_apps: [] })
    const backend = new CodexComputerUseBackend({
      approve: async () => "deny",
      client: runtime.client,
      idleMs: 1_000,
      launch: () => launch,
    })
    await backend.listApps("t1")
    await vi.advanceTimersByTimeAsync(1_001)
    expect(runtime.closed()).toBe(1)
    await backend.listApps("t1")
    backend.closeThread("t1")
    expect(runtime.closed()).toBe(2)
  })
})

describe("Codex Computer Use discovery", () => {
  let home: string | undefined
  afterEach(() => {
    if (home) rmSync(home, { force: true, recursive: true })
  })

  const writeServer = (version: string, env: Record<string, string> = {}) => {
    const dir = join(
      home ?? "",
      ".codex",
      "plugins",
      "cache",
      "openai-bundled",
      "unified-computer-use",
      version
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { cua_repl: { args: ["/cua-repl.mjs"], command: "/node", env } },
      })
    )
  }

  it("prefers the installed ChatGPT's version, then the newest", () => {
    home = mkdtempSync(join(tmpdir(), "codex-cu-"))
    writeServer("26.9.1")
    writeServer("26.10.2")
    writeServer("26.930.31730")
    expect(findCodexComputerUseServer(home, "26.10.2")?.version).toBe("26.10.2")
    expect(findCodexComputerUseServer(home, "27.0.0")?.version).toBe("26.930.31730")
    expect(findCodexComputerUseServer(join(home, "missing"), undefined)).toBeNull()
  })

  it("rewrites ChatGPT's environment for Cypheria's Codex and native apps only", () => {
    const env = codexComputerUseEnvironment(
      {
        args: [],
        command: "/node",
        env: {
          BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab,mcpapps",
          CODEX_CLI_PATH: "/Applications/ChatGPT.app/codex",
          CODEX_HOME: "/Users/me/.codex",
          CUA_REPL_ENABLED_SURFACES: "browser,computer",
          NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME: "Control Chrome",
          NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE: "Control desktop apps",
          NODE_REPL_TRUSTED_CODE_PATHS: "/Users/me/.codex:/Applications/ChatGPT.app/node_modules",
          NODE_REPL_TRUSTED_SERVICES:
            '{"browser":"@oai/browser-desktop/service","sky":"@oai/sky/service"}',
          SKY_CUA_SERVICE_PATH: "/Users/me/.codex/computer-use/Codex Computer Use.app",
        },
        path: "/x/.mcp.json",
        version: "1",
      },
      {
        codexCli: "/cypheria/codex",
        codexHome: "/Users/me/.cypheria/agents/codex/home",
        path: "/usr/bin",
      }
    )
    expect(env).toEqual({
      CODEX_CLI_PATH: "/cypheria/codex",
      CODEX_HOME: "/Users/me/.cypheria/agents/codex/home",
      CUA_REPL_ENABLED_SURFACES: "computer",
      HOME: process.env.HOME,
      NODE_REPL_INSTRUCTIONS_USE_CASE_COMPUTER_USE: "Control desktop apps",
      NODE_REPL_TRUSTED_CODE_PATHS:
        "/Users/me/.cypheria/agents/codex/home:/Applications/ChatGPT.app/node_modules",
      NODE_REPL_TRUSTED_SERVICES: '{"sky":"@oai/sky/service"}',
      PATH: "/usr/bin",
      SKY_CUA_SERVICE_PATH: "/Users/me/.codex/computer-use/Codex Computer Use.app",
      SKY_ENABLE_AUDIO: "1",
    })
  })

  it("finds the native Codex beside the npm launcher", () => {
    home = mkdtempSync(join(tmpdir(), "codex-bin-"))
    const scope = join(home, "node_modules", "@openai")
    mkdirSync(join(scope, "codex", "bin"), { recursive: true })
    writeFileSync(join(scope, "codex", "bin", "codex.js"), "")
    const vendor = join(scope, "codex-darwin-arm64", "vendor", "aarch64-apple-darwin", "bin")
    mkdirSync(vendor, { recursive: true })
    const executable = join(vendor, process.platform === "win32" ? "codex.exe" : "codex")
    writeFileSync(executable, "")
    expect(
      nativeCodexBinary({ args: [join(scope, "codex", "bin", "codex.js")], command: "/node" })
    ).toBe(executable)
    expect(nativeCodexBinary({ command: "/opt/codex" })).toBe("/opt/codex")
    expect(nativeCodexBinary({ args: ["/x.js"], command: "/node" })).toBeNull()
  })
})
