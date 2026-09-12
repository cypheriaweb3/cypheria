import { type ChildProcess, execFile, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { createCypheriaClient } from "@cypheria/client"
import { RelayPairingOfferResponseSchema } from "@cypheria/protocol"
import { CypheriaRuntime } from "@cypheria/runtime"
import pino from "pino"
import { describe, expect, it } from "vitest"
import WebSocket from "ws"

import { loadServerConfig } from "./config.js"
import { CypheriaServer } from "./server.js"

const execFileAsync = promisify(execFile)
const relayDirectory = fileURLToPath(new URL("../../relay", import.meta.url))

const reservePort = async (): Promise<number> => {
  const listener = createNetServer()
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject)
    listener.listen(0, "127.0.0.1", resolve)
  })
  const address = listener.address()
  if (!address || typeof address === "string") throw new Error("Could not reserve relay port")
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("Timed out waiting for relay readiness")
}

describe("Cypheria relay end to end", () => {
  it("uses the Go relay with an encrypted client/server session", async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "cypheria-relay-e2e-"))
    const binary = join(workingDirectory, "cypheria-relay")
    const cypheriaHome = join(workingDirectory, "home")
    await execFileAsync("go", ["build", "-o", binary, "./cmd/cypheria-relay"], {
      cwd: relayDirectory,
      env: { ...process.env, GOTOOLCHAIN: "local" },
    })
    const port = await reservePort()
    const relayUrl = `http://127.0.0.1:${port}`
    let relayOutput = ""
    let relayProcess: ChildProcess | undefined
    const startRelay = (): ChildProcess => {
      const child = spawn(binary, ["--mode=single", `--public-addr=0.0.0.0:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
      })
      child.stdout?.on("data", (chunk) => {
        relayOutput += chunk.toString()
      })
      child.stderr?.on("data", (chunk) => {
        relayOutput += chunk.toString()
      })
      relayProcess = child
      return child
    }
    startRelay()

    let server: CypheriaServer | undefined
    try {
      await waitFor(async () => {
        try {
          return (await fetch(`${relayUrl}/healthz`)).status === 204
        } catch {
          return false
        }
      })
      const token = "relay-test-token-123456789"
      server = new CypheriaServer({
        config: loadServerConfig(
          {},
          {
            authToken: token,
            port: 0,
            relayEnabled: true,
            relayEndpoint: `${relayUrl}/ws`,
            relayPublicEndpoint: `${relayUrl}/ws`,
            relayPublicUseTls: false,
            relayUseTls: false,
            webAppEnabled: false,
          }
        ),
        logger: pino({ level: "silent" }),
        runtime: new CypheriaRuntime({ env: { CYPHERIA_HOME: cypheriaHome } }),
      })
      const address = await server.start()
      expect((await fetch(`${address.url}/api/v1/relay/pairing-offer`)).status).toBe(401)
      let pairing: ReturnType<typeof RelayPairingOfferResponseSchema.parse> | undefined
      await waitFor(async () => {
        const response = await fetch(`${address.url}/api/v1/relay/pairing-offer`, {
          headers: { authorization: `Bearer ${token}` },
        })
        pairing = RelayPairingOfferResponseSchema.parse(await response.json())
        return pairing.relayConnected
      })
      if (!pairing) throw new Error("Pairing offer was not returned")
      expect(JSON.stringify(pairing)).not.toContain(token)

      const client = createCypheriaClient({
        clientId: "relay-e2e-client",
        relayOffer: pairing.url,
        webSocketFactory: (url) => new WebSocket(url) as never,
      })
      await client.connect()
      await expect(client.server.ping()).resolves.toMatchObject({
        serverSentAt: expect.any(String),
      })
      await expect(client.server.info()).resolves.toMatchObject({ id: pairing.offer.serverId })
      await expect(client.runtime.request("runtime.info")).resolves.toMatchObject({
        lifecycleState: "ready",
      })

      const originalSessionId = client.getSession()?.sessionId
      const disconnected = new Promise<void>((resolve) => {
        const unsubscribe = client.subscribeConnectionStatus((state) => {
          if (state.status === "disconnected") {
            unsubscribe()
            resolve()
          }
        })
      })
      const stoppedRelay = relayProcess
      stoppedRelay?.kill("SIGTERM")
      if (stoppedRelay) await new Promise((resolve) => stoppedRelay.once("exit", resolve))
      await disconnected
      startRelay()
      await waitFor(async () => {
        try {
          return (await fetch(`${relayUrl}/healthz`)).status === 204
        } catch {
          return false
        }
      })
      await waitFor(async () => {
        if (client.getConnectionState().status !== "connected") return false
        return client.getSession()?.sessionId !== originalSessionId
      })
      await expect(client.server.ping()).resolves.toMatchObject({
        serverSentAt: expect.any(String),
      })
      await client.close()

      expect(relayOutput).not.toContain(token)
      expect(relayOutput).not.toContain("session.hello")
    } finally {
      await server?.stop("Relay E2E complete")
      relayProcess?.kill("SIGTERM")
      if (relayProcess) {
        await Promise.race([
          new Promise((resolve) => relayProcess?.once("exit", resolve)),
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ])
      }
      await rm(workingDirectory, { force: true, recursive: true })
    }
  }, 60_000)
})
