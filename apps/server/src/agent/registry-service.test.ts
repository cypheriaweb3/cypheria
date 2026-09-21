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
      description: "Gemini CLI",
      distribution: { npx: { package: "@google/gemini-cli@1.0.0" } },
      id: "gemini",
      license_url: "https://github.com/google-gemini/gemini-cli/blob/main/LICENSE",
      name: "Gemini CLI",
      version: "1.0.0",
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
  it("accepts newly published ids without a Cypheria release", async () => {
    const home = await createTemporaryDirectory("cypheria-registry-dynamic-")
    homes.push(home)
    const dynamicRegistry = {
      ...registry,
      agents: [{ ...registry.agents[0], id: "future-agent", name: "Future Agent" }],
    }
    const service = new AgentRegistryService({
      cypheriaHome: home,
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(dynamicRegistry))),
    })

    await service.start()

    expect(service.entries.map(({ id }) => id)).toEqual(["future-agent"])
    expect(service.get("future-agent")?.name).toBe("Future Agent")
    service.stop()
  })

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
    expect(service.get("gemini")?.version).toBe("1.0.0")
    service.stop()
  })
})
