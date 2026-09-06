import {
  type AnyMessage,
  agent,
  type InitializeRequest,
  methods,
  PROTOCOL_VERSION,
  type RequestPermissionResponse,
  type Stream,
} from "@agentclientprotocol/sdk"
import { describe, expect, it } from "vitest"
import { createACPProvider } from "../src/provider.js"

function streamPair(): [Stream, Stream] {
  const clientToAgent = new TransformStream<AnyMessage, AnyMessage>()
  const agentToClient = new TransformStream<AnyMessage, AnyMessage>()
  return [
    { writable: clientToAgent.writable, readable: agentToClient.readable },
    { writable: agentToClient.writable, readable: clientToAgent.readable },
  ]
}

describe("ACP 1.4 protocol integration", () => {
  it("uses app-style routing, negotiates capabilities, preserves usage, and denies permission", async () => {
    const [clientStream, agentStream] = streamPair()
    let initializeRequest: InitializeRequest | undefined
    let permission: RequestPermissionResponse | undefined

    const agentConnection = agent({ name: "test-agent" })
      .onRequest(methods.agent.initialize, ({ params }) => {
        initializeRequest = params
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            promptCapabilities: { image: true, audio: true, embeddedContext: true },
            sessionCapabilities: { list: {}, delete: {}, resume: {}, close: {} },
          },
          authMethods: [],
        }
      })
      .onRequest(methods.agent.session.new, () => ({ sessionId: "session-1" }))
      .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
        permission = await client.request(methods.client.session.requestPermission, {
          sessionId: params.sessionId,
          toolCall: { toolCallId: "tool-1", title: "Sensitive operation" },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        })
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: "usage_update", used: 120, size: 4096 },
        })
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello from ACP 1.4" },
          },
        })
        return { stopReason: "end_turn" }
      })
      .connect(agentStream)

    const provider = createACPProvider({
      transport: { type: "stream", connect: () => clientStream },
      session: { cwd: "/tmp", mcpServers: [] },
    })

    const result = await provider.languageModel().doGenerate({
      prompt: [{ role: "user", content: "hello" }],
    })

    expect(result.content).toContainEqual({ type: "text", text: "hello from ACP 1.4" })
    expect(result.usage.raw).toEqual({
      sessionUpdate: "usage_update",
      used: 120,
      size: 4096,
    })
    expect(permission).toEqual({ outcome: { outcome: "cancelled" } })
    expect(initializeRequest?.clientCapabilities?.fs).toEqual({
      readTextFile: false,
      writeTextFile: false,
    })
    expect(initializeRequest?.clientCapabilities?.terminal).toBe(false)

    provider.cleanup()
    agentConnection.close()
  })

  it("advertises and routes only installed client handlers", async () => {
    const [clientStream, agentStream] = streamPair()
    let initializeRequest: InitializeRequest | undefined
    const reads: unknown[] = []
    let callbackError: unknown
    const clientOperations: string[] = []

    const agentConnection = agent({ name: "callback-agent" })
      .onRequest(methods.agent.initialize, ({ params }) => {
        initializeRequest = params
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { promptCapabilities: {} },
          authMethods: [],
        }
      })
      .onRequest(methods.agent.session.new, () => ({ sessionId: "session-2" }))
      .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
        try {
          const file = await client.request(methods.client.fs.readTextFile, {
            sessionId: params.sessionId,
            path: "/workspace/context.txt",
          })
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: file.content },
            },
          })
        } catch (error) {
          callbackError = error
        }
        return { stopReason: "end_turn" }
      })
      .connect(agentStream)

    const provider = createACPProvider({
      transport: { type: "stream", connect: () => clientStream },
      session: { cwd: "/workspace", mcpServers: [] },
      handlers: {
        fileSystem: {
          readTextFile: async (request) => {
            reads.push(request)
            return { content: "file callback reached" }
          },
        },
      },
    })
    provider.onEvent((event) => {
      if (event.type === "client-operation") clientOperations.push(event.method)
    })

    const result = await provider.languageModel().doGenerate({
      prompt: [{ role: "user", content: "read context" }],
    })

    expect(callbackError).toBeUndefined()
    expect(result.content).toContainEqual({ type: "text", text: "file callback reached" })
    expect(reads).toEqual([
      { sessionId: "session-2", path: "/workspace/context.txt", line: undefined, limit: undefined },
    ])
    expect(clientOperations).toContain(methods.client.fs.readTextFile)
    expect(initializeRequest?.clientCapabilities?.fs).toEqual({
      readTextFile: true,
      writeTextFile: false,
    })
    expect(initializeRequest?.clientCapabilities?.terminal).toBe(false)
    expect(initializeRequest?.clientCapabilities?.elicitation).toBeUndefined()

    provider.cleanup()
    agentConnection.close()
  })

  it("negotiates NES suggestion kinds and position encodings", async () => {
    const [clientStream, agentStream] = streamPair()
    let initializeRequest: InitializeRequest | undefined

    const agentConnection = agent({ name: "nes-agent" })
      .onRequest(methods.agent.initialize, ({ params }) => {
        initializeRequest = params
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            promptCapabilities: {},
            nes: { events: { document: { didOpen: {} } } },
            positionEncoding: "utf-8" as const,
          },
          authMethods: [],
        }
      })
      .connect(agentStream)

    const provider = createACPProvider({
      transport: { type: "stream", connect: () => clientStream },
      session: { cwd: "/workspace", mcpServers: [] },
      experimental: {
        controls: true,
        nes: {
          jump: true,
          searchAndReplace: true,
          positionEncodings: ["utf-8", "utf-16"],
        },
      },
    })

    await provider.connect()

    expect(initializeRequest?.clientCapabilities?.nes).toEqual({
      jump: {},
      searchAndReplace: {},
    })
    expect(initializeRequest?.clientCapabilities?.positionEncodings).toEqual(["utf-8", "utf-16"])

    provider.cleanup()
    agentConnection.close()
  })
})
