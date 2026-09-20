import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { AgentInstaller, type AgentInstallReceipt } from "./agent-installer.js"
import type { ToolchainManager } from "./toolchain-manager.js"

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false
  )

const receipt = (version: string, installedAt: string): AgentInstallReceipt => ({
  agentId: "gemini",
  args: [],
  command: `/managed/gemini/${version}`,
  installedAt,
  integrity: "not-applicable",
  kind: "npx",
  source: `gemini@${version}`,
  version,
})

describe("AgentInstaller cleanup", () => {
  it("removes interrupted staging, downloads, atomic writes, and incomplete versions", async () => {
    const home = await mkdtemp(join(tmpdir(), "cypheria-agent-installer-"))
    homes.push(home)
    const root = join(home, "agents", "gemini")
    const cache = join(home, "cache", "agents")
    const current = receipt("1.0.0", "2026-09-20T00:00:00.000Z")
    const interrupted = receipt("2.0.0", "2026-09-20T01:00:00.000Z")
    await Promise.all([
      mkdir(join(root, "staging", "partial"), { recursive: true }),
      mkdir(join(root, "versions", "1.0.0"), { recursive: true }),
      mkdir(join(root, "versions", "2.0.0"), { recursive: true }),
      mkdir(join(root, "versions", "orphan"), { recursive: true }),
      mkdir(join(root, "receipts"), { recursive: true }),
      mkdir(cache, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(root, "current.json"), JSON.stringify(current)),
      writeFile(join(root, "current.json.123.tmp"), "partial"),
      writeFile(join(root, "receipts", "1.0.0.json"), JSON.stringify(current)),
      writeFile(join(root, "receipts", "2.0.0.json"), JSON.stringify(interrupted)),
      writeFile(join(root, "receipts", "2.0.0.json.123.tmp"), "partial"),
      writeFile(join(cache, "download.zip"), "partial"),
    ])

    const installer = new AgentInstaller({
      cacheDir: join(home, "cache"),
      cypheriaHome: home,
      toolchains: {} as ToolchainManager,
    })
    await installer.cleanupInterrupted()

    await expect(exists(join(root, "staging"))).resolves.toBe(false)
    await expect(exists(join(cache, "download.zip"))).resolves.toBe(false)
    await expect(exists(join(root, "current.json.123.tmp"))).resolves.toBe(false)
    await expect(exists(join(root, "receipts", "2.0.0.json.123.tmp"))).resolves.toBe(false)
    await expect(exists(join(root, "versions", "1.0.0"))).resolves.toBe(true)
    await expect(exists(join(root, "versions", "2.0.0"))).resolves.toBe(false)
    await expect(exists(join(root, "versions", "orphan"))).resolves.toBe(false)
    await expect(exists(join(root, "receipts", "2.0.0.json"))).resolves.toBe(false)
    expect(JSON.parse(await readFile(join(root, "current.json"), "utf8"))).toEqual(current)
  })
})
