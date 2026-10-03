import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ExtensionServerMessage,
  ServerMessage,
  ThreadTimelineItem,
  ThreadView,
} from "@cypheria/protocol"
import { describe, expect, it, vi } from "vitest"

import type { McpHost, McpServerInventory } from "./mcp-host.js"
import { ExtensionService, type ExtensionThreads } from "./service.js"

const inventory: McpServerInventory = {
  capabilities: {
    extensions: { "openai/settings": { readTool: "settings.read", updateTool: "settings.update" } },
  },
  error: null,
  name: "bits",
  pluginId: "bits@market",
  serverInfo: { icons: null, name: "bits", title: "Bits" },
  tools: [
    {
      _meta: {
        "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
        ui: { resourceUri: "ui://bits/app", visibility: ["app"] },
      },
      name: "open",
    },
    {
      _meta: {
        "openai/ui": { entrypoints: [{ extensions: [".stl"], type: "file" }] },
        ui: { resourceUri: "ui://bits/viewer", visibility: ["app"] },
      },
      name: "viewer",
    },
    { _meta: { ui: { visibility: ["app"] } }, name: "app.only" },
    {
      _meta: { "openai/extensions": { "mentions/search": {} }, ui: { visibility: ["app"] } },
      name: "mentions",
    },
    { _meta: { ui: { visibility: ["model"] } }, name: "model.only" },
    { name: "settings.read" },
    { name: "settings.update" },
  ],
}

let roots: string[] = ["/nonexistent"]

const setup = (overrides: Partial<McpHost> = {}) => {
  const callTool = vi.fn<McpHost["callTool"]>(async (input) => ({
    content: [{ text: `called ${input.tool}`, type: "text" }],
    structuredContent:
      input.tool === "settings.read"
        ? {
            schema: { properties: { units: { title: "Units", type: "string" } }, type: "object" },
            values: { units: "mm" },
          }
        : input.tool === "settings.update"
          ? { values: { units: "in" } }
          : input.tool === "mentions"
            ? {
                items: [
                  {
                    name: "hex-bolt",
                    title: "M6 hex bolt",
                    type: "resource_link",
                    uri: "cad://bolt",
                  },
                ],
              }
            : { tool: input.tool },
  }))
  const readResource = vi.fn<McpHost["readResource"]>(async (input) =>
    input.uri === "cad://bolt"
      ? [{ mimeType: "text/plain", text: "M6 x 20 hex bolt", uri: "cad://bolt" }]
      : [
          {
            _meta: { "openai/ui": { preferredDisplayMode: "fullscreen" }, ui: { csp: {} } },
            mimeType: "text/html;profile=mcp-app",
            text: "x".repeat(450_000),
            uri: "ui://bits/app",
          },
        ]
  )
  const host: McpHost = {
    agentId: "codex",
    callTool,
    listServers: async () => [inventory],
    readResource,
    support: { fullMetadata: true, serverResources: true, toolCalls: true },
    threadSession: async () => false,
    ...overrides,
  }
  const broadcast = vi.fn<(message: ServerMessage) => void>()
  const startTurn = vi.fn<ExtensionThreads["startTurn"]>(async () => ({}))
  const items = new Map<string, ThreadTimelineItem>()
  const service = new ExtensionService({
    broadcast,
    hosts: [host],
    threads: {
      create: async () => "new-thread",
      findItem: async (_threadId, itemId) => items.get(itemId) ?? null,
      get: async (threadId) => ({ agentId: "codex", id: threadId, roots }) as ThreadView,
      startTurn,
    },
  })
  const client = (id: string) => {
    const notifications: ServerMessage[] = []
    return { id, notifications, notify: (message: ServerMessage) => notifications.push(message) }
  }
  const call = async (
    message: Record<string, unknown>,
    from: { id: string; notify(message: ServerMessage): void }
  ) => {
    let response: ExtensionServerMessage | undefined
    await service.handle({ requestId: "r", ...message } as never, from, (sent) => {
      response = sent
    })
    const payload = (response as { payload: { ok: boolean; value?: unknown; error?: unknown } })
      .payload
    if (!payload.ok) throw Object.assign(new Error("request failed"), { error: payload.error })
    return payload.value as Record<string, unknown>
  }
  return { broadcast, call, callTool, client, items, readResource, service, startTurn }
}

