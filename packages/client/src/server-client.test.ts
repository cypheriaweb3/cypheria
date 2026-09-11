import {
  AGENT_CODEX_CLIENT_NOTIFICATIONS,
  AGENT_CODEX_CLIENT_RPC,
  AGENT_CODEX_SERVER_RPC,
  parseClientMessageText,
  type ServerIdentity,
  stringifyProtocolMessage,
} from "@cypheria/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CypheriaProtocolError, type CypheriaServerError, ServerClient } from "./server-client.js"
import { TestWebSocket, testWebSocketFactory } from "./test-websocket.js"

const identity: ServerIdentity = {
  hostname: "test",
  id: "srv_test",
  protocolVersion: 1,
  startedAt: "2026-09-11T00:00:00.000Z",
  version: "0.0.0",
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const resolveAction = (root: unknown, path: string): unknown =>
  path
    .split("/")
    .reduce<unknown>(
      (node, segment) =>
        typeof node === "object" || typeof node === "function"
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      root
    )

const acceptSocket = (socket: TestWebSocket, sessionId = "ses_test"): void => {
  socket.open()
  const hello = parseClientMessageText(socket.sent.at(-1) ?? "")
  if (hello.type !== "session.hello") throw new Error("Expected session hello")
  socket.message(
    stringifyProtocolMessage({
      payload: { capabilities: ["runtime.request"], server: identity, sessionId },
      requestId: hello.requestId,
      type: "session.ready",
    })
  )
}

const connect = async (client: ServerClient): Promise<TestWebSocket> => {
  const promise = client.connect()
  const socket = TestWebSocket.instances.at(-1)
  if (!socket) throw new Error("Expected a WebSocket")
  acceptSocket(socket)
  await promise
  return socket
}

afterEach(() => {
  vi.useRealTimers()
  TestWebSocket.reset()
})

describe("ServerClient", () => {
  it("validates connection configuration before creating a transport", () => {
    expect(
      () =>
        new ServerClient({
          capabilities: [""],
          clientId: "client-test",
          webSocketFactory: testWebSocketFactory,
        })
    ).toThrow()
    expect(TestWebSocket.instances).toHaveLength(0)
  })

  it("normalizes the URL, authenticates, and exposes the negotiated session", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      token: "secret",
      url: "https://cypheria.test",
      webSocketFactory: testWebSocketFactory,
    })
    const states: string[] = []
    client.subscribeConnectionStatus((state) => states.push(state.status))

    const socket = await connect(client)
    const hello = parseClientMessageText(socket.sent[0] ?? "")

    expect(socket.url).toBe("wss://cypheria.test/api/v1/ws")
    expect(socket.options?.protocols).toEqual(["cypheria.v1", "cypheria.bearer.secret"])
    expect(socket.binaryType).toBe("arraybuffer")
    expect(hello).toMatchObject({
      payload: { client: { id: "client-test", kind: "sdk" }, protocolVersion: 1 },
      type: "session.hello",
    })
    expect(client.getSession()).toMatchObject({ sessionId: "ses_test" })
    expect(client.getConnectionState()).toEqual({ sessionId: "ses_test", status: "connected" })
    expect(states).toEqual(["idle", "connecting", "connected"])

    await client.close()
    expect(parseClientMessageText(socket.sent.at(-1) ?? "")).toMatchObject({
      type: "session.goodbye",
    })
    expect(client.getConnectionState()).toEqual({ status: "disposed" })
  })

  it("shares an in-progress handshake and queues lazy requests until ready", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })

    const infoPromise = client.getServerInfo()
    const connectPromise = client.ensureConnected()
    expect(TestWebSocket.instances).toHaveLength(1)
    const socket = TestWebSocket.instances[0]
    if (!socket) throw new Error("Expected socket")
    expect(socket.sent).toHaveLength(0)

    acceptSocket(socket)
    await connectPromise
    await tick()
    expect(socket.sent).toHaveLength(2)
    const request = parseClientMessageText(socket.sent[1] ?? "")
    if (request.type !== "server.info") throw new Error("Expected server info request")
    socket.message(
      stringifyProtocolMessage({
        payload: {
          ...identity,
          connections: 1,
          runtimeState: "ready",
          webApp: { enabled: true },
        },
        requestId: request.requestId,
        type: "server.info.result",
      })
    )

    await expect(infoPromise).resolves.toMatchObject({ runtimeState: "ready" })
    await client.close()
  })

  it("correlates runtime responses and preserves protocol bigint values", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)

    const resultPromise = client.requestRuntime<{ balance: bigint }>("wallet.balance", {
      accountId: "account_1",
    })
    await tick()
    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (request.type !== "runtime.request") throw new Error("Expected runtime request")
    socket.message(
      stringifyProtocolMessage({
        payload: { result: { balance: 18_446_744_073_709_551_615n } },
        requestId: request.requestId,
        type: "runtime.response",
      })
    )

    await expect(resultPromise).resolves.toEqual({ balance: 18_446_744_073_709_551_615n })
    await client.close()
  })

  it("returns protocol payloads for ping and lifecycle requests", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    const pingPromise = client.ping("2026-09-11T01:00:00.000Z")
    await tick()
    const ping = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (ping.type !== "server.ping") throw new Error("Expected ping")
    socket.message(
      stringifyProtocolMessage({
        payload: {
          clientSentAt: "2026-09-11T01:00:00.000Z",
          serverReceivedAt: "2026-09-11T01:00:00.010Z",
          serverSentAt: "2026-09-11T01:00:00.011Z",
        },
        requestId: ping.requestId,
        type: "server.pong",
      })
    )
    await expect(pingPromise).resolves.toMatchObject({
      serverSentAt: "2026-09-11T01:00:00.011Z",
    })

    const restartPromise = client.requestLifecycle("restart", "upgrade")
    await tick()
    const restart = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (restart.type !== "server.restart") throw new Error("Expected restart")
    socket.message(
      stringifyProtocolMessage({
        payload: { action: "restart" },
        requestId: restart.requestId,
        type: "server.lifecycle.accepted",
      })
    )
    await expect(restartPromise).resolves.toEqual({ action: "restart" })
    await client.close()
  })

  it("turns correlated errors into CypheriaServerError", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)

    const resultPromise = client.requestRuntime("policy.list")
    await tick()
    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (request.type !== "runtime.request") throw new Error("Expected runtime request")
    socket.message(
      stringifyProtocolMessage({
        payload: { code: "HANDLER_FAILED", message: "Runtime method not found" },
        requestId: request.requestId,
        type: "server.error",
      })
    )

    await expect(resultPromise).rejects.toEqual(
      expect.objectContaining<CypheriaServerError>({
        code: "HANDLER_FAILED",
        message: "Runtime method not found",
        name: "CypheriaServerError",
      })
    )
    await client.close()
  })

  it("validates outbound messages before connecting or sending", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })

    await expect(client.requestRuntime("not-a-runtime-method")).rejects.toThrow(
      "Runtime method must use a supported namespace"
    )
    expect(TestWebSocket.instances).toHaveLength(0)
    await client.close()
  })

  it("uses generated Codex mappings for requests", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)

    const resultPromise = client.codex.memory.reset()
    await tick()
    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    expect(request).toMatchObject({ type: "agent.codex.memory.reset.request" })
    if (!("requestId" in request)) throw new Error("Expected request id")
    socket.message(
      stringifyProtocolMessage({
        payload: { requestId: request.requestId },
        type: "agent.codex.memory.reset.response",
      })
    )

    await expect(resultPromise).resolves.toEqual({})
    await client.close()
  })

  it("creates an async action for every protocol-defined Codex message direction", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })

    for (const method of Object.keys(AGENT_CODEX_CLIENT_RPC)) {
      expect(resolveAction(client.codex, method), method).toBeTypeOf("function")
    }
    for (const method of Object.keys(AGENT_CODEX_CLIENT_NOTIFICATIONS)) {
      expect(resolveAction(client.codex.notify, method), method).toBeTypeOf("function")
    }
    for (const method of Object.keys(AGENT_CODEX_SERVER_RPC)) {
      expect(resolveAction(client.codex.respond, method), method).toBeTypeOf("function")
    }

    await client.close()
  })

  it("implements client notifications and reverse responses as async methods", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)

    expect(typeof client.codex.command.exec).toBe("function")
    expect(typeof client.codex.command.exec.write).toBe("function")

    await client.codex.notify.initialized()
    expect(parseClientMessageText(socket.sent.at(-1) ?? "")).toEqual({
      type: "agent.codex.initialized.notification",
    })

    await client.codex.respond.currentTime.read("current-time-1", {
      currentTimeAt: 1_789_000_000,
    })
    expect(parseClientMessageText(socket.sent.at(-1) ?? "")).toEqual({
      payload: { currentTimeAt: 1_789_000_000, requestId: "current-time-1" },
      type: "agent.codex.current_time.read.response",
    })
    await client.close()
  })

  it("isolates listener failures and supports typed subscriptions", async () => {
    const listenerErrors: Error[] = []
    const client = new ServerClient({
      clientId: "client-test",
      onListenerError: (error) => listenerErrors.push(error),
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    const events: unknown[] = []
    client.on("runtime.event", () => {
      throw new Error("listener failed")
    })
    const unsubscribe = client.on("runtime.event", (message) => events.push(message.payload.event))

    socket.message(
      stringifyProtocolMessage({
        payload: { event: { type: "runtime.lifecycle" } },
        type: "runtime.event",
      })
    )

    expect(events).toEqual([{ type: "runtime.lifecycle" }])
    expect(listenerErrors[0]?.message).toBe("listener failed")
    expect(client.getConnectionState().status).toBe("connected")
    unsubscribe()
    await client.close()
  })

  it("rejects in-flight work and reconnects after transport loss", async () => {
    vi.useFakeTimers()
    const client = new ServerClient({
      clientId: "client-test",
      reconnect: { baseDelayMs: 10, maxDelayMs: 10 },
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    const resultPromise = client.getServerInfo()
    await tick()
    socket.close(1006, "network lost")

    await expect(resultPromise).rejects.toThrow("network lost")
    expect(client.getLastError()?.message).toBe("network lost")
    expect(client.getConnectionState()).toEqual({ reason: "network lost", status: "disconnected" })

    await vi.advanceTimersByTimeAsync(10)
    expect(TestWebSocket.instances).toHaveLength(2)
    const replacement = TestWebSocket.instances[1]
    if (!replacement) throw new Error("Expected replacement socket")
    acceptSocket(replacement, "ses_reconnected")
    await tick()
    expect(client.getConnectionState()).toEqual({
      sessionId: "ses_reconnected",
      status: "connected",
    })
    await client.close()
  })

  it("rejects binary protocol frames and cancels reconnect on close", async () => {
    vi.useFakeTimers()
    const client = new ServerClient({
      clientId: "client-test",
      reconnect: { baseDelayMs: 10 },
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    socket.message(new Uint8Array([1, 2, 3]))

    expect(client.getLastError()).toBeInstanceOf(CypheriaProtocolError)
    expect(socket.closedWith?.code).toBe(1003)
    await client.close()
    await vi.advanceTimersByTimeAsync(20)
    expect(TestWebSocket.instances).toHaveLength(1)
  })

  it("times out a stalled handshake", async () => {
    vi.useFakeTimers()
    const client = new ServerClient({
      clientId: "client-test",
      connectTimeoutMs: 20,
      reconnect: { enabled: false },
      webSocketFactory: testWebSocketFactory,
    })
    const connectPromise = client.connect()
    const rejection = expect(connectPromise).rejects.toThrow("Timed out connecting")
    const socket = TestWebSocket.instances[0]
    if (!socket) throw new Error("Expected socket")
    socket.open()

    await vi.advanceTimersByTimeAsync(20)
    await rejection
    expect(socket.closedWith?.code).toBe(1001)
    await client.close()
  })
})
