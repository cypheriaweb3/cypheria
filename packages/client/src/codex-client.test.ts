import { parseClientMessageText, stringifyProtocolMessage } from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"

import * as codex from "./codex.js"
import { ClientApp, client as createCodexApp, methods } from "./codex.js"
import { createCypheriaClient } from "./index.js"
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
        capabilities: ["agent.codex"],
        server: {
          hostname: "test",
          id: "srv_test",
          protocolVersion: 1,
          startedAt: "2026-09-12T00:00:00.000Z",
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

describe("Cypheria Codex client API", () => {
  it("runs typed async requests through ClientContext", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-codex-request",
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createCodexApp().connect(cypheria.agent.codex)
    const resultPromise = connection.codex.request(methods.server.request["memory/reset"])
    const socket = await acceptConnection(cypheria.connect())
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
    await cypheria.close()
  })

  it("awaits reverse-request handlers and writes the typed response", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-codex-reverse-request",
      webSocketFactory: testWebSocketFactory,
    })
    const app = createCodexApp().onRequest(
      methods.client.request["currentTime/read"],
      async ({ params, requestId, signal }) => {
        expect(params.threadId).toBe("thread-1")
        expect(requestId).toBe("current-time-1")
        expect(signal.aborted).toBe(false)
        await tick()
        return { currentTimeAt: 1_789_000_000 }
      }
    )
    const connection = app.connect(cypheria.agent.codex)
    const socket = await acceptConnection(cypheria.connect())

    socket.message(
      stringifyProtocolMessage({
        requestId: "current-time-1",
        threadId: "thread-1",
        type: "agent.codex.current_time.read.request",
      })
    )
    await tick()
    await tick()

    expect(parseClientMessageText(socket.sent.at(-1) ?? "")).toEqual({
      payload: { currentTimeAt: 1_789_000_000, requestId: "current-time-1" },
      type: "agent.codex.current_time.read.response",
    })

    connection.close()
    await cypheria.close()
  })

  it("dispatches server notifications through fluent handlers", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-codex-notification",
      webSocketFactory: testWebSocketFactory,
    })
    let handled = false
    const app = createCodexApp().onNotification(
      methods.client.notification["skills/changed"],
      ({ params, signal }) => {
        expect(params).toEqual({})
        expect(signal.aborted).toBe(false)
        handled = true
      }
    )
    const connection = app.connect(cypheria.agent.codex)
    const socket = await acceptConnection(cypheria.connect())

    socket.message(
      stringifyProtocolMessage({
        payload: {},
        type: "agent.codex.skills.changed.notification",
      })
    )
    await tick()

    expect(handled).toBe(true)
    connection.close()
    await cypheria.close()
  })

  it("scopes connectWith and releases the endpoint after the operation", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-codex-connect-with",
      webSocketFactory: testWebSocketFactory,
    })
    const resultPromise = createCodexApp().connectWith(cypheria.agent.codex, (context) =>
      context.request(methods.server.request["memory/reset"])
    )
    const socket = await acceptConnection(cypheria.connect())
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

    const nextConnection = createCodexApp().connect(cypheria.agent.codex)
    nextConnection.close()
    await cypheria.close()
  })

  it("allows only one active Codex app per endpoint", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-codex-exclusive",
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createCodexApp().connect(cypheria.agent.codex)

    expect(() => createCodexApp().connect(cypheria.agent.codex)).toThrow(
      "already has an active connection"
    )

    connection.close()
    await connection.closed
    const nextConnection = createCodexApp().connect(cypheria.agent.codex)
    nextConnection.close()
    await cypheria.close()
  })

  it("closes and releases the endpoint when an onConnect handler fails", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-codex-connect-failure",
      webSocketFactory: testWebSocketFactory,
    })
    const failures: Error[] = []
    const app = createCodexApp({ onHandlerError: (error) => failures.push(error) }).onConnect(
      () => {
        throw new Error("setup failed")
      }
    )

    expect(() => app.connect(cypheria.agent.codex)).toThrow("setup failed")
    expect(failures.map((error) => error.message)).toEqual(["setup failed"])

    const nextConnection = createCodexApp().connect(cypheria.agent.codex)
    nextConnection.close()
    await cypheria.close()
  })

  it("closes pending work when the Cypheria transport disconnects", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-codex-disconnect",
      reconnect: { enabled: false },
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createCodexApp().connect(cypheria.agent.codex)
    const resultPromise = connection.codex.request(methods.server.request["memory/reset"])
    const socket = await acceptConnection(cypheria.connect())
    await tick()

    socket.close(1006, "relay unavailable")

    await expect(resultPromise).rejects.toThrow("relay unavailable")
    await expect(connection.closed).resolves.toBeUndefined()
    await cypheria.close()
  })

  it("exposes the SDK-shaped surface while keeping agent.codex transport-only", () => {
    const cypheria = createCypheriaClient({
      clientId: "client-codex-surface",
      webSocketFactory: testWebSocketFactory,
    })
    const app = createCodexApp()

    expect(app).toBeInstanceOf(ClientApp)
    expect(app.onConnect(() => undefined)).toBe(app)
    expect(Object.keys(cypheria.agent.codex).sort()).toEqual([
      "notify",
      "request",
      "respond",
      "subscribe",
    ])
    expect("CodexActions" in codex).toBe(false)
  })
})
