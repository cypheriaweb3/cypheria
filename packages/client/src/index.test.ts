import { parseClientMessageText, stringifyProtocolMessage } from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"

import { client as createCodexApp } from "./codex.js"
import { createCypheriaApi, createCypheriaClient } from "./index.js"
import { ServerClient } from "./server-client.js"
import { TestWebSocket, testWebSocketFactory } from "./test-websocket.js"

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const acceptConnection = async (connectPromise: Promise<void>): Promise<TestWebSocket> => {
  const socket = TestWebSocket.instances.at(-1)
  if (!socket) throw new Error("Expected a WebSocket")
  socket.open()
  const hello = parseClientMessageText(socket.sent[0] ?? "")
  if (hello.type !== "session.hello") throw new Error("Expected session hello")
  socket.message(
    stringifyProtocolMessage({
      payload: {
        capabilities: ["runtime.request"],
        server: {
          hostname: "test",
          id: "srv_test",
          protocolVersion: 1,
          startedAt: "2026-09-11T00:00:00.000Z",
          version: "0.0.0",
        },
        sessionId: "ses_test",
      },
      requestId: hello.requestId,
      type: "session.ready",
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

    expect(Object.keys(api).sort()).toEqual(["agent", "on", "runtime", "server", "subscribe"])
    expect(Object.keys(api.runtime).sort()).toEqual(["request", "subscribe"])
    expect("wallet" in api).toBe(false)
    expect("policy" in api).toBe(false)
    expect("automation" in api).toBe(false)
    expect("connect" in api).toBe(false)
    expect("close" in api).toBe(false)
    expect(serverClient.getConnectionState()).toEqual({ status: "idle" })
    await serverClient.close()
  })

  it("owns lifecycle and lazily sends the generic runtime request", async () => {
    const client = createCypheriaClient({
      clientId: "client-api",
      webSocketFactory: testWebSocketFactory,
    })
    const resultPromise = client.runtime.request<{ lifecycleState: string }>("runtime.info")
    const socket = await acceptConnection(client.ensureConnected())
    await tick()

    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (request.type !== "runtime.request") throw new Error("Expected runtime request")
    expect(request.payload).toEqual({ method: "runtime.info" })
    socket.message(
      stringifyProtocolMessage({
        payload: { result: { lifecycleState: "ready" } },
        requestId: request.requestId,
        type: "runtime.response",
      })
    )

    await expect(resultPromise).resolves.toEqual({ lifecycleState: "ready" })
    expect(client.getSession()?.sessionId).toBe("ses_test")
    await client.close()
  })

  it("exposes a Codex endpoint accepted by the SDK-shaped ClientApp", async () => {
    const client = createCypheriaClient({
      clientId: "client-codex",
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createCodexApp().connect(client.agent.codex)
    const resultPromise = connection.codex.request("memory/reset")
    const socket = await acceptConnection(client.ensureConnected())
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

  it("routes runtime and ACP protocol events", async () => {
    const client = createCypheriaClient({
      clientId: "client-events",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await acceptConnection(client.connect())
    const runtimeEvents: unknown[] = []
    const acpMessages: unknown[] = []
    const unsubscribeRuntime = client.runtime.subscribe((event) => runtimeEvents.push(event))
    const unsubscribeAcp = client.agent.acp.subscribe((payload) => acpMessages.push(payload))

    socket.message(
      stringifyProtocolMessage({
        payload: { event: { type: "runtime.lifecycle" } },
        type: "runtime.event",
      })
    )
    socket.message(
      stringifyProtocolMessage({
        payload: {
          message: { jsonrpc: "2.0", method: "example/update", params: {} },
          protocolVersion: 1,
        },
        type: "agent.acp.server.message",
      })
    )

    expect(runtimeEvents).toEqual([{ type: "runtime.lifecycle" }])
    expect(acpMessages).toHaveLength(1)
    unsubscribeRuntime()
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
    const resultPromise = client.server.ping("2026-09-11T01:00:00.000Z")
    await tick()
    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (request.type !== "server.ping") throw new Error("Expected ping")
    socket.message(
      stringifyProtocolMessage({
        payload: {
          clientSentAt: "2026-09-11T01:00:00.000Z",
          serverReceivedAt: "2026-09-11T01:00:00.001Z",
          serverSentAt: "2026-09-11T01:00:00.002Z",
        },
        requestId: request.requestId,
        type: "server.pong",
      })
    )

    await expect(resultPromise).resolves.toEqual({
      clientSentAt: "2026-09-11T01:00:00.000Z",
      serverReceivedAt: "2026-09-11T01:00:00.001Z",
      serverSentAt: "2026-09-11T01:00:00.002Z",
    })
    await client.close()
  })
})
