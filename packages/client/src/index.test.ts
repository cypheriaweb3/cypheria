import {
  type ClientMessage,
  parseWSInboundMessageText,
  type ServerMessage,
  stringifyProtocolMessage as stringifyEnvelope,
  wrapServerSessionMessage,
} from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"

import { client as createAcpApp } from "./acp.js"
import { client as createCodexApp } from "./codex.js"
import { type CypheriaApi, createCypheriaApi, createCypheriaClient } from "./index.js"
import { ServerClient } from "./server-client.js"
import { TestWebSocket, testWebSocketFactory } from "./test-websocket.js"

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const parseClientMessageText = (raw: string): ClientMessage => {
  const envelope = parseWSInboundMessageText(raw)
  if (envelope.type !== "session") throw new Error("Expected session envelope")
  return envelope.message
}

const stringifyProtocolMessage = (message: unknown): string =>
  stringifyEnvelope(wrapServerSessionMessage(message as ServerMessage))

const acceptConnection = async (connectPromise: Promise<void>): Promise<TestWebSocket> => {
  const socket = TestWebSocket.instances.at(-1)
  if (!socket) throw new Error("Expected a WebSocket")
  socket.open()
  const hello = parseWSInboundMessageText(socket.sent[0] ?? "")
  if (hello.type !== "hello") throw new Error("Expected hello")
  socket.message(
    stringifyProtocolMessage({
      payload: {
        capabilities: ["agent.acp", "agent.codex", "server.status"],
        connections: 1,
        hostname: "test",
        id: "srv_test",
        protocolVersion: 1,
        runtimeState: "ready",
        startedAt: "2026-09-11T00:00:00.000Z",
        version: "0.0.0",
        webApp: { enabled: false },
      },
      type: "server.status.notification",
    })
  )
  await connectPromise
  return socket
}

afterEach(() => TestWebSocket.reset())

describe("Cypheria client facade", () => {
  it("contains only protocol-defined capability groups", async () => {
    const serverClient = new ServerClient({
      clientId: "client-borrowed",
      webSocketFactory: testWebSocketFactory,
    })
    const api = createCypheriaApi(serverClient)

    expect(Object.keys(api).sort()).toEqual(["agent", "on", "server", "subscribe"])
    expect("wallet" in api).toBe(false)
    expect("policy" in api).toBe(false)
    expect("automation" in api).toBe(false)
    expect("connect" in api).toBe(false)
    expect("close" in api).toBe(false)
    expect(serverClient.getConnectionState()).toEqual({ status: "idle" })
    await serverClient.close()
  })

  it("accepts a borrowed CypheriaApi in both agent ClientApps", async () => {
    const serverClient = new ServerClient({
      clientId: "client-borrowed-agent-apps",
      webSocketFactory: testWebSocketFactory,
    })
    const cypheria: CypheriaApi = createCypheriaApi(serverClient)

    const codexConnection = createCodexApp().connect(cypheria)
    const acpConnection = createAcpApp().connect(cypheria)

    codexConnection.close()
    acpConnection.close()
    await serverClient.close()
  })

  it("owns lifecycle and lazily sends the server status request", async () => {
    const client = createCypheriaClient({
      clientId: "client-api",
      webSocketFactory: testWebSocketFactory,
    })
    const resultPromise = client.server.status()
    const socket = await acceptConnection(client.ensureConnected())
    await tick()

    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (request.type !== "server.status.request") throw new Error("Expected status request")
    socket.message(
      stringifyProtocolMessage({
        payload: {
          capabilities: ["server.status"],
          connections: 1,
          hostname: "test",
          id: "srv_test",
          protocolVersion: 1,
          runtimeState: "ready",
          startedAt: "2026-09-11T00:00:00.000Z",
          version: "0.0.0",
          webApp: { enabled: false },
        },
        requestId: request.requestId,
        type: "server.status.response",
      })
    )

    await expect(resultPromise).resolves.toMatchObject({ runtimeState: "ready" })
    expect(client.getSession()?.id).toBe("srv_test")
    await client.close()
  })

  it("exposes a Codex endpoint accepted by the SDK-shaped ClientApp", async () => {
    const client = createCypheriaClient({
      clientId: "client-codex",
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createCodexApp().connect(client)
    const socket = await acceptConnection(client.ensureConnected())
    const initializePromise = connection.codex.initialize({
      capabilities: null,
      clientInfo: { name: "cypheria-test", title: null, version: "0.0.0" },
    })
    await tick()
    const initializeRequest = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (initializeRequest.type !== "agent.codex.initialize.request") {
      throw new Error("Expected Codex initialize request")
    }
    socket.message(
      stringifyProtocolMessage({
        payload: {
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos",
          requestId: initializeRequest.requestId,
          userAgent: "codex-test",
        },
        type: "agent.codex.initialize.response",
      })
    )
    await initializePromise
    const resultPromise = connection.codex.request("memory/reset")
    await tick()

    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (request.type !== "agent.codex.memory.reset.request") {
      throw new Error("Expected Codex memory reset request")
    }
    socket.message(
      stringifyProtocolMessage({
        payload: { requestId: request.requestId },
        type: "agent.codex.memory.reset.response",
      })
    )

    await expect(resultPromise).resolves.toEqual({})
    connection.close()
    await client.close()
  })

  it("routes ACP protocol events", async () => {
    const client = createCypheriaClient({
      clientId: "client-events",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await acceptConnection(client.connect())
    const acpMessages: unknown[] = []
    const unsubscribeAcp = client.agent.acp.subscribe((message) => acpMessages.push(message))
    socket.message(
      stringifyProtocolMessage({
        payload: { method: "_example/update", params: {} },
        protocolVersion: 1,
        type: "agent.acp.extension.notification",
      })
    )

    expect(acpMessages).toEqual([
      {
        payload: { method: "_example/update", params: {} },
        protocolVersion: 1,
        type: "agent.acp.extension.notification",
      },
    ])
    unsubscribeAcp()
    await client.close()
  })

  it("routes notifications through the protocol message type", async () => {
    const client = createCypheriaClient({
      clientId: "client-notifications",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await acceptConnection(client.connect())
    const notifications: unknown[] = []
    const unsubscribe = client.on("agent.codex.skills.changed.notification", (message) =>
      notifications.push(message.payload)
    )

    socket.message(
      stringifyProtocolMessage({
        payload: {},
        type: "agent.codex.skills.changed.notification",
      })
    )

    expect(notifications).toEqual([{}])
    unsubscribe()
    await client.close()
  })

  it("returns the exact protocol pong payload", async () => {
    const client = createCypheriaClient({
      clientId: "client-ping",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await acceptConnection(client.connect())
    const resultPromise = client.server.ping()
    await tick()
    expect(parseWSInboundMessageText(socket.sent.at(-1) ?? "")).toEqual({ type: "ping" })
    socket.message(stringifyEnvelope({ type: "pong" }))

    await expect(resultPromise).resolves.toBeUndefined()
    await client.close()
  })
})
