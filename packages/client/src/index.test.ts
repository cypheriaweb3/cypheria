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
      "agents",
      "on",
      "projectThread",
      "projects",
      "sections",
      "server",
      "subscribe",
      "thread",
      "threads",
      "timeline",
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
      "archive",
      "cancelTurn",
      "close",
      "create",
      "delete",
      "fork",
      "get",
      "getTimeline",
      "list",
      "move",
      "respondToInteraction",
      "resume",
      "startTurn",
      "steerTurn",
      "timeline",
      "touchRecency",
      "unarchive",
      "update",
      "updateConfig",
    ])
    expect(api.agent).not.toHaveProperty("acp")
    expect(api.agent).not.toHaveProperty("codex")
    expect(api.agent).not.toHaveProperty("claude")
    expect(api.agent).not.toHaveProperty("opencode")
    expect(api.agent).not.toHaveProperty("pi")
    expect(api.agents).toBe(api.agent)
    expect(api.projects).toBe(api.projectThread.projects)
    expect(api.sections).toBe(api.projectThread.sections)
    expect(api.threads).toBe(api.thread)
    expect(api.timeline).toBe(api.thread.timeline)

    await serverClient.close()
  })
})
