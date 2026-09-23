import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentInstallReceipt } from "./agent-installer.js"
import { OpenCodeRuntime } from "./opencode-runtime.js"
import type { ToolchainManager } from "./toolchain-manager.js"

const { ensure, info, stop } = vi.hoisted(() => ({
  ensure: vi.fn(),
  info: vi.fn(),
  stop: vi.fn(async () => undefined),
}))

vi.mock("@opencode/client/service", () => ({
  Service: { ensure, headers: () => ({}), stop },
}))
vi.mock("@opencode/client", () => ({
  OpenCode: { make: () => ({ server: { info } }) },
}))

let home: string | undefined
afterEach(async () => {
  vi.clearAllMocks()
  if (home) await rm(home, { force: true, recursive: true })
  home = undefined
})

describe("OpenCodeRuntime", () => {
  it("shares startup until the service passes its readiness check", async () => {
    home = await mkdtemp(join(tmpdir(), "cypheria-opencode-start-"))
    let ready!: () => void
    info.mockImplementation(() => new Promise<void>((resolve) => (ready = resolve)))
    ensure.mockResolvedValue({ url: "http://127.0.0.1:3000" })
    const runtime = new OpenCodeRuntime({
      cypheriaHome: home,
      toolchains: { environment: () => ({}) } as unknown as ToolchainManager,
    })
    const receipt: AgentInstallReceipt = {
      agentId: "opencode",
      args: [],
      command: "/managed/opencode",
      environment: {},
      installedAt: new Date().toISOString(),
      integrity: "not-applicable",
      kind: "npx",
      source: "opencode",
      version: "1.0.0",
    }
    const first = runtime.start(receipt)
    const second = runtime.start(receipt)
    await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(1))
    expect(runtime.running).toBe(false)
    expect(ensure).toHaveBeenCalledTimes(1)
    ready()
    await Promise.all([first, second])
    expect(runtime.running).toBe(true)
    await runtime.stop()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
