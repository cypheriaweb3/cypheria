import * as sdkAcp from "@agentclientprotocol/sdk"
import { ClientApp as SdkClientApp } from "@agentclientprotocol/sdk"
import * as sdkAcpV2 from "@agentclientprotocol/sdk/experimental/v2"
import {
  ACP_V2_PROTOCOL_VERSION,
  type ClientMessage,
  parseWSInboundMessageText,
  type ServerMessage,
  stringifyProtocolMessage as stringifyEnvelope,
  wrapServerSessionMessage,
} from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"
import * as acp from "./acp.js"
import { ClientApp, client as createAcpClient } from "./acp.js"
import * as acpV2 from "./acp-v2.js"
import {
  PROTOCOL_VERSION as ACP_V2_VERSION,
  methods as acpV2Methods,
  batchNotification,
  client as createAcpV2Client,
} from "./acp-v2.js"

import { createCypheriaClient } from "./index.js"
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
        capabilities: ["agent.acp"],
        connections: 1,
        hostname: "test",
        id: "srv_test",
        protocolVersion: 1,
        runtimeState: "ready",
        startedAt: "2026-09-12T00:00:00.000Z",
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

describe("Cypheria ACP SDK adapter", () => {
  it("runs stable ACP SDK requests over v1 Cypheria envelopes", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-v1",
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createAcpClient().connect(cypheria)
    const resultPromise = connection.agent.request<{ accepted: boolean }, { value: number }>(
      "_cypheria/test",
      { value: 7 }
    )
    const socket = await acceptConnection(cypheria.ensureConnected())
    await tick()

    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    expect(request).toEqual({
      payload: { method: "_cypheria/test", params: { value: 7 } },
      protocolVersion: 1,
      requestId: 0,
      type: "agent.acp.extension.request",
    })

    socket.message(
      stringifyProtocolMessage({
        payload: { requestId: 0, result: { accepted: true } },
        protocolVersion: 1,
        type: "agent.acp.extension.response",
      })
    )

    await expect(resultPromise).resolves.toEqual({ accepted: true })
    connection.close()
    await cypheria.close()
  })

  it("dispatches server requests through ACP ClientApp handlers", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-handler",
      webSocketFactory: testWebSocketFactory,
    })
    const app = createAcpClient().onRequest(
      "_cypheria/uppercase",
      (params): { text: string } => {
        if (
          typeof params !== "object" ||
          params === null ||
          !("text" in params) ||
          typeof params.text !== "string"
        ) {
          throw new Error("Expected text")
        }
        return { text: params.text }
      },
      ({ params }) => ({ text: params.text.toUpperCase() })
    )
    const connection = app.connect(cypheria)
    const socket = await acceptConnection(cypheria.connect())

    socket.message(
      stringifyProtocolMessage({
        payload: { method: "_cypheria/uppercase", params: { text: "cypheria" } },
        protocolVersion: 1,
        requestId: "agent-request-1",
        type: "agent.acp.extension.request",
      })
    )
    await tick()
    await tick()

    const response = parseClientMessageText(socket.sent.at(-1) ?? "")
    expect(response).toEqual({
      payload: { requestId: "agent-request-1", result: { text: "CYPHERIA" } },
      protocolVersion: 1,
      type: "agent.acp.extension.response",
    })

    connection.close()
    await cypheria.close()
  })

  it("dispatches notifications through fluent ClientApp handlers", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-notification",
      webSocketFactory: testWebSocketFactory,
    })
    let received: string | undefined
    const app = createAcpClient().onNotification(
      "_cypheria/event",
      (params): { value: string } => {
        if (
          typeof params !== "object" ||
          params === null ||
          !("value" in params) ||
          typeof params.value !== "string"
        ) {
          throw new Error("Expected value")
        }
        return { value: params.value }
      },
      ({ params }) => {
        received = params.value
      }
    )
    const connection = app.connect(cypheria)
    const socket = await acceptConnection(cypheria.connect())

    socket.message(
      stringifyProtocolMessage({
        payload: { method: "_cypheria/event", params: { value: "ready" } },
        protocolVersion: 1,
        type: "agent.acp.extension.notification",
      })
    )
    await tick()

    expect(received).toBe("ready")
    connection.close()
    await cypheria.close()
  })

  it("supports the SDK-style scoped connectWith API", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-connect-with",
      webSocketFactory: testWebSocketFactory,
    })
    const resultPromise = createAcpClient().connectWith(cypheria, (agent) =>
      agent.request<{ doubled: number }, { value: number }>("_cypheria/double", { value: 8 })
    )
    const socket = await acceptConnection(cypheria.connect())
    await tick()

    parseClientMessageText(socket.sent.at(-1) ?? "")
    socket.message(
      stringifyProtocolMessage({
        payload: { requestId: 0, result: { doubled: 16 } },
        protocolVersion: 1,
        type: "agent.acp.extension.response",
      })
    )

    await expect(resultPromise).resolves.toEqual({ doubled: 16 })
    await cypheria.close()
  })

  it("preserves the ACP v2 initialization and batch APIs", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-v2",
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createAcpV2Client().connect(cypheria)
    const initializePromise = connection.agent.request(acpV2Methods.agent.initialize, {
      info: { name: "cypheria-test", version: "1.0.0" },
      protocolVersion: ACP_V2_VERSION,
    })
    const socket = await acceptConnection(cypheria.connect())
    await tick()

    const initialize = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (initialize.type !== "agent.acp.initialize.request") {
      throw new Error("Expected ACP initialize request")
    }
    expect(initialize.protocolVersion).toBe(ACP_V2_PROTOCOL_VERSION)

    socket.message(
      stringifyProtocolMessage({
        payload: {
          requestId: initialize.requestId,
          result: {
            info: { name: "test-agent", version: "1.0.0" },
            protocolVersion: ACP_V2_VERSION,
          },
        },
        protocolVersion: 2,
        type: "agent.acp.initialize.response",
      })
    )
    await expect(initializePromise).resolves.toMatchObject({ protocolVersion: ACP_V2_VERSION })

    await connection.agent.batch([
      batchNotification("_cypheria/first", { value: 1 }),
      batchNotification("_cypheria/second", { value: 2 }),
    ])
    const batch = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (batch.type !== "agent.acp.batch") throw new Error("Expected ACP batch")
    expect(batch.payload).toMatchObject({
      messages: [
        {
          payload: { method: "_cypheria/first", params: { value: 1 } },
          protocolVersion: 2,
          type: "agent.acp.extension.notification",
        },
        {
          payload: { method: "_cypheria/second", params: { value: 2 } },
          protocolVersion: 2,
          type: "agent.acp.extension.notification",
        },
      ],
    })

    connection.close()
    await cypheria.close()
  })

  it("closes pending ACP work when the Cypheria connection disconnects", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-disconnect",
      reconnect: { enabled: false },
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createAcpClient().connect(cypheria)
    const resultPromise = connection.agent.request("_cypheria/pending", {})
    const socket = await acceptConnection(cypheria.connect())
    await tick()

    socket.close(1006, "relay unavailable")

    await expect(resultPromise).rejects.toThrow("relay unavailable")
    await expect(connection.closed).resolves.toBeUndefined()
    await cypheria.close()
  })

  it("allows only one active ACP SDK stream per server connection", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-exclusive",
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createAcpClient().connect(cypheria)

    expect(() => createAcpV2Client().connect(cypheria)).toThrow("already has an active connection")

    connection.close()
    await connection.closed
    const nextConnection = createAcpClient().connect(cypheria)
    nextConnection.close()
    await cypheria.close()
  })

  it("exposes the SDK-shaped ClientApp while keeping agent.acp transport-only", () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-surface",
      webSocketFactory: testWebSocketFactory,
    })
    const app = createAcpClient()

    expect(app).toBeInstanceOf(ClientApp)
    expect(app).not.toBeInstanceOf(SdkClientApp)
    expect(app.onConnect(() => undefined)).toBe(app)
    expect(Object.keys(cypheria.agent.acp).sort()).toEqual(["send", "subscribe"])
    expect("ClientSideConnection" in acp).toBe(false)
    expect("AgentSideConnection" in acp).toBe(false)
    expect("TerminalHandle" in acp).toBe(false)
    expect(Object.keys(acp).sort()).toEqual(
      Object.keys(sdkAcp)
        .filter(
          (name) =>
            name !== "ClientSideConnection" &&
            name !== "AgentSideConnection" &&
            name !== "TerminalHandle"
        )
        .sort()
    )
    expect(Object.keys(acpV2).sort()).toEqual(Object.keys(sdkAcpV2).sort())
  })
})
