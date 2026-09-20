import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CYPHERIA_PROTOCOL_VERSION } from "@cypheria/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DesktopServerManager,
  probeCompatibleServer,
  resolveDesktopNodeExecutable,
} from "./server-manager.js"

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
  vi.unstubAllGlobals()
})

const runtime = () => {
  const directory = mkdtempSync(join(tmpdir(), "cypheria-server-manager-"))
  directories.push(directory)
  const cliPath = join(directory, "cli.mjs")
  const supervisorPath = join(directory, "supervisor.mjs")
  writeFileSync(cliPath, "")
  writeFileSync(supervisorPath, "")
  return { cliPath, supervisorPath }
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
    const paths = runtime()
    const manager = new DesktopServerManager({
      cliCandidates: [paths.cliPath],
      probe: async () => true,
      runCli,
      supervisorCandidates: [paths.supervisorPath],
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
    const paths = runtime()
    const runCli = vi.fn(
      async (
        _path: string,
        command: "start" | "stop",
        _env: NodeJS.ProcessEnv,
        _options?: { ifIdle?: boolean }
      ) => {
        if (command === "stop") ready = false
      }
    )
    const runSupervisor = vi.fn(async () => {
      ready = true
    })
    const manager = new DesktopServerManager({
      cliCandidates: [paths.cliPath],
      probe: async () => ready,
      runCli,
      runSupervisor,
      supervisorCandidates: [paths.supervisorPath],
    })

    await expect(manager.ensureRunning()).resolves.toMatchObject({ owned: true, state: "ready" })
    await manager.stopOwned()

    expect(runSupervisor).toHaveBeenCalledWith(paths.supervisorPath, process.env)
    expect(runCli.mock.calls.map(([, command]) => command)).toEqual(["stop"])
    expect(runCli.mock.calls[0]?.[3]).toEqual({ ifIdle: true })
  })

  it("reports every searched location when the server CLI is missing", async () => {
    const manager = new DesktopServerManager({
      cliCandidates: ["/missing/server/cli.mjs"],
      probe: async () => false,
    })

    await expect(manager.ensureRunning()).rejects.toThrow("/missing/server/supervisor.mjs")
  })

  it("uses the background Electron helper for macOS node entrypoints", () => {
    const directory = mkdtempSync(join(tmpdir(), "cypheria-node-executable-"))
    directories.push(directory)
    const executablePath = join(directory, "Cypheria.app", "Contents", "MacOS", "Cypheria")
    const helperPath = join(
      directory,
      "Cypheria.app",
      "Contents",
      "Frameworks",
      "Electron Helper.app",
      "Contents",
      "MacOS",
      "Electron Helper"
    )
    mkdirSync(dirname(helperPath), { recursive: true })
    writeFileSync(helperPath, "")

    expect(resolveDesktopNodeExecutable(executablePath, "darwin")).toBe(helperPath)
    expect(resolveDesktopNodeExecutable(executablePath, "linux")).toBe(executablePath)
  })
})
