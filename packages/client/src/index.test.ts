import { describe, expect, it } from "vitest"

import { createCypheriaApi } from "./index.js"
import { ServerClient } from "./server-client.js"
import { testWebSocketFactory } from "./test-websocket.js"

describe("Cypheria client facade", () => {
  it("exposes Agent management and Thread APIs without provider-native transports", async () => {
    const serverClient = new ServerClient({
      clientId: "client-borrowed",
      webSocketFactory: testWebSocketFactory,
    })
    const api = createCypheriaApi(serverClient)

    expect(Object.keys(api).sort()).toEqual([
      "agent",
      "on",
      "projectThread",
      "server",
      "subscribe",
      "thread",
    ])
    expect(Object.keys(api.agent).sort()).toEqual([
      "checkToolchainUpdates",
      "disable",
      "enable",
      "get",
      "getOperation",
      "install",
      "list",
      "listOperations",
      "listToolchains",
      "refreshRegistry",
      "start",
      "stop",
      "uninstall",
      "update",
      "updateToolchain",
    ])
    expect(Object.keys(api.thread).sort()).toEqual([
      "cancelTurn",
      "close",
      "create",
      "delete",
      "get",
      "getTimeline",
      "list",
      "move",
      "respondToInteraction",
      "resume",
      "startTurn",
      "touchRecency",
      "update",
      "updateConfig",
    ])
    expect(api.agent).not.toHaveProperty("acp")
    expect(api.agent).not.toHaveProperty("codex")
    expect(api.agent).not.toHaveProperty("claude")
    expect(api.agent).not.toHaveProperty("opencode")
    expect(api.agent).not.toHaveProperty("pi")

    await serverClient.close()
  })
})
