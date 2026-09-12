import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PersistedServerConfigSchema } from "@cypheria/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { resolveServerConfigPath } from "./persisted-config.js"
import { ServerConfigStore } from "./server-config-store.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("ServerConfigStore", () => {
  it("persists desired configuration atomically and reports restart requirements", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cypheria-server-config-store-"))
    temporaryDirectories.push(configDir)
    const store = await ServerConfigStore.open(configDir, {})

    const snapshot = await store.patch({ server: { listen: { port: 7788 } } })
    expect(snapshot.restartRequiredPaths).toContain("server.listen.port")
    expect(snapshot.config.server.listen.port).toBe(7788)
    expect(snapshot.path).toBe(resolveServerConfigPath(configDir))

    const persisted = PersistedServerConfigSchema.parse(
      JSON.parse(await readFile(snapshot.path, "utf8"))
    )
    expect(persisted.server.listen.port).toBe(7788)
  })

  it("does not mark environment-controlled fields as restartable file changes", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cypheria-server-config-env-"))
    temporaryDirectories.push(configDir)
    const store = await ServerConfigStore.open(configDir, { CYPHERIA_SERVER_PORT: "9900" })

    const snapshot = await store.patch({ server: { listen: { port: 7788 } } })
    expect(snapshot.overrideControlledPaths).toContain("server.listen.port")
    expect(snapshot.restartRequiredPaths).not.toContain("server.listen.port")
    expect(store.effective.port).toBe(9900)
  })

  it("validates the complete desired configuration before writing", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cypheria-server-config-invalid-"))
    temporaryDirectories.push(configDir)
    const store = await ServerConfigStore.open(configDir, {})

    await expect(store.patch({ server: { relay: { enabled: true } } })).rejects.toThrow(
      "required when relay is enabled"
    )
    await expect(readFile(resolveServerConfigPath(configDir), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
})
