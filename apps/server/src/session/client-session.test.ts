import {
  CYPHERIA_PROTOCOL_VERSION,
  type CypheriaBinaryFrame,
  decodeCypheriaBinaryFrame,
  decodeWSOutboundMessage,
  encodeCypheriaBinaryFrame,
  encodeProtocolMessage,
  type ServerDiagnostics,
  type ServerIdentity,
  type ServerMessage,
  type ServerStatus,
  wrapClientSessionMessage,
} from "@cypheria/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_PERSISTED_SERVER_CONFIG } from "../persisted-config.js"
import type { SessionHost, SessionTransport } from "./client-session.js"
import {
  ConnectionRegistry,
  OWNER_SESSION_ADMISSION,
  type SessionAdmission,
} from "./connection-registry.js"

const identity: ServerIdentity = {
  hostname: "test",
  id: "srv_test",
  protocolVersion: CYPHERIA_PROTOCOL_VERSION,
  startedAt: "2026-01-01T00:00:00.000Z",
  version: "0.0.0",
}

const createFixture = () => {
  const status: ServerStatus = {
    ...identity,
    capabilities: [],
    connections: 1,
    runtimeState: "ready",
    webApp: { enabled: true },
  }
  const diagnostics: ServerDiagnostics = {
    collectedAt: "2026-01-01T00:00:00.000Z",
    connections: { acceptedTotal: 1, active: 1, activeSessions: 1, rejectedTotal: 0 },
    memory: { arrayBuffers: 0, external: 0, heapTotal: 0, heapUsed: 0, rss: 0 },
    process: { pid: 1, uptimeSeconds: 1 },
    runtimeState: "ready",
  }
  const host: SessionHost = {
    getConfig: () => ({
      config: DEFAULT_PERSISTED_SERVER_CONFIG,
      overrideControlledPaths: [],
      path: "/tmp/server.json",
      restartRequiredPaths: [],
    }),
    getDiagnostics: () => diagnostics,
    getStatus: () => status,
    patchConfig: vi.fn(async () => host.getConfig()),
    reloadConfig: vi.fn(async () => host.getConfig()),
  }
  const registry = new ConnectionRegistry({ helloTimeoutMs: 1000, host, reconnectGraceMs: 1000 })
  const createConnection = (admission: SessionAdmission = OWNER_SESSION_ADMISSION) => {
    const sent: Array<ServerMessage | { type: "pong" }> = []
    const sentBinary: CypheriaBinaryFrame[] = []
    const transport: SessionTransport = {
      close: vi.fn(),
      send: (data) => {
        const binary = decodeCypheriaBinaryFrame(data)
        if (binary) {
          sentBinary.push(binary)
          return
        }
        const envelope = decodeWSOutboundMessage(data)
        sent.push(envelope.type === "session" ? envelope.message : envelope)
      },
    }
    return { connection: registry.accept(transport, admission), sent, sentBinary, transport }
  }
  return { createConnection, host, registry }
}

const hello = (clientId: string) =>
  encodeProtocolMessage({
    capabilities: { voice: true },
    clientId,
    clientType: "web",
    protocolVersion: CYPHERIA_PROTOCOL_VERSION,
    type: "hello",
  })

const sessionMessage = (message: Parameters<typeof wrapClientSessionMessage>[0]) =>
  encodeProtocolMessage(wrapClientSessionMessage(message))

afterEach(() => vi.useRealTimers())

