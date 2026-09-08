import type { CodexAppServerBridge } from "@cypheria/codex-bridge"
import type { WebContents } from "electron"
import { describe, expect, it, vi } from "vitest"
import type { CodexChatEvent } from "../../ipc/src/index.js"
import {
  archiveCodexThread,
  createCodexProject,
  createCodexThreadSection,
  deleteCodexProject,
  deleteCodexThread,
  deleteCodexThreadSection,
  forkCodexThread,
  listCodexModels,
  listCodexProjects,
  listCodexThreadSections,
  listCodexThreads,
  mapCodexTurnsToUiMessages,
  moveCodexThreadToProject,
  moveCodexThreadToSection,
  queueCodexThreadMessage,
  readCodexAccount,
  readCodexModelSettings,
  readCodexThread,
  renameCodexThread,
  startCodexChat,
  startCodexLogin,
  steerCodexChat,
  updateCodexProject,
  updateCodexThreadSection,
  validateOpenAiApiKey,
  writeCodexModelSettings,
} from "./codex-desktop.js"

class FakeBridge {
  readonly calls: Array<{ method: string; params: unknown }> = []
  readonly errors = new Set<(error: unknown) => void>()
  readonly notifications = new Set<(event: unknown) => void>()
  constructor(private readonly responses: Record<string, unknown>) {}

  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    const response = this.responses[method]
    if (response === undefined) throw new Error(`Missing response for ${method}`)
    return response
  }

  on(_type: "notification", handler: (event: unknown) => void): () => void {
    this.notifications.add(handler)
    return () => this.notifications.delete(handler)
  }

  onError(handler: (error: unknown) => void): () => void {
    this.errors.add(handler)
    return () => this.errors.delete(handler)
  }

  emit(event: unknown): void {
    for (const handler of this.notifications) handler(event)
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
      updateCodexProject(asBridge(bridge), {
        id: "project-1",
        metadata: { "cypheria.sidebar.pinned": "true" },
        name: "Cypheria Desktop",
      })
    ).resolves.toMatchObject({ id: "project-1", name: "Cypheria Desktop" })
    await expect(deleteCodexProject(asBridge(bridge), "project-1")).resolves.toEqual({
      deleted: true,
    })
    expect(bridge.calls.find((call) => call.method === "project/create")?.params).toMatchObject({
      name: "Cypheria",
      roots: [{ path: "/work/cypheria" }],
    })
    expect(bridge.calls.find((call) => call.method === "project/update")?.params).toMatchObject({
      metadata: { "cypheria.sidebar.pinned": "true" },
      projectId: "project-1",
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

  it("forks a thread through a completed turn", async () => {
    const bridge = new FakeBridge({ "thread/fork": { thread: { id: "thread-fork" } } })

    await expect(forkCodexThread(asBridge(bridge), "thread-1", "turn-3")).resolves.toEqual({
      threadId: "thread-fork",
    })
    expect(bridge.calls).toContainEqual({
      method: "thread/fork",
      params: { excludeTurns: true, lastTurnId: "turn-3", threadId: "thread-1" },
    })
  })

  it("renames a thread through App Server", async () => {
    const bridge = new FakeBridge({ "thread/name/set": {} })
    await expect(renameCodexThread(asBridge(bridge), "thread-1", "Focused work")).resolves.toEqual({
      renamed: true,
    })
    expect(bridge.calls).toContainEqual({
      method: "thread/name/set",
      params: { name: "Focused work", threadId: "thread-1" },
    })
  })

  it("archives, deletes, and moves sidebar threads through App Server", async () => {
    const bridge = new FakeBridge({
      "thread/archive": {},
      "thread/delete": {},
      "thread/metadata/update": { thread: {} },
    })
    await expect(archiveCodexThread(asBridge(bridge), "thread-1")).resolves.toEqual({
      archived: true,
    })
    await expect(deleteCodexThread(asBridge(bridge), "thread-1")).resolves.toEqual({
      deleted: true,
    })
    await expect(moveCodexThreadToProject(asBridge(bridge), "thread-1", null)).resolves.toEqual({
      moved: true,
    })
    expect(bridge.calls).toContainEqual({
      method: "thread/metadata/update",
      params: { projectId: "", threadId: "thread-1" },
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
    const storedTurn = {
      completedAt: 20,
      durationMs: 10_000,
      error: null,
      id: "turn-1",
      items: [
        {
          clientId: null,
          content: [{ text: "Hello", text_elements: [], type: "text" as const }],
          id: "user-1",
          type: "userMessage" as const,
        },
        {
          delivery: null,
          id: "assistant-1",
          memoryCitation: null,
          phase: "final_answer" as const,
          questions: null,
          text: "Hi",
          type: "agentMessage" as const,
        },
      ],
      itemsView: "full" as const,
      startedAt: 10,
      status: "completed" as const,
    }
    const bridge = new FakeBridge({
      "thread/turns/list": { backwardsCursor: null, data: [storedTurn], nextCursor: null },
      "thread/read": { thread },
    })

    expect(mapCodexTurnsToUiMessages("thread-1", [storedTurn])).toMatchObject([
      { id: "user-1", parts: [{ text: "Hello", type: "text" }], role: "user" },
      {
        id: "turn-1",
        metadata: {
          durationMs: 10_000,
          id: "turn-1",
          status: "completed",
          threadId: "thread-1",
        },
        parts: [
          { id: "turn-1", type: "data-codex-turn" },
          { id: "user-1", type: "data-codex-item" },
          { id: "assistant-1", type: "data-codex-item" },
          {
            providerMetadata: {
              "cypheria.codex": {
                item: { id: "assistant-1", phase: "final_answer", type: "agentMessage" },
              },
            },
            text: "Hi",
            type: "text",
          },
        ],
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
      method: "thread/turns/list",
      params: {
        cursor: undefined,
        itemsView: "full",
        limit: 100,
        sortDirection: "asc",
        threadId: "thread-1",
      },
    })
  })

  it("injects reconciled Codex turn data into the live AI SDK UI stream", async () => {
    const inProgressTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-live",
      items: [],
      itemsView: "full" as const,
      startedAt: 10,
      status: "inProgress" as const,
    }
    const bridge = new FakeBridge({
      "thread/start": { thread: { id: "thread-live" } },
      "turn/start": { turn: inProgressTurn },
      "turn/steer": { turnId: "turn-live" },
    })
    const events: CodexChatEvent[] = []
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: CodexChatEvent) => events.push(event),
    } as unknown as WebContents

    startCodexChat(asBridge(bridge), sender, {
      chatId: "chat-live",
      messages: [{ id: "user-live", parts: [{ text: "Hello", type: "text" }], role: "user" }],
      model: "test-model",
      provider: "openai",
      requestId: "01991111-1111-7111-8111-111111111111",
      permissionSelection: { agentMode: "auto", kind: "agent-mode" },
    })

    await vi.waitFor(() => expect(bridge.notifications.size).toBe(1))
    await expect(
      steerCodexChat("01991111-1111-7111-8111-111111111111", {
        files: [],
        text: "Focus on tests",
      })
    ).resolves.toBe(true)
    expect(bridge.calls).toContainEqual({
      method: "turn/steer",
      params: {
        expectedTurnId: "turn-live",
        input: [{ text: "Focus on tests", text_elements: [], type: "text" }],
        threadId: "thread-live",
      },
    })
    const startedItem = {
      delivery: null,
      id: "agent-live",
      memoryCitation: null,
      phase: "final_answer" as const,
      questions: null,
      text: "",
      type: "agentMessage" as const,
    }
    bridge.emit({
      method: "item/started",
      params: {
        item: startedItem,
        startedAtMs: 10_000,
        threadId: "thread-live",
        turnId: "turn-live",
      },
    })
    bridge.emit({
      method: "item/agentMessage/delta",
      params: {
        delta: "Done",
        itemId: "agent-live",
        threadId: "thread-live",
        turnId: "turn-live",
      },
    })
    const completedItem = { ...startedItem, text: "Done" }
    bridge.emit({
      method: "item/completed",
      params: {
        completedAtMs: 11_000,
        item: completedItem,
        threadId: "thread-live",
        turnId: "turn-live",
      },
    })
    bridge.emit({
      method: "turn/completed",
      params: {
        threadId: "thread-live",
        turn: {
          ...inProgressTurn,
          completedAt: 11,
          durationMs: 1_000,
          items: [completedItem],
          status: "completed",
        },
      },
    })

    await vi.waitFor(() => expect(events.some((event) => event.type === "done")).toBe(true))
    const chunks = events.flatMap((event) => (event.type === "chunk" ? [event.chunk] : []))
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "start" }),
        expect.objectContaining({ id: "turn-live", type: "data-codex-turn" }),
        expect.objectContaining({
          data: expect.objectContaining({
            item: expect.objectContaining({ id: "agent-live", text: "Done" }),
            lifecycle: "completed",
          }),
          id: "agent-live",
          type: "data-codex-item",
        }),
        expect.objectContaining({ type: "text-start" }),
        expect.objectContaining({ delta: "Done", type: "text-delta" }),
      ])
    )
  })

  it("queues validated follow-up input for the next turn", async () => {
    const bridge = new FakeBridge({
      "thread/queue/add": {
        queuedSubmission: {
          clientUserMessageId: "01992222-2222-7222-8222-222222222222",
          id: "queued-1",
          input: [],
        },
      },
    })

    await expect(
      queueCodexThreadMessage(
        asBridge(bridge),
        "thread-1",
        "01992222-2222-7222-8222-222222222222",
        {
          files: [
            { mediaType: "image/png", url: "data:image/png;base64,AQID" },
            { filename: "note.m4a", mediaType: "audio/m4a", url: "data:audio/m4a;base64,AQID" },
          ],
          text: "Continue next",
        }
      )
    ).resolves.toBe("queued-1")
    expect(bridge.calls).toContainEqual({
      method: "thread/queue/add",
      params: {
        clientUserMessageId: "01992222-2222-7222-8222-222222222222",
        input: [
          { text: "Continue next", text_elements: [], type: "text" },
          { type: "image", url: "data:image/png;base64,AQID" },
          { type: "audio", url: "data:audio/m4a;base64,AQID" },
        ],
        threadId: "thread-1",
      },
    })
  })
})
