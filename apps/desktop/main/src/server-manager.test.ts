import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CYPHERIA_PROTOCOL_VERSION } from "@cypheria/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DesktopServerManager, probeCompatibleServer } from "./server-manager.js"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
  vi.unstubAllGlobals()
})

const cli = () => {
  const directory = mkdtempSync(join(tmpdir(), "cypheria-server-manager-"))
  directories.push(directory)
  const path = join(directory, "cli.mjs")
  writeFileSync(path, "")
  return path
}

describe("DesktopServerManager", () => {
  it("rejects a ready server that speaks an incompatible protocol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ protocolVersion: CYPHERIA_PROTOCOL_VERSION + 1, status: "ready" })
      )
    )

    await expect(probeCompatibleServer("http://127.0.0.1:6768")).rejects.toThrow("is incompatible")
  })

  it("reuses an already-ready server without claiming ownership", async () => {
    const runCli = vi.fn()
    const manager = new DesktopServerManager({
      cliCandidates: [cli()],
      probe: async () => true,
      runCli,
    })

    await expect(manager.ensureRunning()).resolves.toEqual({
      owned: false,
      state: "ready",
      url: "http://127.0.0.1:6768",
    })
    expect(runCli).not.toHaveBeenCalled()
  })

  it("starts a missing server and only stops the instance it owns", async () => {
    let ready = false
    const runCli = vi.fn(
      async (
        _path: string,
        command: "start" | "stop",
        _env: NodeJS.ProcessEnv,
        _options?: { ifIdle?: boolean }
      ) => {
        ready = command === "start"
      }
    )
    const manager = new DesktopServerManager({
      cliCandidates: [cli()],
      probe: async () => ready,
      runCli,
    })

    await expect(manager.ensureRunning()).resolves.toMatchObject({ owned: true, state: "ready" })
    await manager.stopOwned()

    expect(runCli.mock.calls.map(([, command]) => command)).toEqual(["start", "stop"])
    expect(runCli.mock.calls[1]?.[3]).toEqual({ ifIdle: true })
  })

  it("reports every searched location when the server CLI is missing", async () => {
    const manager = new DesktopServerManager({
      cliCandidates: ["/missing/server/cli.mjs"],
      probe: async () => false,
    })

    await expect(manager.ensureRunning()).rejects.toThrow("/missing/server/cli.mjs")
  })
})
