import {
  type ClientMessage,
  type ConnectionOfferV2,
  parseWSInboundMessageText,
  SERVER_CAPABILITIES,
  type ServerIdentity,
  type ServerMessage,
  stringifyProtocolMessage,
  wrapServerSessionMessage,
} from "@cypheria/protocol"
import {
  decrypt,
  deriveDirectionalKeys,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "@cypheria/relay"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CypheriaProtocolError, ServerClient } from "./server-client.js"
import { TestWebSocket, testWebSocketFactory } from "./test-websocket.js"

const identity: ServerIdentity = {
  hostname: "test",
  id: "srv_test",
  protocolVersion: 2,
  startedAt: "2026-09-11T00:00:00.000Z",
  version: "0.0.0",
}
const serverStatus = {
  ...identity,
  capabilities: Object.values(SERVER_CAPABILITIES),
  connections: 1,
  runtimeState: "ready" as const,
  webApp: { enabled: false },
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const parseSent = (raw: string): ClientMessage | { type: "hello" } | { type: "ping" } => {
  const envelope = parseWSInboundMessageText(raw)
  if (envelope.type === "session") return envelope.message
  return { type: envelope.type }
}

const sendSession = (socket: TestWebSocket, message: unknown): void => {
  socket.message(stringifyProtocolMessage(wrapServerSessionMessage(message as ServerMessage)))
}

const acceptSocket = (socket: TestWebSocket): void => {
  socket.open()
  const hello = parseWSInboundMessageText(socket.sent.at(-1) ?? "")
  if (hello.type !== "hello") throw new Error("Expected hello")
  sendSession(socket, {
    payload: serverStatus,
    type: "server.status.notification",
  })
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
  it("connects from a relay offer without exposing credentials or protocol messages", async () => {
    const serverKeyPair = generateKeyPair()
    const offer: ConnectionOfferV2 = {
      relay: { endpoint: "relay.cypheria.test/ws", useTls: true },
      serverId: "srv_relay",
      serverPublicKeyB64: exportPublicKey(serverKeyPair.publicKey),
      v: 2,
    }
    expect(
      () =>
        new ServerClient({
          relayOffer: offer,
          token: "must-not-leak",
          webSocketFactory: testWebSocketFactory,
        })
    ).toThrow("cannot be combined")

    const client = new ServerClient({
      clientId: "client-relay",
      relayOffer: offer,
      webSocketFactory: testWebSocketFactory,
    })
    const connected = client.connect()
    const socket = TestWebSocket.instances.at(-1)
    if (!socket) throw new Error("Expected relay WebSocket")
    expect(socket.url).toContain("role=client")
    expect(socket.url).not.toContain("token")
    expect(socket.options?.protocols).toEqual([])

    socket.open()
    await tick()
    const e2eeHello = JSON.parse(socket.sent[0] ?? "") as { key: string; type: string }
    const sharedKey = deriveSharedKey(serverKeyPair.secretKey, importPublicKey(e2eeHello.key))
    const directionalKeys = deriveDirectionalKeys(sharedKey)
    socket.message(JSON.stringify({ capabilities: { binaryCiphertext: true }, type: "e2ee_ready" }))
    await tick()
    const encryptedHello = socket.sent[1]
    if (!encryptedHello) throw new Error("Expected encrypted hello")
    expect(encryptedHello).not.toContain("client-relay")
    const encryptedHelloBytes = Uint8Array.from(atob(encryptedHello), (value) =>
      value.charCodeAt(0)
    )
    const hello = parseWSInboundMessageText(
      new TextDecoder().decode(decrypt(directionalKeys.clientToServer, encryptedHelloBytes.buffer))
    )
    expect(hello).toMatchObject({ clientId: "client-relay", type: "hello" })
    const status = stringifyProtocolMessage(
      wrapServerSessionMessage({
        payload: { ...serverStatus, capabilities: [] },
        type: "server.status.notification",
      })
    )
    const encryptedStatus = encrypt(directionalKeys.serverToClient, status)
    socket.message(btoa(String.fromCharCode(...new Uint8Array(encryptedStatus))))
    await connected
    expect(client.getSession()).toMatchObject({ id: "srv_test" })
    await client.close()
  })

  it("validates connection configuration before creating a transport", () => {
    expect(
      () =>
        new ServerClient({
          capabilities: { "": true },
          clientId: "client-test",
          webSocketFactory: testWebSocketFactory,
        })
    ).toThrow()
    expect(TestWebSocket.instances).toHaveLength(0)
  })

  it("uses the top-level hello and exposes server status", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      appVersion: "1.2.3",
      clientType: "desktop",
      token: "secret",
      url: "https://cypheria.test",
      webSocketFactory: testWebSocketFactory,
    })
    const states: string[] = []
    client.subscribeConnectionStatus((state) => states.push(state.status))
    const socket = await connect(client)
    const hello = parseWSInboundMessageText(socket.sent[0] ?? "")

    expect(socket.url).toBe("wss://cypheria.test/api/v1/ws")
    expect(socket.options?.protocols).toEqual(["cypheria.v2", "cypheria.bearer.secret"])
    expect(hello).toMatchObject({
      appVersion: "1.2.3",
      clientId: "client-test",
      clientType: "desktop",
      protocolVersion: 2,
      type: "hello",
    })
    expect(client.getSession()).toMatchObject({ id: "srv_test" })
    expect(client.getConnectionState()).toEqual({ status: "connected" })
    expect(states).toEqual(["idle", "connecting", "connected"])
    await client.close()
    expect(socket.closedWith?.code).toBe(1000)
  })

  it("shares an in-progress handshake and queues requests until server status", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const statusPromise = client.getServerStatus()
    const connectPromise = client.ensureConnected()
    const socket = TestWebSocket.instances[0]
    if (!socket) throw new Error("Expected socket")
    expect(socket.sent).toHaveLength(0)

    acceptSocket(socket)
    await connectPromise
    await tick()
    expect(socket.sent).toHaveLength(2)
    const request = parseSent(socket.sent[1] ?? "")
    if (request.type !== "server.status.request") throw new Error("Expected server status request")
    sendSession(socket, {
      payload: { ...serverStatus, webApp: { enabled: true } },
      requestId: request.requestId,
      type: "server.status.response",
    })
    await expect(statusPromise).resolves.toMatchObject({ runtimeState: "ready" })
    await client.close()
  })

  it("does not send a queued request after its deadline", async () => {
    vi.useFakeTimers()
    const client = new ServerClient({
      clientId: "client-timeout",
      reconnect: { enabled: false },
      webSocketFactory: testWebSocketFactory,
    })
    const statusPromise = client.getServerStatus({ timeoutMs: 10 })
    const socket = TestWebSocket.instances[0]
    if (!socket) throw new Error("Expected socket")
    const rejection = expect(statusPromise).rejects.toMatchObject({ name: "CypheriaTimeoutError" })
    await vi.advanceTimersByTimeAsync(10)
    await rejection
    acceptSocket(socket)
    await tick()
    expect(socket.sent.map((raw) => parseSent(raw).type)).toEqual(["hello"])
    await client.close()
  })

  it("does not settle a client request from a reverse RPC with the same id", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    const resultPromise = client.getServerStatus()
    await tick()
    const request = parseSent(socket.sent.at(-1) ?? "")
    if (request.type !== "server.status.request") throw new Error("Expected server status request")
    sendSession(socket, {
      requestId: request.requestId,
      threadId: "thread-1",
      type: "agent.codex.current_time.read.request",
    })
    sendSession(socket, {
      payload: { ...serverStatus, webApp: { enabled: true } },
      requestId: request.requestId,
      type: "server.status.response",
    })
    await expect(resultPromise).resolves.toMatchObject({ runtimeState: "ready" })
    await client.close()
  })

  it("uses top-level ping/pong", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    const pingPromise = client.ping()
    await tick()
    expect(parseSent(socket.sent.at(-1) ?? "")).toEqual({ type: "ping" })
    socket.message(stringifyProtocolMessage({ type: "pong" }))
    await expect(pingPromise).resolves.toBeUndefined()

    await client.close()
  })

  it("validates outbound session messages before connecting", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    await expect(client.getServerStatus({ timeoutMs: 0 })).rejects.toThrow(
      "timeoutMs must be a positive integer"
    )
    await client.close()
  })

  it("wraps Codex requests, notifications, and reverse responses in session envelopes", async () => {
    const client = new ServerClient({
      clientId: "client-test",
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    const resultPromise = client.requestCodex("memory/reset")
    await tick()
    const request = parseSent(socket.sent.at(-1) ?? "")
    if (!("requestId" in request)) throw new Error("Expected request id")
    expect(request.type).toBe("agent.codex.memory.reset.request")
    sendSession(socket, {
      payload: { requestId: request.requestId },
      type: "agent.codex.memory.reset.response",
    })
    await expect(resultPromise).resolves.toEqual({})

    await client.notifyCodex("initialized")
    expect(parseSent(socket.sent.at(-1) ?? "")).toEqual({
      type: "agent.codex.initialized.notification",
    })
    await client.respondToCodex("currentTime/read", "time-1", { currentTimeAt: 1_789_000_000 })
    expect(parseSent(socket.sent.at(-1) ?? "")).toEqual({
      payload: { currentTimeAt: 1_789_000_000, requestId: "time-1" },
      type: "agent.codex.current_time.read.response",
    })
    await client.close()
  })

  it("isolates listener failures", async () => {
    const listenerErrors: Error[] = []
    const client = new ServerClient({
      clientId: "client-test",
      onListenerError: (error) => listenerErrors.push(error),
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    const events: unknown[] = []
    client.on("server.status.notification", () => {
      throw new Error("listener failed")
    })
    client.on("server.status.notification", (message) => events.push(message.payload.id))
    sendSession(socket, {
      payload: serverStatus,
      type: "server.status.notification",
    })
    expect(events).toEqual(["srv_test"])
    expect(listenerErrors[0]?.message).toBe("listener failed")
    await client.close()
  })

  it("reconnects with the same top-level client identity", async () => {
    vi.useFakeTimers()
    const client = new ServerClient({
      clientId: "client-test",
      reconnect: { baseDelayMs: 10, maxDelayMs: 10 },
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(client)
    const resultPromise = client.getServerStatus()
    await tick()
    socket.close(1006, "network lost")
    await expect(resultPromise).rejects.toThrow("network lost")

    await vi.advanceTimersByTimeAsync(10)
    const replacement = TestWebSocket.instances[1]
    if (!replacement) throw new Error("Expected replacement socket")
    replacement.open()
    const hello = parseWSInboundMessageText(replacement.sent.at(-1) ?? "")
    expect(hello).toMatchObject({ clientId: "client-test", type: "hello" })
    if (hello.type === "hello") expect(hello).not.toHaveProperty("resumeSessionId")
    sendSession(replacement, {
      payload: serverStatus,
      type: "server.status.notification",
    })
    await tick()
    expect(client.getConnectionState()).toEqual({ status: "connected" })
    await client.close()
  })

  it("rejects binary protocol frames and times out a stalled handshake", async () => {
    const binaryClient = new ServerClient({
      clientId: "client-binary",
      reconnect: { enabled: false },
      webSocketFactory: testWebSocketFactory,
    })
    const socket = await connect(binaryClient)
    socket.message(new Uint8Array([1, 2, 3]))
    expect(binaryClient.getLastError()).toBeInstanceOf(CypheriaProtocolError)
    await binaryClient.close()

    vi.useFakeTimers()
    const stalled = new ServerClient({
      clientId: "client-stalled",
      connectTimeoutMs: 20,
      reconnect: { enabled: false },
      webSocketFactory: testWebSocketFactory,
    })
    const connectPromise = stalled.connect()
    const rejection = expect(connectPromise).rejects.toThrow("Timed out connecting")
    TestWebSocket.instances.at(-1)?.open()
    await vi.advanceTimersByTimeAsync(20)
    await rejection
    await stalled.close()
  })
})
