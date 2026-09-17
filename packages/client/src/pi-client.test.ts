import {
  type ClientMessage,
  type PiExtensionUIRequest,
  parseWSInboundMessageText,
  SERVER_CAPABILITIES,
  type ServerIdentity,
  type ServerMessage,
  stringifyProtocolMessage,
  wrapServerSessionMessage,
} from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"

import { createCypheriaClient } from "./index.js"
import { client as createPiClient } from "./pi.js"
import { TestWebSocket, testWebSocketFactory } from "./test-websocket.js"

const identity: ServerIdentity = {
  hostname: "test",
  id: "srv_pi",
  protocolVersion: 2,
  startedAt: "2026-09-15T00:00:00.000Z",
  version: "0.0.0",
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

const parseSent = (raw: string): ClientMessage | { type: "hello" } => {
  const envelope = parseWSInboundMessageText(raw)
  if (envelope.type === "session") return envelope.message
  if (envelope.type === "hello") return { type: "hello" }
  throw new Error(`Unexpected ${envelope.type} envelope`)
}

const sendSession = (socket: TestWebSocket, message: ServerMessage): void => {
  socket.message(stringifyProtocolMessage(wrapServerSessionMessage(message)))
}

const connect = async () => {
  const cypheria = createCypheriaClient({
    clientId: "pi-client",
    webSocketFactory: testWebSocketFactory,
  })
  const connected = cypheria.connect()
  const socket = TestWebSocket.instances.at(-1)
  if (!socket) throw new Error("Expected a WebSocket")
  socket.open()
  sendSession(socket, {
    payload: {
      ...identity,
      capabilities: [SERVER_CAPABILITIES.pi],
      connections: 1,
      runtimeState: "ready",
      webApp: { enabled: false },
    },
    type: "server.status.notification",
  })
  await connected
  return { cypheria, pi: createPiClient(cypheria), socket }
}

afterEach(() => TestWebSocket.reset())

describe("Pi RpcClient", () => {
  it("maps typed command methods onto paired Cypheria messages", async () => {
    const { cypheria, pi, socket } = await connect()
    const statePromise = pi.getState()
    await tick()
    const request = parseSent(socket.sent.at(-1) ?? "")
    if (request.type !== "agent.pi.state.get.request") {
      throw new Error("Expected Pi state request")
    }
    expect(request).toEqual({ requestId: request.requestId, type: "agent.pi.state.get.request" })

    sendSession(socket, {
      payload: {
        requestId: request.requestId,
        result: {
          autoCompactionEnabled: true,
          followUpMode: "one-at-a-time",
          isCompacting: false,
          isStreaming: false,
          messageCount: 0,
          pendingMessageCount: 0,
          sessionId: "session-1",
          steeringMode: "one-at-a-time",
          thinkingLevel: "medium",
        },
      },
      type: "agent.pi.state.get.response",
    })
    await expect(statePromise).resolves.toMatchObject({ sessionId: "session-1" })

    const promptPromise = pi.prompt("Continue", undefined, "steer")
    await tick()
    const prompt = parseSent(socket.sent.at(-1) ?? "")
    if (prompt.type !== "agent.pi.prompt.request") throw new Error("Expected Pi prompt")
    expect(prompt).toMatchObject({ message: "Continue", streamingBehavior: "steer" })
    sendSession(socket, {
      payload: { requestId: prompt.requestId },
      type: "agent.pi.prompt.response",
    })
    await expect(promptPromise).resolves.toBeUndefined()
    await cypheria.close()
  })

  it("restores Pi events and waits for agent settlement", async () => {
    const { cypheria, pi, socket } = await connect()
    const eventsPromise = pi.collectEvents()
    sendSession(socket, {
      payload: { type: "agent_start" },
      type: "agent.pi.agent.start.notification",
    })
    sendSession(socket, {
      payload: { type: "agent_settled" },
      type: "agent.pi.agent.settled.notification",
    })

    await expect(eventsPromise).resolves.toEqual([
      { type: "agent_start" },
      { type: "agent_settled" },
    ])
    await cypheria.close()
  })

  it("round-trips blocking extension UI interactions", async () => {
    const { cypheria, pi, socket } = await connect()
    const received: unknown[] = []
    const unsubscribe = pi.onEvent((event) => received.push(event))
    const request: PiExtensionUIRequest<"confirm"> = {
      id: "ui-1",
      message: "Proceed?",
      method: "confirm",
      title: "Approval",
      type: "extension_ui_request",
    }
    sendSession(socket, {
      payload: request,
      requestId: request.id,
      type: "agent.pi.extension_ui.confirm.request",
    })
    expect(received).toEqual([request])

    await pi.respondToExtensionUI(request, { confirmed: true })
    expect(parseSent(socket.sent.at(-1) ?? "")).toEqual({
      payload: {
        confirmed: true,
        id: "ui-1",
        type: "extension_ui_response",
      },
      requestId: "ui-1",
      type: "agent.pi.extension_ui.confirm.response",
    })
    unsubscribe()
    await cypheria.close()
  })

  it("surfaces Pi command failures as PiRpcError", async () => {
    const { cypheria, pi, socket } = await connect()
    const bashPromise = pi.bash("false")
    await tick()
    const request = parseSent(socket.sent.at(-1) ?? "")
    if (request.type !== "agent.pi.bash.request") throw new Error("Expected Pi bash request")
    sendSession(socket, {
      payload: { error: "command failed", requestId: request.requestId },
      type: "agent.pi.bash.response",
    })
    await expect(bashPromise).rejects.toMatchObject({
      message: "command failed",
      name: "PiRpcError",
    })
    await cypheria.close()
  })
})