describe("ClientSession", () => {
  it("requires hello, answers top-level ping, and handles logical messages", async () => {
    const fixture = createFixture()
    const client = fixture.createConnection()
    await client.connection.receive(encodeProtocolMessage({ type: "ping" }))
    await client.connection.receive(hello("web-1"))
    await client.connection.receive(
      sessionMessage({
        requestId: "status-1",
        type: "server.status.request",
      })
    )

    expect(client.sent).toMatchObject([
      { type: "pong" },
      { payload: { id: "srv_test" }, type: "server.status.notification" },
      { payload: { id: "srv_test" }, requestId: "status-1", type: "server.status.response" },
    ])
    client.connection.close()
  })

  it("shares one logical session across simultaneous and reconnected transports", async () => {
    const fixture = createFixture()
    const first = fixture.createConnection()
    await first.connection.receive(hello("web-shared"))
    const second = fixture.createConnection()
    await second.connection.receive(hello("web-shared"))

    expect(fixture.registry.diagnostics()).toMatchObject({
      active: 2,
      activeSessions: 1,
      resumedTotal: 1,
      retained: 0,
    })
    fixture.registry.broadcast({
      payload: fixture.host.getStatus(),
      type: "server.status.notification",
    })
    expect(first.sent.at(-1)).toMatchObject({ type: "server.status.notification" })
    expect(second.sent.at(-1)).toMatchObject({ type: "server.status.notification" })

    first.connection.transportClosed()
    expect(fixture.registry.diagnostics()).toMatchObject({ active: 1, retained: 0 })
    second.connection.transportClosed()
    expect(fixture.registry.diagnostics()).toMatchObject({ active: 0, retained: 1 })

    const replacement = fixture.createConnection()
    await replacement.connection.receive(hello("web-shared"))
    expect(fixture.registry.diagnostics()).toMatchObject({
      active: 1,
      activeSessions: 1,
      resumedTotal: 2,
      retained: 0,
    })
    replacement.connection.close()
  })

  it("isolates identical client IDs belonging to different principals", async () => {
    const fixture = createFixture()
    const owner = fixture.createConnection({ principalId: "owner" })
    const guest = fixture.createConnection({ principalId: "guest" })
    await owner.connection.receive(hello("shared-id"))
    await guest.connection.receive(hello("shared-id"))

    expect(fixture.registry.diagnostics()).toMatchObject({ active: 2, activeSessions: 2 })
    owner.connection.close()
    guest.connection.close()
  })

  it("removes a retained logical session when its grace period expires", async () => {
    vi.useFakeTimers()
    const fixture = createFixture()
    const client = fixture.createConnection()
    await client.connection.receive(hello("web-expiring"))
    client.connection.transportClosed()
    expect(fixture.registry.diagnostics()).toMatchObject({ active: 0, retained: 1 })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(fixture.registry.diagnostics()).toMatchObject({ active: 0, retained: 0 })
  })

  it("closes a connection that sends session messages before hello", async () => {
    const fixture = createFixture()
    const client = fixture.createConnection()
    await client.connection.receive(
      sessionMessage({ requestId: "status-1", type: "server.status.request" })
    )
    expect(client.transport.close).toHaveBeenCalledWith(1008, "Hello required")
    expect(client.sent).toEqual([])
  })

  it("routes correlated responses only to their physical source", async () => {
    const fixture = createFixture()
    const first = fixture.createConnection()
    const second = fixture.createConnection()
    await first.connection.receive(hello("web-routing"))
    await second.connection.receive(hello("web-routing"))
    await second.connection.receive(
      sessionMessage({
        payload: { patch: { server: { listen: { port: 7788 } } } },
        requestId: "config-patch",
        type: "server.config.patch.request",
      })
    )

    expect(fixture.host.patchConfig).toHaveBeenCalledWith({ server: { listen: { port: 7788 } } })
    expect(first.sent).toHaveLength(1)
    expect(second.sent.at(-1)).toMatchObject({
      requestId: "config-patch",
      type: "server.config.patch.response",
    })
    first.connection.close()
    second.connection.close()
  })

  it("routes domain binary frames after hello and can reply to the source", async () => {
    const fixture = createFixture()
    fixture.host.handleBinaryFrame = vi.fn(async (_frame, _sessionId, _source, send) => {
      send({ opcode: 0x02, payload: new Uint8Array([9, 8, 7]) })
      return true
    })
    const client = fixture.createConnection()
    await client.connection.receive(hello("web-binary"))
    await client.connection.receive(
      encodeCypheriaBinaryFrame({
        opcode: 0x01,
        payload: new Uint8Array([1, 2, 3]),
      })
    )

    expect(fixture.host.handleBinaryFrame).toHaveBeenCalledWith(
      {
        opcode: 0x01,
        payload: new Uint8Array([1, 2, 3]),
      },
      expect.stringMatching(/^ses_/u),
      client.transport,
      expect.any(Function)
    )
    expect(client.sentBinary).toEqual([
      {
        opcode: 0x02,
        payload: new Uint8Array([9, 8, 7]),
      },
    ])
    client.connection.close()
  })

  it("rejects binary frames before hello and unsupported frames after hello", async () => {
    const fixture = createFixture()
    const beforeHello = fixture.createConnection()
    const frame = encodeCypheriaBinaryFrame({
      opcode: 0x01,
      payload: new Uint8Array(),
    })
    await beforeHello.connection.receive(frame)
    expect(beforeHello.transport.close).toHaveBeenCalledWith(1008, "Hello required")

    const unsupported = fixture.createConnection()
    await unsupported.connection.receive(hello("web-unsupported-binary"))
    await unsupported.connection.receive(frame)
    expect(unsupported.transport.close).toHaveBeenCalledWith(1008, "Unsupported binary frame")
  })
})