describe("ExtensionService", () => {
  it("opens a global entry point once and shares the instance with a second client", async () => {
    const { call, callTool, client, readResource } = setup()
    const catalog = await call({ payload: {}, type: "extension.catalog.get.request" }, client("a"))
    const entrypoints = catalog.entrypoints as { id: string; type: string }[]
    const global = entrypoints.find((entry) => entry.type === "global")
    const target = { entrypointId: global?.id, kind: "entrypoint" }
    const first = (
      await call({ payload: { target }, type: "extension.app.open.request" }, client("a"))
    ).instance as Record<string, unknown>
    const second = (
      await call({ payload: { target }, type: "extension.app.open.request" }, client("b"))
    ).instance as Record<string, unknown>
    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      agentId: "codex",
      displayMode: "fullscreen",
      pluginId: "bits@market",
      server: "bits",
      tool: "open",
      toolInput: {},
      toolResult: { structuredContent: { tool: "open" } },
    })
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(readResource).toHaveBeenCalledTimes(1)
  })

  it("serves App HTML in pieces", async () => {
    const { call, client, service } = setup()
    const catalog = await service.catalog()
    const target = { entrypointId: catalog.entrypoints[0]?.id, kind: "entrypoint" }
    const instance = (
      await call({ payload: { target }, type: "extension.app.open.request" }, client("a"))
    ).instance as { id: string }
    const pieces: string[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const page = await call(
        {
          payload: { instanceId: instance.id, offset },
          type: "extension.app.resource.read.request",
        },
        client("a")
      )
      pieces.push(page.text as string)
      offset = page.nextOffset as number | null
    }
    expect(pieces.map((piece) => piece.length)).toEqual([200_000, 200_000, 50_000])
  })

  it("lets Apps call only their entry tool and App-visible tools", async () => {
    const { call, callTool, client, service } = setup()
    const catalog = await service.catalog()
    const target = { entrypointId: catalog.entrypoints[0]?.id, kind: "entrypoint" }
    const { id } = (
      await call({ payload: { target }, type: "extension.app.open.request" }, client("a"))
    ).instance as { id: string }
    const request = (name: string) =>
      call(
        {
          payload: { instanceId: id, method: "tools/call", params: { arguments: { q: 1 }, name } },
          type: "extension.app.request.request",
        },
        client("a")
      )
    await expect(request("app.only")).resolves.toMatchObject({
      result: { structuredContent: { tool: "app.only" } },
    })
    await expect(request("model.only")).rejects.toMatchObject({
      error: { code: "EXTENSION_FORBIDDEN" },
    })
    expect(callTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ arguments: { q: 1 }, session: { kind: "host" }, tool: "app.only" })
    )
  })

  it("requires a Thread for Thread entry points and calls in the Thread's session when loaded", async () => {
    const { call, callTool, client, service } = setup({ threadSession: async () => true })
    const catalog = await service.catalog()
    const thread = catalog.entrypoints.find((entry) => entry.type === "thread")
    await expect(
      call(
        {
          payload: { target: { entrypointId: thread?.id, kind: "entrypoint" } },
          type: "extension.app.open.request",
        },
        client("a")
      )
    ).rejects.toMatchObject({ error: { code: "EXTENSION_INVALID" } })
    await call(
      {
        payload: { target: { entrypointId: thread?.id, kind: "entrypoint", threadId: "t1" } },
        type: "extension.app.open.request",
      },
      client("a")
    )
    expect(callTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ session: { kind: "thread", threadId: "t1" } })
    )
  })

  it("drops an instance when its last client closes or disconnects", async () => {
    const { call, client, service } = setup()
    const catalog = await service.catalog()
    const target = { entrypointId: catalog.entrypoints[0]?.id, kind: "entrypoint" }
    const { id } = (
      await call({ payload: { target }, type: "extension.app.open.request" }, client("a"))
    ).instance as { id: string }
    await call({ payload: { target }, type: "extension.app.open.request" }, client("b"))
    await call({ payload: { instanceId: id }, type: "extension.app.close.request" }, client("a"))
    await call(
      { payload: { instanceId: id, offset: 0 }, type: "extension.app.resource.read.request" },
      client("b")
    )
    service.detach("b")
    await expect(
      call(
        { payload: { instanceId: id }, type: "extension.app.resource.read.request" },
        client("b")
      )
    ).rejects.toMatchObject({ error: { code: "EXTENSION_NOT_FOUND" } })
  })

  it("reads and updates structured settings through the host session", async () => {
    const { call, callTool, client, service } = setup()
    const catalog = await service.catalog()
    const providerId = catalog.settings[0]?.id
    await expect(
      call({ payload: { providerId }, type: "extension.settings.read.request" }, client("a"))
    ).resolves.toMatchObject({ layout: [], values: { units: "mm" } })
    await expect(
      call(
        {
          payload: { providerId, set: { units: "in" } },
          type: "extension.settings.update.request",
        },
        client("a")
      )
    ).resolves.toEqual({ values: { units: "in" } })
    expect(callTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ arguments: { set: { units: "in" } }, session: { kind: "host" } })
    )
  })

  it("sends a call's elicitation to the client that made the call", async () => {
    let service: ExtensionService | undefined
    const harness = setup({
      callTool: async (input) => {
        const answer = await service?.elicit({
          message: "Pick a part",
          mode: "form",
          openai: true,
          requestedSchema: { type: "object" },
          server: input.server,
          url: null,
        })
        return { content: [], structuredContent: { answer } }
      },
    })
    service = harness.service
    const a = harness.client("a")
    const catalog = await service.catalog()
    const opening = harness.call(
      {
        payload: { target: { entrypointId: catalog.entrypoints[0]?.id, kind: "entrypoint" } },
        type: "extension.app.open.request",
      },
      a
    )
    await vi.waitFor(() => expect(a.notifications).toHaveLength(1))
    const elicitation = a.notifications[0] as Extract<
      ServerMessage,
      { type: "extension.elicitation.notification" }
    >
    expect(elicitation.payload).toMatchObject({
      message: "Pick a part",
      openai: true,
      server: "bits",
    })
    await harness.call(
      {
        payload: {
          action: "accept",
          content: { part: "bolt" },
          elicitationId: elicitation.payload.id,
        },
        type: "extension.elicitation.respond.request",
      },
      a
    )
    const { instance } = await opening
    expect(instance).toMatchObject({
      toolResult: {
        structuredContent: { answer: { action: "accept", content: { part: "bolt" } } },
      },
    })
  })

  it("announces a changed catalog", async () => {
    let tools = inventory.tools
    const { broadcast, service } = setup({
      listServers: async () => [{ ...inventory, tools }],
    })
    await service.catalog()
    tools = inventory.tools.slice(1)
    await service.catalog(true)
    expect(broadcast).toHaveBeenCalledWith({
      payload: { revision: 2 },
      type: "extension.catalog.updated.notification",
    })
  })

  it("attaches App model context to the Thread's next message and clears it once sent", async () => {
    const { call, client, service } = setup()
    const catalog = await service.catalog()
    const thread = catalog.entrypoints.find((entry) => entry.type === "thread")
    const a = client("a")
    const { id } = (
      await call(
        {
          payload: { target: { entrypointId: thread?.id, kind: "entrypoint", threadId: "t1" } },
          type: "extension.app.open.request",
        },
        a
      )
    ).instance as { id: string }
    const request = (method: string, params: Record<string, unknown>) =>
      call(
        { payload: { instanceId: id, method, params }, type: "extension.app.request.request" },
        a
      )
    const update = (await request("ui/update-model-context", {
      content: [
        { _meta: { "openai/title": "Part" }, text: "Selected: M6 bolt", type: "text" },
        { annotations: { audience: ["assistant"] }, text: "part=m6", type: "text" },
      ],
      structuredContent: { part: "m6" },
    })) as { result: { _meta: { "openai/modelContext": { updateId: string } } } }
    expect(update.result._meta["openai/modelContext"].updateId).toBeTruthy()
    await expect(
      request("ui/update-model-context", {
        content: [{ data: "x", mimeType: "audio/wav", type: "audio" }],
      })
    ).rejects.toBeTruthy()
    const listed = await call(
      { payload: { threadId: "t1" }, type: "extension.context.list.request" },
      a
    )
    expect(listed.entries).toMatchObject([
      { pluginId: "bits@market", structuredContent: { part: "m6" }, title: "open" },
    ])
    expect(a.notifications.at(-1)).toEqual({
      payload: {
        instanceId: id,
        method: "ui/notifications/host-context-changed",
        params: {
          "openai/modelContext": expect.objectContaining({ structuredContent: { part: "m6" } }),
        },
      },
      type: "extension.app.notification",
    })
    const input = await service.extensionInput("t1")
    expect(input?.blocks).toEqual([
      { text: "\nContext from open:\n", type: "text" },
      { text: "Selected: M6 bolt", type: "text" },
      { text: "part=m6", type: "text" },
      { text: '{"part":"m6"}', type: "text" },
    ])
    input?.commit()
    expect(await service.extensionInput("t1")).toBeNull()
    expect(a.notifications.at(-1)).toMatchObject({
      payload: { params: { "openai/modelContext": null } },
    })
  })

  it("removes one block or an App's whole context from the composer", async () => {
    const { call, client, service } = setup()
    const catalog = await service.catalog()
    const thread = catalog.entrypoints.find((entry) => entry.type === "thread")
    const { id } = (
      await call(
        {
          payload: { target: { entrypointId: thread?.id, kind: "entrypoint", threadId: "t1" } },
          type: "extension.app.open.request",
        },
        client("a")
      )
    ).instance as { id: string }
    await call(
      {
        payload: {
          instanceId: id,
          method: "ui/update-model-context",
          params: {
            content: [
              { text: "one", type: "text" },
              { text: "two", type: "text" },
            ],
          },
        },
        type: "extension.app.request.request",
      },
      client("a")
    )
    const [entry] = (
      await call(
        { payload: { threadId: "t1" }, type: "extension.context.list.request" },
        client("a")
      )
    ).entries as { key: string }[]
    await call(
      {
        payload: { index: 0, key: entry?.key, threadId: "t1" },
        type: "extension.context.remove.request",
      },
      client("a")
    )
    expect(
      (
        await call(
          { payload: { threadId: "t1" }, type: "extension.context.list.request" },
          client("a")
        )
      ).entries
    ).toMatchObject([{ content: [{ text: "two" }] }])
    await call(
      { payload: { key: entry?.key, threadId: "t1" }, type: "extension.context.remove.request" },
      client("a")
    )
    expect(
      (
        await call(
          { payload: { threadId: "t1" }, type: "extension.context.list.request" },
          client("a")
        )
      ).entries
    ).toEqual([])
  })

  it("keeps a global page's context until its first chat, and follows the chat beside it", async () => {
    const { call, client, service, startTurn } = setup()
    const catalog = await service.catalog()
    const global = catalog.entrypoints.find((entry) => entry.type === "global")
    const a = client("a")
    const opened = (
      await call(
        {
          payload: { target: { entrypointId: global?.id, kind: "entrypoint" } },
          type: "extension.app.open.request",
        },
        a
      )
    ).instance as { id: string; capabilities: { modelContext: boolean }; threadId: null }
    expect(opened.capabilities.modelContext).toBe(true)
    const request = (method: string, params: Record<string, unknown>) =>
      call(
        {
          payload: { instanceId: opened.id, method, params },
          type: "extension.app.request.request",
        },
        a
      )
    await request("ui/update-model-context", { content: [{ text: "part=m6", type: "text" }] })
    expect(a.notifications.at(-1)).toMatchObject({
      payload: { params: { "openai/modelContext": { content: [{ text: "part=m6" }] } } },
    })

    // The first message starts a chat; the App follows it with the context it attached.
    await expect(
      request("ui/message", { content: [{ text: "Hi", type: "text" }], role: "user" })
    ).resolves.toEqual({ result: { _meta: { "cypheria/threadId": "new-thread" } } })
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ threadId: "new-thread" }))
    expect((await service.extensionInput("new-thread"))?.blocks).toContainEqual({
      text: "part=m6",
      type: "text",
    })

    // A new chat starts empty of messages but keeps the App's context.
    const unbound = (
      await call(
        { payload: { instanceId: opened.id, threadId: null }, type: "extension.app.bind.request" },
        a
      )
    ).instance as { threadId: string | null; hostContext: Record<string, unknown> }
    expect(unbound.threadId).toBeNull()
    expect(unbound.hostContext["openai/modelContext"]).toMatchObject({
      content: [{ text: "part=m6" }],
    })
    const rebound = (
      await call(
        { payload: { instanceId: opened.id, threadId: "t2" }, type: "extension.app.bind.request" },
        a
      )
    ).instance as { threadId: string | null }
    expect(rebound.threadId).toBe("t2")
    expect((await service.extensionInput("t2"))?.blocks).toContainEqual({
      text: "part=m6",
      type: "text",
    })

    // Another client opening the page beside that chat shares the instance.
    const shared = (
      await call(
        {
          payload: { target: { entrypointId: global?.id, kind: "entrypoint", threadId: "t2" } },
          type: "extension.app.open.request",
        },
        client("b")
      )
    ).instance as { id: string }
    expect(shared.id).toBe(opened.id)

    const thread = catalog.entrypoints.find((entry) => entry.type === "thread")
    const other = (
      await call(
        {
          payload: { target: { entrypointId: thread?.id, kind: "entrypoint", threadId: "t1" } },
          type: "extension.app.open.request",
        },
        a
      )
    ).instance as { id: string }
    await expect(
      call(
        { payload: { instanceId: other.id, threadId: null }, type: "extension.app.bind.request" },
        a
      )
    ).rejects.toBeTruthy()
  })

  it("sends App messages to the instance's chat, or a new one, recording the App as origin", async () => {
    const { call, client, service, startTurn } = setup()
    const catalog = await service.catalog()
    const thread = catalog.entrypoints.find((entry) => entry.type === "thread")
    const { id } = (
      await call(
        {
          payload: { target: { entrypointId: thread?.id, kind: "entrypoint", threadId: "t1" } },
          type: "extension.app.open.request",
        },
        client("a")
      )
    ).instance as { id: string }
    const send = (target?: string) =>
      call(
        {
          payload: {
            instanceId: id,
            method: "ui/message",
            params: {
              content: [{ text: "Design a bracket", type: "text" }],
              role: "user",
              ...(target ? { _meta: { "openai/message": { target } } } : {}),
            },
          },
          type: "extension.app.request.request",
        },
        client("a")
      )
    await expect(send()).resolves.toEqual({ result: { _meta: { "cypheria/threadId": "t1" } } })
    await expect(send("new")).resolves.toEqual({
      result: { _meta: { "cypheria/threadId": "new-thread" } },
    })
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [{ text: "Design a bracket", type: "text" }],
        origin: { kind: "extension", pluginId: "bits@market", server: "bits", title: "open" },
        threadId: "t1",
      })
    )
    await expect(send("elsewhere")).rejects.toMatchObject({ error: { code: "EXTENSION_INVALID" } })
  })

  it("renders a model tool call's App from its recorded input and result", async () => {
    const { call, callTool, client, items } = setup()
    items.set("call-1", {
      app: {
        displayMode: null,
        pluginId: "bits@market",
        resourceUri: "ui://bits/app",
        server: "bits",
        tool: "open",
      },
      error: null,
      input: { part: "m6" },
      itemId: "call-1",
      name: "bits/open",
      output: { content: [{ text: "ok", type: "text" }], structuredContent: { part: "m6" } },
      status: "completed",
      type: "tool",
    })
    const { instance } = (await call(
      {
        payload: { target: { itemId: "call-1", kind: "tool-call", threadId: "t1" } },
        type: "extension.app.open.request",
      },
      client("a")
    )) as { instance: Record<string, unknown> }
    expect(instance).toMatchObject({
      capabilities: { message: true, modelContext: true },
      displayMode: "fullscreen",
      threadId: "t1",
      toolInput: { part: "m6" },
      toolResult: { structuredContent: { part: "m6" } },
    })
    expect(callTool).not.toHaveBeenCalled()
    await expect(
      call(
        {
          payload: { target: { itemId: "missing", kind: "tool-call", threadId: "t1" } },
          type: "extension.app.open.request",
        },
        client("a")
      )
    ).rejects.toMatchObject({ error: { code: "EXTENSION_NOT_FOUND" } })
  })

  it("opens a workspace file through an opaque URI and serves, writes, and watches it", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "cypheria-file-entry-"))
    const outside = await mkdtemp(join(tmpdir(), "cypheria-file-outside-"))
    try {
      roots = [workspace]
      await mkdir(join(workspace, "parts"))
      const part = join(workspace, "parts", "bolt.stl")
      await writeFile(part, "solid bolt\n")
      await writeFile(join(outside, "secret.stl"), "secret")
      await symlink(join(outside, "secret.stl"), join(workspace, "link.stl"))
      const { call, callTool, client, service } = setup()
      const catalog = await service.catalog()
      const viewer = catalog.entrypoints.find((entry) => entry.type === "file")
      expect(viewer?.extensions).toEqual(["stl"])
      const open = (path: string) =>
        call(
          {
            payload: {
              target: { entrypointId: viewer?.id, kind: "entrypoint", path, threadId: "t1" },
            },
            type: "extension.app.open.request",
          },
          a
        )
      const a = client("a")
      await expect(open(join(workspace, "link.stl"))).rejects.toBeTruthy()
      await expect(open(join(outside, "secret.stl"))).rejects.toBeTruthy()
      const { instance } = (await open(part)) as {
        instance: {
          capabilities: { resource: boolean }
          id: string
          toolInput: { file: { name: string; resourceUri: string } }
        }
      }
      const { resourceUri, name } = instance.toolInput.file
      expect(name).toBe("bolt.stl")
      expect(resourceUri).toMatch(/^cypheria-resource:\/\//u)
      expect(resourceUri).not.toContain("bolt")
      expect(instance.capabilities.resource).toBe(true)
      expect(callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: { "openai/resource": { path: expect.stringContaining("bolt.stl") } },
          tool: "viewer",
        })
      )
      const request = (method: string, params: Record<string, unknown>) =>
        call(
          {
            payload: { instanceId: instance.id, method, params },
            type: "extension.app.request.request",
          },
          a
        ) as Promise<{ result: Record<string, unknown> }>
      const read = await request("resources/read", { uri: resourceUri })
      const content = (read.result.contents as Record<string, unknown>[])[0]
      expect(content).toMatchObject({
        _meta: { "openai/resource": { writable: true } },
        text: "solid bolt\n",
        uri: resourceUri,
      })
      const etag = (content?._meta as { "openai/resource": { etag: string } })["openai/resource"]
        .etag
      await expect(
        request("resources/read", {
          _meta: { "openai/resource": { representation: "blob" } },
          uri: resourceUri,
        })
      ).resolves.toMatchObject({
        result: { contents: [{ blob: Buffer.from("solid bolt\n").toString("base64") }] },
      })
      await expect(
        request("openai/resources/write", { ifMatch: "stale", text: "x", uri: resourceUri })
      ).resolves.toMatchObject({ result: { etag, outcome: "conflict" } })
      await request("resources/subscribe", { uri: resourceUri })
      await expect(
        request("openai/resources/write", {
          ifMatch: etag,
          text: "solid edited\n",
          uri: resourceUri,
        })
      ).resolves.toMatchObject({ result: { outcome: "saved" } })
      expect(await readFile(part, "utf8")).toBe("solid edited\n")
      await vi.waitFor(() =>
        expect(a.notifications).toContainEqual({
          payload: {
            instanceId: instance.id,
            method: "notifications/resources/updated",
            params: { uri: resourceUri },
          },
          type: "extension.app.notification",
        })
      )
      await expect(
        request("openai/resources/write", { text: "x", uri: "cypheria-resource://other/1" })
      ).rejects.toMatchObject({ error: { code: "EXTENSION_FORBIDDEN" } })
      await request("tools/call", { arguments: {}, name: "app.only" })
      expect(callTool).toHaveBeenLastCalledWith(
        expect.objectContaining({
          meta: { "openai/resource": { path: expect.stringContaining("bolt.stl") } },
        })
      )
      await expect(request("openai/files/open", { path: part })).resolves.toMatchObject({
        result: {
          _meta: { "cypheria/file": { path: expect.stringContaining("bolt.stl"), threadId: "t1" } },
        },
      })
      await expect(
        request("openai/files/open", { path: join(outside, "secret.stl") })
      ).rejects.toBeTruthy()
      await call({ payload: { instanceId: instance.id }, type: "extension.app.close.request" }, a)
    } finally {
      roots = ["/nonexistent"]
      await rm(workspace, { force: true, recursive: true })
      await rm(outside, { force: true, recursive: true })
    }
  })

  it("searches plugin mentions and reads a mentioned resource for the message", async () => {
    const { callTool, service } = setup()
    const groups = await service.searchMentions({ query: "bolt" })
    expect(groups).toEqual([
      {
        error: null,
        items: [
          {
            description: null,
            mimeType: null,
            name: "hex-bolt",
            title: "M6 hex bolt",
            uri: "cad://bolt",
          },
        ],
        providerId: expect.any(String),
      },
    ])
    expect(callTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ arguments: { query: "bolt" }, tool: "mentions" })
    )
    await expect(
      service.resolveMention({
        label: "M6 hex bolt",
        providerId: groups[0]?.providerId ?? "",
        threadId: null,
        uri: "cad://bolt",
      })
    ).resolves.toEqual({
      text: "[M6 hex bolt](cad://bolt) (from Bits):\nM6 x 20 hex bolt",
      type: "text",
    })
    await expect(
      service.resolveMention({
        label: "Gone",
        providerId: "missing",
        threadId: null,
        uri: "cad://x",
      })
    ).resolves.toEqual({ text: "[Gone](cad://x)", type: "text" })
  })
})
