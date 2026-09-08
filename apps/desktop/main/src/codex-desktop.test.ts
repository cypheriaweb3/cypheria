import type { CodexAppServerBridge } from "@cypheria/codex-bridge"
import { describe, expect, it } from "vitest"
import {
  createCodexProject,
  createCodexThreadSection,
  deleteCodexProject,
  deleteCodexThreadSection,
  listCodexModels,
  listCodexProjects,
  listCodexThreadSections,
  listCodexThreads,
  mapCodexThreadItemsToUiMessages,
  moveCodexThreadToSection,
  readCodexAccount,
  readCodexModelSettings,
  readCodexThread,
  startCodexLogin,
  updateCodexProject,
  updateCodexThreadSection,
  validateOpenAiApiKey,
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

  it("validates an API key before passing it to Codex", async () => {
    const bridge = new FakeBridge({
      "account/login/start": { type: "apiKey" },
    })
    const validatedKeys: string[] = []

    await expect(
      startCodexLogin(asBridge(bridge), { apiKey: "sk-test", type: "apiKey" }, async (apiKey) => {
        validatedKeys.push(apiKey)
      })
    ).resolves.toEqual({ type: "apiKey" })
    expect(validatedKeys).toEqual(["sk-test"])
    expect(bridge.calls).toEqual([
      {
        method: "account/login/start",
        params: { apiKey: "sk-test", type: "apiKey" },
      },
    ])
  })

  it("does not store an API key when validation fails", async () => {
    const bridge = new FakeBridge({
      "account/login/start": { type: "apiKey" },
    })

    await expect(
      startCodexLogin(asBridge(bridge), { apiKey: "sk-invalid", type: "apiKey" }, async () => {
        throw new Error("OpenAI rejected this API key. Check the key and try again.")
      })
    ).rejects.toThrow("OpenAI rejected this API key")
    expect(bridge.calls).toEqual([])
  })

  it("validates API keys with OpenAI bearer authentication", async () => {
    await expect(
      validateOpenAiApiKey("sk-valid", async (input, init) => {
        expect(input).toBe("https://api.openai.com/v1/models")
        expect(init?.headers).toEqual({ Authorization: "Bearer sk-valid" })
        return new Response(null, { status: 200 })
      })
    ).resolves.toBeUndefined()

    await expect(
      validateOpenAiApiKey(
        "sk-invalid",
        async () =>
          new Response(JSON.stringify({ error: { message: "Incorrect API key provided." } }), {
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_test",
            },
            status: 401,
          })
      )
    ).rejects.toThrow(
      "OpenAI API key validation failed (HTTP 401): Incorrect API key provided. Request ID: req_test"
    )

    await expect(
      validateOpenAiApiKey(
        "sk-forbidden",
        async () =>
          new Response(JSON.stringify({ error: { message: "Project access is disabled." } }), {
            headers: { "content-type": "application/json" },
            status: 403,
          })
      )
    ).rejects.toThrow("OpenAI API key validation failed (HTTP 403): Project access is disabled.")
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

  it("maps recent chats for the desktop sidebar", async () => {
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
    await expect(
      listCodexThreads(asBridge(bridge), {
        cursor: "next-page",
        limit: 5,
        sectionId: null,
      })
    ).resolves.toEqual({
      data: [
        {
          cwd: "/work/cypheria",
          id: "thread-1",
          modelProvider: "openai",
          projectId: "project-1",
          sectionId: null,
          sectionName: null,
          status: "idle",
          title: "Desktop UI",
          updatedAt: 42,
        },
      ],
      nextCursor: null,
    })
    expect(bridge.calls.at(-1)).toMatchObject({
      method: "thread/list",
      params: {
        cursor: "next-page",
        limit: 5,
        sectionId: null,
        sortDirection: "desc",
        sortKey: "updated_at",
      },
    })
  })

  it("manages App Server projects through desktop views", async () => {
    const project = {
      createdAt: 1,
      id: "project-1",
      metadata: {},
      name: "Cypheria",
      position: 0,
      recencyAt: null,
      roots: [{ path: "/work/cypheria" }],
      updatedAt: 2,
    }
    const bridge = new FakeBridge({
      "project/create": { project },
      "project/delete": {},
      "project/list": { data: [project], nextCursor: null },
      "project/update": { project: { ...project, name: "Cypheria Desktop" } },
    })

    await expect(listCodexProjects(asBridge(bridge))).resolves.toEqual({
      data: [expect.objectContaining({ id: "project-1", roots: ["/work/cypheria"] })],
      nextCursor: null,
    })
    await expect(
      createCodexProject(asBridge(bridge), { name: "Cypheria", root: "/work/cypheria" })
    ).resolves.toMatchObject({ id: "project-1", name: "Cypheria" })
    await expect(
      updateCodexProject(asBridge(bridge), { id: "project-1", name: "Cypheria Desktop" })
    ).resolves.toMatchObject({ id: "project-1", name: "Cypheria Desktop" })
    await expect(deleteCodexProject(asBridge(bridge), "project-1")).resolves.toEqual({
      deleted: true,
    })
    expect(bridge.calls.find((call) => call.method === "project/create")?.params).toMatchObject({
      name: "Cypheria",
      roots: [{ path: "/work/cypheria" }],
    })
  })

  it("manages App Server thread sections through desktop views", async () => {
    const section = { appearance: null, id: "section-1", name: "Research" }
    const bridge = new FakeBridge({
      "thread/section/move": {},
      "threadSection/create": { section },
      "threadSection/delete": {},
      "threadSection/list": { data: [section], nextCursor: null },
      "threadSection/update": { section: { ...section, name: "Design" } },
    })

    await expect(listCodexThreadSections(asBridge(bridge))).resolves.toEqual({
      data: [{ id: "section-1", name: "Research" }],
      nextCursor: null,
    })
    await expect(createCodexThreadSection(asBridge(bridge), "Research")).resolves.toEqual({
      id: "section-1",
      name: "Research",
    })
    await expect(
      updateCodexThreadSection(asBridge(bridge), { id: "section-1", name: "Design" })
    ).resolves.toEqual({ id: "section-1", name: "Design" })
    await expect(
      moveCodexThreadToSection(asBridge(bridge), {
        sectionId: "section-1",
        threadId: "thread-1",
      })
    ).resolves.toEqual({ moved: true })
    await expect(deleteCodexThreadSection(asBridge(bridge), "section-1")).resolves.toEqual({
      deleted: true,
    })
  })

  it("hydrates stored thread items as AI SDK UI messages", async () => {
    const thread = {
      cwd: "/work/cypheria",
      id: "thread-1",
      name: "History",
      preview: "",
      projectId: "project-1",
    }
    const entries = [
      {
        item: {
          clientId: null,
          content: [{ text: "Hello", text_elements: [], type: "text" as const }],
          id: "user-1",
          type: "userMessage" as const,
        },
        turnId: "turn-1",
      },
      {
        item: {
          delivery: null,
          id: "assistant-1",
          memoryCitation: null,
          phase: null,
          questions: null,
          text: "Hi",
          type: "agentMessage" as const,
        },
        turnId: "turn-1",
      },
    ]
    const bridge = new FakeBridge({
      "thread/items/list": { backwardsCursor: null, data: entries, nextCursor: null },
      "thread/read": { thread },
    })

    expect(mapCodexThreadItemsToUiMessages(entries)).toEqual([
      { id: "user-1", parts: [{ text: "Hello", type: "text" }], role: "user" },
      {
        id: "turn-turn-1",
        metadata: "turn-1",
        parts: [{ text: "Hi", type: "text" }],
        role: "assistant",
      },
    ])
    await expect(readCodexThread(asBridge(bridge), "thread-1")).resolves.toMatchObject({
      id: "thread-1",
      messages: expect.arrayContaining([expect.objectContaining({ id: "user-1" })]),
      projectId: "project-1",
      title: "History",
    })
    expect(bridge.calls).toContainEqual({
      method: "thread/items/list",
      params: { cursor: undefined, limit: 100, sortDirection: "asc", threadId: "thread-1" },
    })
  })
})
