import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CYPHERIA_PROTOCOL_VERSION, createWebSocketProtocols } from "@cypheria/protocol"
import { CypheriaRuntime } from "@cypheria/runtime"
import pino from "pino"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"

import { loadServerConfig } from "./config.js"
import { CypheriaServer } from "./server.js"

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("CypheriaServer", () => {
  it("enforces configured HTTP and WebSocket authentication", async () => {
    const cypheriaHome = await mkdtemp(join(tmpdir(), "cypheria-server-auth-test-"))
    temporaryDirectories.push(cypheriaHome)
    const token = "test-token-123456789"
    const server = new CypheriaServer({
      config: loadServerConfig({}, { authToken: token, port: 0, webAppEnabled: false }),
      logger: pino({ level: "silent" }),
      runtime: new CypheriaRuntime({ env: { CYPHERIA_HOME: cypheriaHome } }),
    })

    const address = await server.start()
    try {
      expect((await fetch(`${address.url}/api/v1/status`)).status).toBe(401)
      expect(
        (
          await fetch(`${address.url}/api/v1/status`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status
      ).toBe(200)

      const socket = new WebSocket(
        `${address.url.replace("http://", "ws://")}/api/v1/ws`,
        createWebSocketProtocols()
      )
      const status = await new Promise<number | undefined>((resolve, reject) => {
        socket.once("unexpected-response", (_request, response) => {
          response.resume()
          socket.terminate()
          resolve(response.statusCode)
        })
        socket.once("error", reject)
      })
      expect(status).toBe(401)
    } finally {
      await server.stop("Test complete")
    }
  })

  it("serves the embedded web application with an SPA fallback", async () => {
    const cypheriaHome = await mkdtemp(join(tmpdir(), "cypheria-server-home-test-"))
    const webAppDir = await mkdtemp(join(tmpdir(), "cypheria-server-web-test-"))
    temporaryDirectories.push(cypheriaHome, webAppDir)
    await writeFile(join(webAppDir, "index.html"), "<!doctype html><title>Cypheria</title>")
    const server = new CypheriaServer({
      config: loadServerConfig({}, { port: 0, webAppDir, webAppEnabled: true }),
      logger: pino({ level: "silent" }),
      runtime: new CypheriaRuntime({ env: { CYPHERIA_HOME: cypheriaHome } }),
    })

    const address = await server.start()
    try {
      const response = await fetch(`${address.url}/client/route`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain("<title>Cypheria</title>")
      expect(response.headers.get("cache-control")).toBe("no-cache")
    } finally {
      await server.stop("Test complete")
    }
  })

  it("serves health, runtime requests, and WebSocket sessions", async () => {
    const cypheriaHome = await mkdtemp(join(tmpdir(), "cypheria-server-test-"))
    temporaryDirectories.push(cypheriaHome)
    const server = new CypheriaServer({
      config: loadServerConfig({}, { port: 0, webAppEnabled: false }),
      logger: pino({ level: "silent" }),
      runtime: new CypheriaRuntime({ env: { CYPHERIA_HOME: cypheriaHome } }),
    })

    const address = await server.start()
    try {
      const health = await fetch(`${address.url}/api/v1/health`)
      expect(health.status).toBe(200)
      expect(
        (await fetch(`${address.url}/api/v1/lifecycle/restart`, { method: "POST" })).status
      ).toBe(202)

      const runtimeResponse = await fetch(`${address.url}/api/v1/runtime/request`, {
        body: JSON.stringify({ method: "runtime.info" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      expect(runtimeResponse.status).toBe(200)
      expect(await runtimeResponse.json()).toMatchObject({
        result: { lifecycleState: "ready" },
      })

      const socket = new WebSocket(
        `${address.url.replace("http://", "ws://")}/api/v1/ws`,
        createWebSocketProtocols()
      )
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve)
        socket.once("error", reject)
      })
      const response = new Promise<unknown>((resolve) =>
        socket.once("message", (data) => resolve(JSON.parse(data.toString())))
      )
      socket.send(
        JSON.stringify({
          payload: {
            capabilities: [],
            client: { id: "test-client", kind: "sdk" },
            protocolVersion: CYPHERIA_PROTOCOL_VERSION,
          },
          requestId: "hello-1",
          type: "session.hello",
        })
      )
      await expect(response).resolves.toMatchObject({
        requestId: "hello-1",
        type: "session.ready",
      })
      socket.close()
    } finally {
      await server.stop("Test complete")
    }
  })
})
