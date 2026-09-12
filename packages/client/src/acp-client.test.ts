import * as sdkAcp from "@agentclientprotocol/sdk"
import { ClientApp as SdkClientApp } from "@agentclientprotocol/sdk"
import * as sdkAcpV2 from "@agentclientprotocol/sdk/experimental/v2"
import {
  ACP_V1_PROTOCOL_VERSION,
  ACP_V2_PROTOCOL_VERSION,
  parseClientMessageText,
  stringifyProtocolMessage,
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

const acceptConnection = async (connectPromise: Promise<void>): Promise<TestWebSocket> => {
  const socket = TestWebSocket.instances.at(-1)
  if (!socket) throw new Error("Expected a WebSocket")
  socket.open()
  const hello = parseClientMessageText(socket.sent[0] ?? "")
  if (hello.type !== "session.hello") throw new Error("Expected session hello")
  socket.message(
    stringifyProtocolMessage({
      payload: {
        capabilities: ["agent.acp"],
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

describe("Cypheria ACP SDK adapter", () => {
  it("runs stable ACP SDK requests over v1 Cypheria envelopes", async () => {
    const cypheria = createCypheriaClient({
      clientId: "client-acp-v1",
      webSocketFactory: testWebSocketFactory,
    })
    const connection = createAcpClient().connect(cypheria.agent.acp)
    const resultPromise = connection.agent.request<{ accepted: boolean }, { value: number }>(
      "_cypheria/test",
      { value: 7 }
    )
    const socket = await acceptConnection(cypheria.ensureConnected())
    await tick()

    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (request.type !== "agent.acp.client.message") throw new Error("Expected ACP message")
    expect(request.payload).toEqual({
      message: {
        id: 0,
        jsonrpc: "2.0",
        method: "_cypheria/test",
        params: { value: 7 },
      },
      protocolVersion: ACP_V1_PROTOCOL_VERSION,
    })

    socket.message(
      stringifyProtocolMessage({
        payload: {
          message: { id: 0, jsonrpc: "2.0", result: { accepted: true } },
          protocolVersion: ACP_V1_PROTOCOL_VERSION,
        },
        type: "agent.acp.server.message",
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
    const connection = app.connect(cypheria.agent.acp)
    const socket = await acceptConnection(cypheria.connect())

    socket.message(
      stringifyProtocolMessage({
        payload: {
          message: {
            id: "agent-request-1",
            jsonrpc: "2.0",
            method: "_cypheria/uppercase",
            params: { text: "cypheria" },
          },
          protocolVersion: ACP_V1_PROTOCOL_VERSION,
        },
        type: "agent.acp.server.message",
      })
    )
    await tick()
    await tick()

    const response = parseClientMessageText(socket.sent.at(-1) ?? "")
    expect(response).toEqual({
      payload: {
        message: {
          id: "agent-request-1",
          jsonrpc: "2.0",
          result: { text: "CYPHERIA" },
        },
        protocolVersion: ACP_V1_PROTOCOL_VERSION,
      },
      type: "agent.acp.client.message",
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
    const connection = app.connect(cypheria.agent.acp)
    const socket = await acceptConnection(cypheria.connect())

    socket.message(
      stringifyProtocolMessage({
        payload: {
          message: {
            jsonrpc: "2.0",
            method: "_cypheria/event",
            params: { value: "ready" },
          },
          protocolVersion: ACP_V1_PROTOCOL_VERSION,
        },
        type: "agent.acp.server.message",
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
    const resultPromise = createAcpClient().connectWith(cypheria.agent.acp, (agent) =>
      agent.request<{ doubled: number }, { value: number }>("_cypheria/double", { value: 8 })
    )
    const socket = await acceptConnection(cypheria.connect())
    await tick()

    const request = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (request.type !== "agent.acp.client.message" || Array.isArray(request.payload.message)) {
      throw new Error("Expected ACP request")
    }
    socket.message(
      stringifyProtocolMessage({
        payload: {
          message: { id: 0, jsonrpc: "2.0", result: { doubled: 16 } },
          protocolVersion: ACP_V1_PROTOCOL_VERSION,
        },
        type: "agent.acp.server.message",
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
    const connection = createAcpV2Client().connect(cypheria.agent.acp)
    const initializePromise = connection.agent.request(acpV2Methods.agent.initialize, {
      info: { name: "cypheria-test", version: "1.0.0" },
      protocolVersion: ACP_V2_VERSION,
    })
    const socket = await acceptConnection(cypheria.connect())
    await tick()

    const initialize = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (initialize.type !== "agent.acp.client.message") throw new Error("Expected ACP message")
    if (
      Array.isArray(initialize.payload.message) ||
      !("id" in initialize.payload.message) ||
      !("method" in initialize.payload.message)
    ) {
      throw new Error("Expected ACP initialize request")
    }
    expect(initialize.payload.protocolVersion).toBe(ACP_V2_PROTOCOL_VERSION)
    expect(initialize.payload.message.method).toBe(acpV2Methods.agent.initialize)

    socket.message(
      stringifyProtocolMessage({
        payload: {
          message: {
            id: initialize.payload.message.id,
            jsonrpc: "2.0",
            result: {
              info: { name: "test-agent", version: "1.0.0" },
              protocolVersion: ACP_V2_VERSION,
            },
          },
          protocolVersion: ACP_V2_PROTOCOL_VERSION,
        },
        type: "agent.acp.server.message",
      })
    )
    await expect(initializePromise).resolves.toMatchObject({ protocolVersion: ACP_V2_VERSION })

    await connection.agent.batch([
      batchNotification("_cypheria/first", { value: 1 }),
      batchNotification("_cypheria/second", { value: 2 }),
    ])
    const batch = parseClientMessageText(socket.sent.at(-1) ?? "")
    if (batch.type !== "agent.acp.client.message") throw new Error("Expected ACP batch")
    expect(batch.payload).toMatchObject({
      message: [
        { method: "_cypheria/first", params: { value: 1 } },
        { method: "_cypheria/second", params: { value: 2 } },
      ],
      protocolVersion: ACP_V2_PROTOCOL_VERSION,
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
    const connection = createAcpClient().connect(cypheria.agent.acp)
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
    const connection = createAcpClient().connect(cypheria.agent.acp)

    expect(() => createAcpV2Client().connect(cypheria.agent.acp)).toThrow(
      "already has an active connection"
    )

    connection.close()
    await connection.closed
    const nextConnection = createAcpClient().connect(cypheria.agent.acp)
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
