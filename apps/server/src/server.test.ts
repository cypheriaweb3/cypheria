import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCypheriaClient } from "@cypheria/client"
import {
  CYPHERIA_PROTOCOL_VERSION,
  createWebSocketProtocols,
  decodeWSOutboundMessage,
  encodeProtocolMessage,
} from "@cypheria/protocol"
import pino from "pino"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { loadServerConfig } from "./config.js"
import { CypheriaRuntime } from "./runtime/index.js"
import { CypheriaServer } from "./server.js"

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("CypheriaServer", () => {
  it("exposes one shared network proxy through the client protocol", async () => {
    const cypheriaHome = await mkdtemp(join(tmpdir(), "cypheria-server-proxy-test-"))
    temporaryDirectories.push(cypheriaHome)
    const server = new CypheriaServer({
      agentNetworkBootstrap: false,
      config: loadServerConfig({}, { port: 0, webAppEnabled: false }),
      logger: pino({ level: "silent" }),
      runtime: new CypheriaRuntime({ env: { CYPHERIA_HOME: cypheriaHome } }),
    })
    const address = await server.start()
    const client = createCypheriaClient({ clientId: "proxy-test", url: address.url })
    try {
      expect(await client.server.networkProxy()).toEqual({ mode: "system" })
      expect(await client.server.setNetworkProxy({ mode: "direct" })).toEqual({ mode: "direct" })
      expect(server.getNetworkProxy()).toEqual({ mode: "direct" })
    } finally {
      await client.close()
      await server.stop("Test complete")
    }
  })

  it("owns Web3 state behind the versioned client protocol", async () => {
    const cypheriaHome = await mkdtemp(join(tmpdir(), "cypheria-server-web3-test-"))
    temporaryDirectories.push(cypheriaHome)
    const server = new CypheriaServer({
      agentNetworkBootstrap: false,
      config: loadServerConfig({}, { port: 0, webAppEnabled: false }),
      logger: pino({ level: "silent" }),
      runtime: new CypheriaRuntime({ env: { CYPHERIA_HOME: cypheriaHome } }),
    })
    const address = await server.start()
    const client = createCypheriaClient({ clientId: "web3-test", url: address.url })
    try {
      const networks = await client.web3.networks.list()
      expect(networks.length).toBeGreaterThan(0)
      expect(await client.web3.wallets.list()).toEqual([])
      const wallet = await client.web3.wallets.addWatch({
        address: "0x0000000000000000000000000000000000000001",
        name: "Watch",
      })
      expect(wallet.wallet).toMatchObject({ kind: "watch", name: "Watch" })
      expect(await client.web3.wallets.list()).toHaveLength(1)
      expect(await client.web3.audit.list()).toEqual(
        expect.arrayContaining([expect.objectContaining({ eventType: "wallet.created" })])
      )
    } finally {
      await client.close()
      await server.stop("Test complete")
    }
  })

  it("enforces configured HTTP and WebSocket authentication", async () => {
    const cypheriaHome = await mkdtemp(join(tmpdir(), "cypheria-server-auth-test-"))
    temporaryDirectories.push(cypheriaHome)
    const token = "test-token-123456789"
    const server = new CypheriaServer({
      agentNetworkBootstrap: false,
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
      expect((await fetch(`${address.url}/api/v1/relay/pairing-offer`)).status).toBe(401)
      expect(
        (
          await fetch(`${address.url}/api/v1/relay/pairing-offer`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status
      ).toBe(409)

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
      agentNetworkBootstrap: false,
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
      agentNetworkBootstrap: false,
      config: loadServerConfig({}, { port: 0, webAppEnabled: false }),
      logger: pino({ level: "silent" }),
      runtime: new CypheriaRuntime({ env: { CYPHERIA_HOME: cypheriaHome } }),
    })

    const address = await server.start()
    try {
      const health = await fetch(`${address.url}/api/v1/health`)
      expect(health.status).toBe(200)
      const ready = await fetch(`${address.url}/api/v1/ready`)
      expect(await ready.json()).toMatchObject({
        protocolVersion: CYPHERIA_PROTOCOL_VERSION,
        status: "ready",
        version: "0.0.0",
      })
      const initialConfig = await fetch(`${address.url}/api/v1/config`)
      expect(await initialConfig.json()).toMatchObject({
        config: { server: { sessions: { reconnectGraceMs: 30_000 } }, version: 1 },
        restartRequiredPaths: [],
      })
      const patchedConfig = await fetch(`${address.url}/api/v1/config/patch`, {
        body: JSON.stringify({ server: { sessions: { reconnectGraceMs: 45_000 } } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      expect(await patchedConfig.json()).toMatchObject({
        config: { server: { sessions: { reconnectGraceMs: 45_000 } } },
        restartRequiredPaths: ["server.sessions.reconnectGraceMs"],
      })
      expect(await (await fetch(`${address.url}/api/v1/state`)).json()).toMatchObject({
        config: { restartRequired: true },
        connections: { active: 0, retained: 0 },
      })
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
        socket.once("message", (data) => {
          const frame = Array.isArray(data) ? Buffer.concat(data) : data
          const bytes =
            frame instanceof ArrayBuffer
              ? new Uint8Array(frame)
              : new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)
          resolve(decodeWSOutboundMessage(bytes))
        })
      )
      socket.send(
        encodeProtocolMessage({
          capabilities: {},
          clientId: "test-client",
          clientType: "cli",
          protocolVersion: CYPHERIA_PROTOCOL_VERSION,
          type: "hello",
        })
      )
      await expect(response).resolves.toMatchObject({
        message: { payload: { runtimeState: "ready" }, type: "server.status.notification" },
        type: "session",
      })
      socket.close()
    } finally {
      await server.stop("Test complete")
    }
  })
})
