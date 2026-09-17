import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentRegistryService } from "./registry-service.js"

const homes: string[] = []
const createTemporaryDirectory = (prefix: string) => mkdtemp(join(tmpdir(), prefix))
const removeTemporaryDirectory = (path: string) => rm(path, { force: true, recursive: true })
const registry = {
  agents: [
    {
      description: "The open source coding agent",
      distribution: { npx: { package: "opencode-ai@1.18.30" } },
      id: "opencode",
      license_url: "https://github.com/anomalyco/opencode/blob/dev/LICENSE",
      name: "OpenCode",
      version: "1.18.30",
    },
  ],
  extensions: [],
  version: "1.0.0",
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(homes.splice(0).map(removeTemporaryDirectory))
})

describe("AgentRegistryService", () => {
  it("persists validators and performs conditional refreshes", async () => {
    const home = await createTemporaryDirectory("cypheria-registry-")
    homes.push(home)
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(registry), {
          headers: { etag: '"registry-v1"', "last-modified": "Wed, 17 Sep 2026 00:00:00 GMT" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const service = new AgentRegistryService({ cypheriaHome: home, fetchImpl })
    await service.start()
    expect(service.state.stale).toBe(false)
    expect(JSON.parse(await readFile(join(home, "agents", "registry.json"), "utf8"))).toEqual(
      registry
    )
    await service.refresh()
    const headers = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers)
    expect(headers.get("if-none-match")).toBe('"registry-v1"')
    expect(headers.get("if-modified-since")).toBe("Wed, 17 Sep 2026 00:00:00 GMT")
    service.stop()
  })

  it("keeps the runtime registry stored in CYPHERIA_HOME when a refresh fails", async () => {
    const home = await createTemporaryDirectory("cypheria-registry-fallback-")
    homes.push(home)
    const initial = new AgentRegistryService({
      cypheriaHome: home,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(registry))),
    })
    await initial.start()
    initial.stop()
    const service = new AgentRegistryService({
      cypheriaHome: home,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    })
    await service.start()
    expect(service.state).toMatchObject({ error: "offline", stale: true })
    expect(service.get("opencode")?.version).toBe("1.18.30")
    service.stop()
  })
})
