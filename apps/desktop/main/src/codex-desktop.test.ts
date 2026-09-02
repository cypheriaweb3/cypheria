import type { CodexAppServerBridge } from "@cypheria/codex-bridge"
import { describe, expect, it } from "vitest"
import {
  listCodexModels,
  listCodexThreads,
  readCodexAccount,
  readCodexModelSettings,
  startCodexLogin,
  writeCodexModelSettings,
} from "./codex-desktop.js"

class FakeBridge {
  readonly calls: Array<{ method: string; params: unknown }> = []
  constructor(private readonly responses: Record<string, unknown>) {}

  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    const response = this.responses[method]
    if (response === undefined) throw new Error(`Missing response for ${method}`)
    return response
  }

  on(): () => void {
    return () => undefined
  }
}

const asBridge = (bridge: FakeBridge) => bridge as unknown as CodexAppServerBridge

describe("desktop Codex services", () => {
  it("maps account state and starts the hosted ChatGPT login flow", async () => {
    const bridge = new FakeBridge({
      "account/login/start": {
        authUrl: "https://auth.example.test",
        loginId: "login-1",
        type: "chatgpt",
      },
      "account/read": {
        account: { email: "dev@example.test", planType: "pro", type: "chatgpt" },
        requiresOpenaiAuth: true,
      },
    })

    await expect(readCodexAccount(asBridge(bridge))).resolves.toEqual({
      email: "dev@example.test",
      planType: "pro",
      requiresOpenaiAuth: true,
      type: "chatgpt",
    })
    await expect(startCodexLogin(asBridge(bridge), { type: "chatgpt" })).resolves.toMatchObject({
      loginId: "login-1",
      type: "chatgpt",
    })
    expect(bridge.calls.at(-1)).toEqual({
      method: "account/login/start",
      params: {
        appBrand: "codex",
        codexStreamlinedLogin: true,
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
      },
    })
  })

  it("loads model metadata through the AI SDK provider", async () => {
    const bridge = new FakeBridge({
      "model/list": {
        data: [
          {
            defaultReasoningEffort: "medium",
            defaultServiceTier: null,
            description: "Model",
            displayName: "GPT",
            hidden: false,
            id: "gpt",
            inputModalities: ["text"],
            isDefault: true,
            model: "gpt",
            supportedReasoningEfforts: [{ description: "Fast", reasoningEffort: "low" }],
            serviceTiers: [],
          },
        ],
        nextCursor: null,
      },
    })
    await expect(listCodexModels(asBridge(bridge))).resolves.toEqual([
      expect.objectContaining({
        displayName: "GPT",
        model: "gpt",
        reasoningEfforts: [{ description: "Fast", value: "low" }],
      }),
    ])
  })

  it("reads and writes only Codex-native model settings", async () => {
    const bridge = new FakeBridge({
      "config/batchWrite": {},
      "config/read": {
        config: {
          model: "local-model",
          model_provider: "ollama",
          model_reasoning_effort: null,
          service_tier: null,
        },
      },
    })
    await expect(readCodexModelSettings(asBridge(bridge))).resolves.toEqual({
      model: "local-model",
      provider: "ollama",
      reasoningEffort: null,
      serviceTier: null,
    })
    await writeCodexModelSettings(asBridge(bridge), {
      model: "local-model",
      provider: "ollama",
      reasoningEffort: "medium",
      serviceTier: null,
    })
    expect(bridge.calls.find((call) => call.method === "config/batchWrite")?.params).toMatchObject({
      edits: expect.arrayContaining([
        { keyPath: "model_provider", mergeStrategy: "replace", value: "ollama" },
      ]),
      reloadUserConfig: true,
    })
  })

  it("maps recent tasks for the desktop sidebar", async () => {
    const bridge = new FakeBridge({
      "thread/list": {
        data: [
          {
            cwd: "/work/cypheria",
            id: "thread-1",
            modelProvider: "openai",
            name: "Desktop UI",
            preview: "",
            projectId: "project-1",
            status: { type: "idle" },
            updatedAt: 42,
          },
        ],
        nextCursor: null,
      },
    })
    await expect(listCodexThreads(asBridge(bridge), {})).resolves.toEqual([
      {
        cwd: "/work/cypheria",
        id: "thread-1",
        modelProvider: "openai",
        projectId: "project-1",
        status: "idle",
        title: "Desktop UI",
        updatedAt: 42,
      },
    ])
  })
})
