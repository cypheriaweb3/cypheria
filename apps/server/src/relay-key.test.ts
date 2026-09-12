import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { exportPublicKey } from "@cypheria/relay"
import { afterEach, describe, expect, it } from "vitest"

import { loadOrCreateRelayKeyPair } from "./relay-key.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true }))
  )
})

describe("relay key", () => {
  it("persists a stable private key with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-relay-key-"))
    temporaryDirectories.push(directory)
    const first = await loadOrCreateRelayKeyPair(directory)
    const second = await loadOrCreateRelayKeyPair(directory)
    expect(exportPublicKey(second.publicKey)).toBe(exportPublicKey(first.publicKey))
    expect((await stat(join(directory, "relay-key.json"))).mode & 0o777).toBe(0o600)
  })

  it("publishes one complete key under concurrent initialization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cypheria-relay-key-concurrent-"))
    temporaryDirectories.push(directory)
    const keyPairs = await Promise.all(
      Array.from({ length: 8 }, () => loadOrCreateRelayKeyPair(directory))
    )
    expect(new Set(keyPairs.map((keyPair) => exportPublicKey(keyPair.publicKey))).size).toBe(1)
    expect(await readdir(directory)).toEqual(["relay-key.json"])
  })
})
